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
  targetId?:   string;             // set for 'reference' nodes
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
}

// definition | theorem | remark — have terms
interface ContentDefinitionData extends ContentObjectBase {
  type: 'definition';
  namespacePath: string;
  terms:      ContentTerm[];
  references: ContentReference[];
  body:       ContentBlock[];
}
// (theorem and remark follow the same shape with type: 'theorem' | 'remark')

// proof — no terms
interface ContentProofData extends ContentObjectBase {
  type: 'proof';
  namespacePath: string;
  references: ContentReference[];
  body:       ContentBlock[];
}

// chapter — no body, four named block arrays
interface ContentChapterData extends ContentObjectBase {
  type: 'chapter';
  references:          ContentReference[];
  abstract:            ContentBlock[];
  prerequisiteWarning: ContentBlock[];
  prologue:            ContentBlock[];
  epilogue:            ContentBlock[];
}

// section — like proof but no namespacePath
interface ContentSectionData extends ContentObjectBase {
  type: 'section';
  references: ContentReference[];
  body:       ContentBlock[];
}

interface ContentTerm {
  id:        string;
  name:      string;
  display:   string;
  canonical: string;
  synonyms:  string[];
}

interface ContentReference {
  id:        string;
  name:      string;
  display:   string;
  targetId?: string;   // resolved model ID of the referenced object
}

// Resolved metadata for each reference target, keyed by targetId
interface ContentTargetObject {
  id:    string;
  type:  string;   // 'definition' | 'theorem' | 'proof' | 'remark' | 'chapter' | 'section' | 'term' | 'claim' | 'external'
  label: string;   // title or name of the target object
}
```

`ContentBlock` is a discriminated union of 12 block types (see `extension/media/src/shared/types.ts`): `narrative`, `formula`, `claim`, `ordered-list`, `unordered-list`, `typewriter`, `quote`, `figure`, `subsection`, `details`, `embed`, `recall`.

---

### `saveContentObject`

**Direction:** editor panel → extension host  
**Caller:** `NodeView.tsx` on Ctrl+S / Cmd+S  
**Params:** discriminated union on `entityType`

```typescript
// definition | theorem | remark — carry terms and references
interface SaveDefinitionParams {
  id:         string;
  entityType: 'definition' | 'theorem' | 'remark';
  body:       ContentBlock[];
  terms:      ContentTerm[];
  references: ContentReference[];
}

// proof | section — no terms
interface SaveProofOrSectionParams {
  id:         string;
  entityType: 'proof' | 'section';
  body:       ContentBlock[];
  references: ContentReference[];
}

// chapter — no body, four named block arrays
interface SaveChapterParams {
  id:                  string;
  entityType:          'chapter';
  abstract:            ContentBlock[];
  prerequisiteWarning: ContentBlock[];
  prologue:            ContentBlock[];
  epilogue:            ContentBlock[];
  references:          ContentReference[];
}
```

**Result:** `{}`

The extension host:
1. Looks up the YAML file path from `content.idToFilePath.get(id)`.
2. Reads the existing YAML from disk and merges the wire blocks back using `blockToYaml` / `mergeBlocks` (which preserves `embed` and `recall` blocks verbatim from the original YAML, since their target references are runtime-generated IDs that cannot be reconstructed from the wire format).
3. Writes the updated YAML back to disk with `lineWidth: 120`.
4. Updates the in-memory model in-place: `updateModelBlocks` patches editable block fields; `updateModelTerms` and `updateModelRefs` add, update, and remove term/reference entries in the cached model and keep `idToObject` consistent.
5. Calls `PanelManager.setDirty(id, false)` (internal method) which removes the `●` prefix from the tab title.

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
3. Resets the content cache via `resetContentCache()` and reloads from disk.
4. Reopens panels for any file path that still exists in the new model, preserving panel order.
5. Restores `selectedId` to the new model ID corresponding to the previously selected file, or falls back to the last reopened panel.

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
