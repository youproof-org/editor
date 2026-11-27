# Extension messaging protocol

The extension host and each webview (sidebar panel, editor panels) communicate through VS Code's `postMessage` / `onDidReceiveMessage` API. A thin request/response layer with sequential dispatch sits on top of it.

---

## Transport layer

### Message shapes

All messages are plain JSON objects with a `kind` discriminator.

```
// Webview → extension host
{ kind: 'request', id: string, method: string, params: unknown }

// Extension host → webview (reply)
{ kind: 'response', id: string, result?: unknown, error?: string }

// Extension host → all webviews (push)
{ kind: 'notification', method: string, params: unknown }
```

### Dispatch rules

- Requests are **serialised** on the server side: the `MessageServer` maintains a queue and processes one request at a time (a new request is only started after the previous handler resolves/rejects). This prevents concurrent mutation of the in-memory content cache.
- Each editor panel webview has its own `vscode.Webview` instance registered with `MessageServer.registerWebview()`. The sidebar webview is registered separately by `SidebarProvider`.
- Notifications sent via `MessageServer.notify()` are broadcast to **all** currently registered webviews.
- The client (`MessageClient`) generates monotonically increasing numeric IDs per webview instance; IDs are not globally unique across webviews.

### Implementation files

| File | Role |
|---|---|
| `extension/src/protocol/types.ts` | Shared TypeScript interfaces for the three message shapes |
| `extension/src/protocol/messageServer.ts` | Extension-host side: registers webviews, dispatches requests, sends notifications |
| `extension/media/src/shared/messageClient.ts` | Webview side: sends requests, resolves pending promises, routes notifications |
| `extension/media/src/shared/clientContext.ts` | React context that exposes `MessageClient` to components via `useClient()` |

---

## Requests

Webviews call `client.request<T>(method, params?)` which returns a `Promise<T>` that resolves with `result` or rejects with an `Error` built from `error`.

### `getContentTree`

**Direction:** sidebar → extension host  
**Caller:** `App.tsx` on mount and on `refresh` notification  
**Params:** *(none)*  
**Result:** `ContentTreeData`

```typescript
interface ContentTreeData {
  books:      ContentTreeItem[];   // book → part → chapter → section hierarchy
  kb:         ContentTreeItem[];   // namespace tree with definitions / theorems / proofs / remarks
  selectedId: string | null;       // currently selected object ID, from extension host state
}

interface ContentTreeItem {
  id:          string;
  type:        NodeType | 'group' | 'term' | 'claim';
  label:       string;
  isFileBacked: boolean;           // false for inline items (terms, claims, groups)
  children:    ContentTreeItem[];
}
```

---

### `selectContentObject`

**Direction:** any webview → extension host  
**Caller:** `TreeNodeView.tsx` on single-click (preview) and double-click (permanent); an editor panel when it opens a target, from an embed's Open or the reference popup's ↗ (`useTargetSelection.ts`)  
**Params:** `{ id: string; permanent?: boolean; openedFrom?: string }` — the model ID of the object to select; `permanent` promotes the panel out of preview mode; `openedFrom` is the ID of the panel that opens the object as a target  
**Result:** `{}` (opens or focuses the editor panel as a side-effect)

The extension host:
1. Resolves the file-backed entity: if `id` is not in `idToFilePath`, walks the parent chain via `findFileBacked()` to find the nearest file-backed ancestor.
2. If `openedFrom` names another panel than the one the object opens in, promotes that panel out of preview first (`PanelManager.promote()`), so the target's panel opens beside it instead of replacing it. The target's panel opens as a preview itself.
3. Opens or reveals the editor panel via `PanelManager.open()`. New panels always open as native VS Code preview tabs (italic tab title, `Tab.isPreview = true`). If there is already a different preview panel open, it is closed first.
4. If `permanent` is `true`, immediately calls `PanelManager.promote()` to pin the tab (non-italic).
5. If `id` differs from the current `selectedId`: stores `selectedId = id` and broadcasts a `contentObjectSelected` notification with the `id` to all webviews.
6. If the same `id` is re-selected: only reveals the panel — no broadcast.

---

### `getContentObject`

**Direction:** editor panel → extension host  
**Caller:** `NodeView.tsx` on mount and on `refresh` notification  
**Params:** `{ id: string }` — the model ID embedded in the panel's `data-node-id` attribute  
**Result:** `{ contentObject: ContentObjectData, targetObjects: Record<string, ContentTargetObject> }`

