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
  type:        NodeType | 'group' | 'reference' | 'term' | 'claim';
  label:       string;
  isFileBacked: boolean;           // false for inline items (terms, refs, claims, groups)
  children:    ContentTreeItem[];
}
```

---

### `selectContentObject`

**Direction:** any webview → extension host  
**Caller:** `TreeNodeView.tsx` on single-click (preview) and double-click (permanent)  
**Params:** `{ id: string; permanent?: boolean }` — the model ID of the object to select; `permanent` promotes the panel out of preview mode  
**Result:** `{}` (opens or focuses the editor panel as a side-effect)

The extension host:
1. Resolves the file-backed entity: if `id` is not in `idToFilePath`, walks the parent chain via `findFileBacked()` to find the nearest file-backed ancestor.
2. Opens or reveals the editor panel via `PanelManager.open()`. New panels always open as native VS Code preview tabs (italic tab title, `Tab.isPreview = true`). If there is already a different preview panel open, it is closed first.
3. If `permanent` is `true`, immediately calls `PanelManager.promote()` to pin the tab (non-italic).
4. If `id` differs from the current `selectedId`: stores `selectedId = id` and broadcasts a `refresh` notification to all webviews.
5. If the same `id` is re-selected: only reveals the panel — no broadcast.

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
}
```

`ContentBlock` is a discriminated union of 11 block types (see `extension/media/src/shared/types.ts`): `narrative`, `formula`, `claim`, `ordered-list`, `unordered-list`, `typewriter`, `quote`, `figure`, `subsection`, `details`, `embed`.

A content object carries no separate references. Each reference is held in the text, in the token that cites it: on load, the host reads the file's `references` list with the site build's reader (`readReferences` in `@youproof.org/display-templates`) and turns each `[i]` into `[@<payload>]`, where the payload is the item, as YAML parses it, in base64url JSON (`src/protocol/referenceToken.ts`). The text fields travel to the webview and back with these tokens in them, so whatever moves, copies or deletes text does the same to its references. The webview shows each token as one atomic unit (`media/src/editor/referenceTokens.ts`). A `[i]` the site doesn't read as a reference, such as one inside `$...$` or in a formula's `content`, stays as it is.

A `claim` carries `name`, `slug`, `content` and an optional `formula`. As on a term, `name` is the English id a reference resolves against and `slug` is the localized anchor segment, `''` when the file has none — legal content, since the site falls back to `name`. A save is refused if a non-empty slug is not lowercase kebab-case, or if two claims (or two terms) on one node resolve to the same anchor.

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
3. Writes the `references` list from the tokens the text holds, in the order the site reads the text fields (`fileReferenceTexts`), one item per token, and rewrites each token as its index, `[0]` to `[N-1]`. A list that comes out as the file had it is written back byte for byte; any other is written one flow-style item per line. Then it writes the YAML back to disk with `lineWidth: 120`. A file that still has a `references` dictionary or a `labels` block is refused before anything is written, and so is a token the site wouldn't read as a reference: one in a field it reads no references from, inside `$...$` or `^...^`, a damaged one, or an index typed as text.
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
