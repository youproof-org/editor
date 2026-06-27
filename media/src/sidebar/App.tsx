import { useState, useEffect, useRef } from 'react';
import TreePanel from './TreePanel';
import { useClient } from '../shared/clientContext';
import type { ContentTreeItem, GetContentTreeResponse, ReloadModelResponse, SaveRecursivelyRequest, EndSelectTargetRequest } from '../shared/types';

function toggleSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  next.has(id) ? next.delete(id) : next.add(id);
  return next;
}

function findAncestors(nodes: ContentTreeItem[], targetId: string): string[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return [];
    const sub = findAncestors(node.children, targetId);
    if (sub !== null) return [node.id, ...sub];
  }
  return null;
}

function collectFileBacked(item: ContentTreeItem, out: string[]): void {
  if (item.isFileBacked) out.push(item.id);
  for (const child of item.children) collectFileBacked(child, out);
}

function collectAllIds(item: ContentTreeItem, out: string[]): void {
  out.push(item.id);
  for (const child of item.children) collectAllIds(child, out);
}

function findNode(items: ContentTreeItem[], nodeId: string): ContentTreeItem | null {
  for (const item of items) {
    if (item.id === nodeId) return item;
    const found = findNode(item.children, nodeId);
    if (found) return found;
  }
  return null;
}

const BOOKS_GROUP_ID = '__root:books';
const KB_GROUP_ID    = '__root:kb';

function makeRootNodes(data: GetContentTreeResponse): ContentTreeItem[] {
  return [
    { id: BOOKS_GROUP_ID, type: 'group', label: 'Books', isFileBacked: false, children: data.books },
    { id: KB_GROUP_ID,    type: 'group', label: 'Knowledge Base', isFileBacked: false, children: data.kb },
  ];
}

export default function App() {
  const client = useClient();
  const [nodes, setNodes]           = useState<ContentTreeItem[]>([]);
  const [expanded, setExpanded]     = useState<Set<string>>(new Set([BOOKS_GROUP_ID, KB_GROUP_ID]));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [ctxMenu, setCtxMenu]       = useState<{ x: number; y: number; node: ContentTreeItem } | null>(null);
  const [allowedSelectionTypes, setAllowedSelectionTypes] = useState<string[] | null>(null);

  const nodesRef    = useRef<ContentTreeItem[]>([]);  nodesRef.current    = nodes;
  const expandedRef = useRef<Set<string>>(new Set()); expandedRef.current = expanded;

  function applyTreeData(data: GetContentTreeResponse) {
    const newNodes = makeRootNodes(data);
    const validIds = new Set<string>();
    for (const root of newNodes) {
      const arr: string[] = [];
      collectAllIds(root, arr);
      arr.forEach(id => validIds.add(id));
    }

    const isInitialLoad = nodesRef.current.length === 0;
    const newExpanded = new Set([...expandedRef.current].filter(id => validIds.has(id)));
    newExpanded.add(BOOKS_GROUP_ID);
    newExpanded.add(KB_GROUP_ID);
    if (isInitialLoad) data.books.forEach(b => newExpanded.add(b.id));

    setNodes(newNodes);
    setExpanded(newExpanded);
    setSelectedId(data.selectedId);
    expandAncestors(newNodes, data.selectedId);
    setError(null);
  }

  function expandAncestors(treeNodes: ContentTreeItem[], selId: string | null) {
    if (!selId) return;
    const ancestors = findAncestors(treeNodes, selId);
    if (ancestors?.length) {
      setExpanded(prev => {
        const next = new Set(prev);
        ancestors.forEach(id => next.add(id));
        return next;
      });
    }
  }

  useEffect(() => {
    client.request<GetContentTreeResponse>('getContentTree')
      .then(data => applyTreeData(data))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    client.onNotification('contentObjectSelected', (params) => {
      const { id } = params as { id: string };
      setSelectedId(id);
      expandAncestors(nodesRef.current, id);
    });
  }, []);

  useEffect(() => {
    client.onNotification('targetSelectionStarted', (params) => {
      const { allowedTypes } = params as { allowedTypes: string[] };
      setAllowedSelectionTypes(allowedTypes);
    });
    client.onNotification('targetSelectionEnded',   () => setAllowedSelectionTypes(null));
  }, []);

  useEffect(() => {
    client.onNotification('contentObjectUpdated', () => {
      client.request<GetContentTreeResponse>('getContentTree')
        .then(data => applyTreeData(data))
        .catch((err: Error) => setError(err.message));
    });
  }, []);

  function handleSaveRecursively(nodeId: string): void {
    setCtxMenu(null);
    const node = findNode(nodes, nodeId);
    if (!node) return;
    const ids: string[] = [];
    collectFileBacked(node, ids);
    if (ids.length > 0) {
      client.request('saveRecursively', { ids } as SaveRecursivelyRequest).catch(console.error);
    }
  }

  function handleCollapseRecursively(nodeId: string): void {
    setCtxMenu(null);
    const node = findNode(nodes, nodeId);
    if (!node) return;
    const ids: string[] = [];
    collectAllIds(node, ids);
    setExpanded(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
  }

  function handleSelectAsTarget(node: ContentTreeItem): void {
    client.request('endSelectTarget', { targetId: node.id } as EndSelectTargetRequest).catch(console.error);
  }

  function handleReloadModel(): void {
    client.request<ReloadModelResponse>('reloadModel')
      .then(data => applyTreeData(data))
      .catch((err: Error) => setError(err.message));
  }

  if (error) {
    return (
      <div id="app">
        <p className="msg error">{error}</p>
      </div>
    );
  }

  return (
    <div id="app">
      <TreePanel
        nodes={nodes}
        expanded={expanded}
        onToggle={id => setExpanded(prev => toggleSet(prev, id))}
        selectedId={selectedId}
        onContextMenu={(node, e) => {
          e.preventDefault();
          setCtxMenu({ x: e.clientX, y: e.clientY, node });
        }}
        allowedSelectionTypes={allowedSelectionTypes}
        onSelectAsTarget={handleSelectAsTarget}
      />
      <div className="sidebar-footer">
        {allowedSelectionTypes !== null
          ? <button className="cancel-select-target-btn"
              onClick={() => client.request('endSelectTarget', { targetId: null } as EndSelectTargetRequest).catch(console.error)}>
              Cancel select target
            </button>
          : <button className="reload-model-btn" onClick={handleReloadModel}>Reload model</button>
        }
      </div>
      {ctxMenu && (
        <>
          <div className="ctx-backdrop" onMouseDown={e => { e.preventDefault(); setCtxMenu(null); }} />
          <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            {ctxMenu.node.children.length > 0 && (
              <button className="ctx-menu-item" onClick={() => handleCollapseRecursively(ctxMenu.node.id)}>
                Collapse recursively
              </button>
            )}
            {ctxMenu.node.isFileBacked && (
              <button className="ctx-menu-item" onClick={() => handleSaveRecursively(ctxMenu.node.id)}>
                Save recursively
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