```typescript
// Common base
interface ContentObjectBase {
  id:         string;
  name:       string;
  title?:     string;
  selectedId: string | null;   // currently selected object ID, from extension host state
  hasReferencesDictionary?: boolean;   // the file still has the old keyed `references` dictionary; saving it is refused
}

// definition | theorem | proof | remark — carry the entity's label variant
interface ContentEntityLabelFields {
  locale:              string;
  label?:              string;             // a variant key from the label registry; absent = the type's default
  hasLabelsBlock?:     boolean;            // the file still has a legacy `labels` block; saving it is refused
  labelVariants?:      EntityTypeLabels;   // this locale's variants for the entity's type, from the registry
  labelRegistryError?: string;             // set when the registry could not be read; names the path and setting
}

interface EntityTypeLabels {
  default:  string;
  variants: { key: string; canonical: string }[];   // in registry order
}

// definition | theorem | remark — have terms
interface ContentDefinitionData extends ContentObjectBase, ContentEntityLabelFields {
  type: 'definition';
  namespacePath: string;
  terms:      ContentTerm[];
  body:       ContentBlock[];
}
// (theorem and remark follow the same shape with type: 'theorem' | 'remark')

// proof — no terms
interface ContentProofData extends ContentObjectBase, ContentEntityLabelFields {
  type: 'proof';
  namespacePath: string;
  body:       ContentBlock[];
}

// chapter — no body, four named block arrays
interface ContentChapterData extends ContentObjectBase {
  type: 'chapter';
  abstract:            ContentBlock[];
  prerequisiteWarning: ContentBlock[];
  prologue:            ContentBlock[];
  epilogue:            ContentBlock[];
}

// section — like proof but no namespacePath
interface ContentSectionData extends ContentObjectBase {
  type: 'section';
  body:       ContentBlock[];
}

interface ContentTerm {
  id:        string;
  name:      string;   // the map key in YAML; English, the id references resolve against
  slug:      string;   // the localized anchor segment; '' when the file has none
  display:   string;
  canonical: string;
  synonyms:  string[];
}

// Resolved metadata for each embed target, keyed by targetId
interface ContentTargetObject {
  id:    string;
  type:  string;   // 'definition' | 'theorem' | 'proof' | 'remark' | 'chapter' | 'section' | 'term' | 'claim' | 'external'
  label: string;   // title or name of the target object
  path?: string;   // set only on a sidebar pick, see endSelectTarget
}
```

`ContentBlock` is a discriminated union of 11 block types (see `extension/media/src/shared/types.ts`): `narrative`, `formula`, `claim`, `ordered-list`, `unordered-list`, `typewriter`, `quote`, `figure`, `subsection`, `details`, `embed`.

A content object carries no separate references. Each reference is held in the text, in the token that cites it: on load, the host reads the file's `references` list with the site build's reader (`readReferences` in `@youproof.org/display-templates`) and turns each `[i]` into `[@<payload>]`, where the payload is the item, as YAML parses it, in base64url JSON (`src/protocol/referenceToken.ts`). The text fields travel to the webview and back with these tokens in them, so whatever moves, copies or deletes text does the same to its references. The webview shows each token as one atomic unit, rendered as the site renders it (`media/src/editor/referenceTokens.ts`); the host renders it on request, see [`resolveReferenceTokens`](#resolvereferencetokens). A `[i]` the site doesn't read as a reference, such as one inside `$...$` or in a formula's `content`, stays as it is.

A `claim` carries `name`, `slug`, `content` and an optional `formula`. As on a term, `name` is the English id a reference resolves against and `slug` is the localized anchor segment, `''` when the file has none — legal content, since the site falls back to `name`. A save is refused if a non-empty slug is not lowercase kebab-case, or if two claims (or two terms) on one node resolve to the same anchor.

---

### `resolveReferenceTokens`

**Direction:** editor panel → extension host  
**Caller:** `ReferenceDisplayStore` (`media/src/editor/referenceDisplays.ts`), for the tokens its fields show and the previews the reference popup shows that it has no display for yet, batched per turn, and for all of them again on a `referenceDisplaysChanged` notification  
**Params:** `{ id: string; payloads: string[] }`: the panel's content object, and the payloads of the tokens to render (the part of `[@<payload>]` between `[@` and `]`)  
**Result:** `{ displays: Record<string, ReferenceTokenDisplay> }`, one entry per payload

```typescript
type ReferenceTokenSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; target: string };   // target: the fully qualified name, or the URL of an external target

type ReferenceTokenDisplay =
  | { segments: ReferenceTokenSegment[] }
  | { error: string };
```

The host renders each token as the site renders its reference in a file of the object's locale (`src/content/referenceDisplays.ts`):

1. It decodes the payload and reads the item with the site build's reader (`readReferences`), against the loaded locale's display templates. Anything the reader rejects, such as an unknown template, a target type the template doesn't take or a target count outside its `count`, is the error.
2. It resolves the item with the shared resolution (`resolveReference` in `@youproof.org/display-templates`) against the editor's numbering of the loaded content. For a `display` item, a target the numbering can't vouch for, because content the editor is missing could change its number, is an error instead of a number (`resolveEditorReference` in `src/content/numbering.ts`).

When the entity label registry couldn't be read, every display is that error. The segments are not capitalized: the webview capitalizes a reference where the site starts a sentence with it, which depends on the text around the token: `src/protocol/referencePlacement.ts` asks the site's `renderedReferences` from `@youproof.org/display-templates`, so a reference at the start of a bold run is capitalized only when the run itself starts a sentence, as on the site.

The webview shows a rendered token in purple, each link segment in brackets, with the link's target in a tooltip once the pointer rests on it for 120 ms (`hoverTip.ts`, which shows any element's `data-tip`; a native `title` takes the browser's own, much longer, delay). A token shows its template name or literal text dimmed while its display is on its way, and in an error state, with the reason in the same tooltip, when the host returns an error, when the token sits where the site reads no reference (inside `$...$` or `^...^`, or in a field such as a formula's `content`), or when its payload can't be decoded. None of this changes what a save refuses.

---

### `saveContentObject`

**Direction:** editor panel → extension host  
**Caller:** `NodeView.tsx` on Ctrl+S / Cmd+S  
**Params:** discriminated union on `entityType`

```typescript
// definition | theorem | remark — carry terms
interface SaveDefinitionParams {
  id:         string;
  entityType: 'definition' | 'theorem' | 'remark';
  body:       ContentBlock[];
  terms:      ContentTerm[];
  label?:     string;   // omitted for the type's default, which removes `label` from the file
}

// proof | section — no terms
interface SaveProofOrSectionParams {
  id:         string;
  entityType: 'proof' | 'section';
  body:       ContentBlock[];
  label?:     string;   // proof only
}

// chapter — no body, four named block arrays
interface SaveChapterParams {
  id:                  string;
  entityType:          'chapter';
  abstract:            ContentBlock[];
  prerequisiteWarning: ContentBlock[];
  prologue:            ContentBlock[];
  epilogue:            ContentBlock[];
}
```

**Result:** `{}`

The extension host:
1. Looks up the YAML file path from `content.idToFilePath.get(id)`.
2. Reads the existing YAML from disk and merges the wire blocks back using `blockToYaml` / `mergeBlocks` (which preserves `embed` blocks verbatim from the original YAML, since their target references are runtime-generated IDs that cannot be reconstructed from the wire format).
3. Writes the `references` list from the tokens the text holds, in the order the site reads the text fields (`fileReferenceTexts`), one item per token, and rewrites each token as its index, `[0]` to `[N-1]`. A list that comes out as the file had it is written back byte for byte; any other is written one flow-style item per line. Then it writes the YAML back to disk with `lineWidth: 120`, unless the result holds the same data as the file on disk: then the file keeps its bytes, so a save that changes nothing doesn't rewrap a string folded at another width. A file that still has a `references` dictionary or a `labels` block is refused before anything is written, and so is a token the site wouldn't read as a reference: one in a field it reads no references from, inside `$...$` or `^...^`, a damaged one, or an index typed as text.
4. Reads the written references back with the site build's reader, against the loaded locale's display templates, and shows what the build would reject.
5. Updates the in-memory model in-place: `updateModelBlocks` patches editable block fields; `updateModelTerms` adds, updates, and removes term entries in the cached model and keeps `idToObject` consistent.
6. Calls `PanelManager.setDirty(id, false)` (internal method) which removes the `●` prefix from the tab title.

---

### `saveRecursively`

**Direction:** sidebar → extension host  
**Caller:** sidebar context menu "Save recursively"  
**Params:** `{ ids: string[] }` — IDs of the nodes to save (the selected node and all its descendants)  
**Result:** `{}`

The extension host:
1. Checks whether any of the given IDs have an open panel with unsaved changes. If so, shows an error message listing the dirty panel titles and returns without saving.
2. Calls `saveFromModel(id, content)` for each id in order, writing each object's current in-memory state to its YAML file.

---

### `openContentObjectFile`

**Direction:** editor panel → extension host  
**Caller:** `NodeView.tsx` "Open YAML file" button  
**Params:** `{ id: string }`  
**Result:** `{}`

The extension host promotes the editor panel out of preview mode and opens the object's YAML file in the VS Code text editor via `vscode.commands.executeCommand('vscode.open', ...)`.

---

### `reloadModel`

**Direction:** sidebar → extension host  
**Caller:** sidebar "Reload" button  
**Params:** *(none)*  
**Result:** same shape as `getContentTree` (`{ books, kb, selectedId }`)

The extension host:
1. Checks whether any open panel has unsaved changes. If so, shows an error message and returns the current tree without reloading.
2. Closes all open editor panels via `PanelManager.closeAll()`, capturing their file paths.
3. Rereads `locales.json` and `entity-labels.json` from the services checkout (`youproof.servicesRoot`). If `locales.json` is missing or invalid, shows an error message naming its path and the setting, and rejects without loading content; the sidebar shows the error with a Retry button. A bad `entity-labels.json` also shows an error message naming its path, but doesn't stop the reload: entity data then carries `labelRegistryError` instead of `labelVariants`.
4. Resets the content cache via `resetContentCache()` and reloads from disk.
5. Reopens panels for any file path that still exists in the new model, preserving panel order.
6. Restores `selectedId` to the new model ID corresponding to the previously selected file, or falls back to the last reopened panel.

---

### `setContentObjectDirty`

**Direction:** editor panel → extension host  
**Caller:** `NodeView.tsx` on first keystroke  
**Params:** `{ id: string }`  
**Result:** `{}`

Marks the panel tab dirty (prepends `●` to the title) and promotes it out of preview mode (pins the tab). The dirty flag is cleared internally by the extension at the end of a successful `saveContentObject` — no separate message is sent for that direction.

### `getReferenceChoices`

**Direction:** editor panel → extension host  
**Caller:** `ReferencePopupProvider.tsx` (editor panels), when the panel's reference popup opens for the first time, and again when it opens or is open after a `referenceDisplaysChanged` notification  
**Params:** `{ id: string }`: the panel's content object  
**Result:** `ReferenceChoices`

```typescript
interface ReferenceChoices {
  templates: DisplayTemplateChoice[];   // in the collection's order
  targets:   ReferenceTargetChoice[];   // in reading order, an entity followed by its claims and terms, then what nothing embeds
  error?:    string;                    // set, with both lists empty, when references can't be rendered at all
}

interface DisplayTemplateChoice {
  name:    string;
  targets: string[];                          // the target kinds it accepts
  count:   { min: number; max?: number };     // { min: 1, max: 1 } for a single template
  list:    boolean;
  order:   'sorted' | 'authored';             // 'sorted' for a single template
  groupBy?: 'label' | 'parent' | 'type';
  uses:    Record<string, number>;            // uses in the loaded lists, by the kinds of an item's targets, sorted and joined by '+'
}

interface ReferenceTargetChoice {
  path:   string;     // what an item's `target` holds for it
  kind:   'chapter' | 'section' | 'definition' | 'theorem' | 'proof' | 'remark' | 'claim' | 'term';
  id:     string;     // the model id
  label:  string;     // '24.16. Tétel', '23.5.', '23.', a claim's '3.', a term's canonical form
  title?: string;     // a chapter's, section's or entity's title; a claim's words without markup
  owner?: string;     // the owner's label, for a claim, a term, a proof and a remark an entity lists
  labelName?: string; // an entity's label variant, capitalized: 'Tétel', 'Lemma'
  position?: number;  // reading order; absent for what nothing embeds
  groups: { type?: string; parent?: string; label?: string };   // the shared `groupKeys`
  synonyms?: string[];                       // a term's synonyms
  texts?: { text: string; uses: number }[];  // a term's link texts in the loaded lists, most used first
  problem?: string;   // why its number can't be trusted, when missing content could change it
}
```

The host builds it in `src/content/referenceChoices.ts` from the numbering, the loaded locale's display templates and the label registry, and keeps it until one of them changes, so it is built again after a save, a reload or a change to the collection, which are the times `referenceDisplaysChanged` fires. A target's `path` is the key the editor's numbering and the site's graph use: a proof under its theorem, a remark under the entity that lists it, a chapter under its book, a section under its chapter, a claim or a term under its entity. A remark that nothing lists has no path the grammar accepts, and a claim inside a subsection or a details block is not numbered by the site, so neither is offered. `uses` and `texts` count the files' `references` lists as they were loaded or last saved. When the entity label registry couldn't be read, the result is `{ templates: [], targets: [], error }` with the same message `resolveReferenceTokens` gives.

---

### `openExternalUrl`

**Direction:** editor panel → extension host  
**Caller:** `useTargetSelection.ts` (`handleOpenTarget`), for a target of type `external`  
**Params:** `{ url: string }`  
**Result:** `{}`

The host opens the URL with `vscode.env.openExternal`.

---

### `beginSelectTarget`

**Direction:** editor panel → extension host  
**Caller:** `useTargetSelection.ts` (`handleBeginSelectTarget`), when an embed block's target selector, or the reference popup's "Pick in sidebar", starts a pick in the sidebar  
**Params:** `{ selectorId: string; allowedTypes: string[] }`: who started the pick, and the tree node types that can be picked  
**Result:** `{}`

The host remembers the pick and broadcasts `targetSelectionStarted` with the same params. While a pick is pending, another `beginSelectTarget` is ignored.

---

### `endSelectTarget`

**Direction:** sidebar or editor panel → extension host  
**Caller:** `App.tsx` (sidebar), with the node's id when its Select button is clicked and with `null` from "Cancel select target"; `useTargetSelection.ts` (`handleEndSelectTarget`), with `null` from an embed block's Cancel and from the reference popup's Cancel, Escape or closing  
**Params:** `{ targetId: string | null }`  
**Result:** `{}`

Without a pending pick it does nothing. Otherwise the host ends the pick and broadcasts `targetSelectionEnded` with the pending `selectorId` and a `result`: `null` for a cancel or for an id it can't type, else a `ContentTargetObject`:

```typescript
interface ContentTargetObject {
  id:    string;
  type:  string;   // 'chapter' | 'section' | 'definition' | 'theorem' | 'proof' | 'remark' | 'claim' | 'term'
  label: string;   // the object's title, else its name
  path?: string;   // the target's path, the same one getReferenceChoices gives for this id; absent for what it doesn't offer
}
```

---

### `getSelfReferenceDisplaySuggestions`

**Direction:** editor panel → extension host  
**Caller:** `FigureBlock.tsx`, for the suggestions of the figure's self-reference display field (`SuggestionInput`)  
**Params:** `{}`  
**Result:** `{ suggestions: string[] }`: every distinct `self-reference.display` of the loaded figures, the most used first

---

## Notifications

Notifications flow from the extension host to all registered webviews. The client subscribes with `client.onNotification(method, handler)`.

---

### `contentObjectSelected`

**Direction:** extension host → all webviews (broadcast via `MessageServer.notify()`)  
**Triggers:**
- `selectContentObject` handler, when the selected ID changes
- `PanelManager` panel-activated callback (`onDidChangeViewState`), when the user focuses an editor tab directly  
**Params:** `{ id: string }` — the newly selected object ID  
**Subscribers:**
- `App.tsx` (sidebar) — sets `selectedId` and expands ancestors to highlight the node, with no follow-up request
- `NodeView.tsx` (editor panels) — sets `selectedId` directly, with no follow-up request

---

### `targetSelectionStarted`

**Direction:** extension host → all webviews (broadcast via `MessageServer.notify()`)  
**Trigger:** `beginSelectTarget`  
**Params:** `{ selectorId: string; allowedTypes: string[] }`  
**Subscribers:**
- `App.tsx` (sidebar), which shows a Select button on each node whose type is in `allowedTypes` and replaces the reload buttons with "Cancel select target"
- `useTargetSelection.ts` (editor panels), which records `selectorId` as the selector that is picking

---

### `targetSelectionEnded`

**Direction:** extension host → all webviews (broadcast via `MessageServer.notify()`)  
**Trigger:** `endSelectTarget`, while a pick is pending  
**Params:** `{ selectorId: string; result: ContentTargetObject | null }`  
**Subscribers:**
- `App.tsx` (sidebar), which leaves the selection mode
- `useTargetSelection.ts` (editor panels), which clears the picking selector. Only the panel that sent `beginSelectTarget` acts on `result`. For the reference popup's `selectorId`, `reference-popup`, it hands `result`, `null` included, to the popup, which goes on with the picked target's `path`. For any other, it sets the embed block whose id is `selectorId` to the picked target and marks the panel dirty.

---

### `contentObjectUpdated`

**Direction:** extension host → all webviews (broadcast via `MessageServer.notify()`)  
**Trigger:** `saveContentObject`, after the save  
**Params:** `{ id: string }`: the saved object  
**Subscribers:** `App.tsx` (sidebar), which asks for the tree again with `getContentTree`

---

### `referenceDisplaysChanged`

**Direction:** extension host → all webviews (broadcast via `MessageServer.notify()`)  
**Triggers:** `src/extension.ts`, whenever what a reference renders as may have changed:
- the display template collection is read again, including when its file changes on disk
- a save changes the in-memory model, which can renumber the content
- the content cache is reset, as `reloadModel` does

**Params:** `{}`  
**Subscribers:** `NodeView.tsx` (editor panels), which asks for every display its panel holds again with `resolveReferenceTokens`. A token keeps its old display until the new one arrives.

---

## Sequence diagrams

### Sidebar startup

```
Sidebar                Extension host
  |                         |
  |--- getContentTree ------>|
  |<-- ContentTreeData ------|
  |                         |
```

### Selecting an object

```
Sidebar                Extension host          All webviews (incl. new panel)
  |                         |                       |
  |-- selectContentObject(id)->|                      |
  |                         | open/reveal panel      |
  |                         | selectedId = id        |
  |                         |--- contentObjectSelected({id})->| (broadcast)
  |<-- {} ------------------|                       |
  |                         |   (sidebar + panels update selectedId directly)
  |                         |                       |
  |                         |<-- getContentObject(id)| (new panel on mount only)
  |                         |--- { contentObject, targetObjects }->|
```

### Saving

```
Editor panel           Extension host
  |                         |
  | (first edit)            |
  |--- setContentObjectDirty->|
  |<-- {} ------------------|
  |                         |
  | (Ctrl+S pressed)        |
  |--- saveContentObject(params)->|
  |                         | reads YAML, merges, writes YAML
  |                         | updates in-memory cache in-place
  |                         | clears dirty flag (tab title)
  |<-- {} ------------------|
```

### Save recursively (no dirty panels)

```
Sidebar                Extension host
  |                         |
  | (context menu)          |
  | collectFileBacked(node) |
  |-- saveRecursively({ids})->|
  |                         | check dirty panels → none
  |                         | saveFromModel(id) × N (writes YAML for each)
  |<-- {} ------------------|
```

### Save recursively (dirty panels present)

```
Sidebar                Extension host
  |                         |
  |-- saveRecursively({ids})->|
  |                         | check dirty panels → found
  |                         | showErrorMessage(labels)
  |<-- {} ------------------|
  |  (no files written)     |
```

### Open YAML file

```
Editor panel           Extension host           VS Code
  |                         |                      |
  | (click "Open YAML file")|                      |
  |-- openContentObjectFile(id)->|                 |
  |                         | PanelManager.promote(id)
  |                         |-- vscode.open(filePath)->|
  |                         |                      | opens YAML in text editor
  |<-- {} ------------------|                      |
```

### Reload model (no dirty panels)

```
Sidebar                Extension host
  |                         |
  | (click Reload)          |
  |--- reloadModel -------->|
  |                         | check dirty panels → none
  |                         | PanelManager.closeAll() → [openIds + filePaths]
  |                         | resetContentCache()
  |                         | reopen panels by file path in new model
  |                         | restore selectedId (by file path, or last reopened)
  |                         | PanelManager.focusWhenReady(selectedId)
  |<-- { books, kb, selectedId }--|
  | applyTreeData(data)     |
```

### Active panel changes (tab focus)

```
VS Code              Extension host          Sidebar         Editor panels
  |                       |                    |                   |
  | (user clicks tab)     |                    |                   |
  | onDidChangeViewState  |                    |                   |
  |---------------------->|                    |                   |
  |                       | selectedId = nodeId|                   |
  |                       |--- contentObjectSelected({id}) --------------->| (broadcast)
  |                       |    (sidebar + panels update selectedId directly)
```

### Reload model (dirty panels present)

```
Sidebar                Extension host
  |                         |
  |--- reloadModel -------->|
  |                         | check dirty panels → found
  |                         | showErrorMessage(labels)
  |<-- { books, kb, selectedId (unchanged) }--|
  | (tree unchanged)        |
```
