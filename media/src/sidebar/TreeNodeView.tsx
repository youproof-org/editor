import { useEffect, useRef } from 'react';
import { useClient } from '../shared/clientContext';
import type { ContentTreeItem, SelectContentObjectRequest } from '../shared/types';

const BADGE: Record<string, string | null> = {
  book:       'B',
  part:       'P',
  chapter:    'C',
  section:    'S',
  namespace:  'N',
  group:      null,
  definition: 'D',
  theorem:    'T',
  proof:      'P',
  remark:     'R',
  reference:  '→',
  term:       '★',
  claim:      '§',
};

interface Props {
  node:                  ContentTreeItem;
  expanded:              Set<string>;
  onToggle:              (id: string) => void;
  depth:                 number;
  selectedId:            string | null;
  onContextMenu:         (node: ContentTreeItem, e: React.MouseEvent) => void;
  allowedSelectionTypes: string[] | null;
  onSelectAsTarget:      (node: ContentTreeItem) => void;
}

export default function TreeNodeView({ node, expanded, onToggle, depth, selectedId, onContextMenu, allowedSelectionTypes, onSelectAsTarget }: Props) {
  const client      = useClient();
  const hasChildren = node.children.length > 0;
  const isExpanded  = expanded.has(node.id);
  const badgeChar   = BADGE[node.type] ?? null;
  const isGroup     = node.type === 'group';
  const isSelected  = !isGroup && node.id === selectedId;
  const rowRef      = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isSelected) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isSelected]);

  return (
    <div className="tree-item">
      <div
        ref={rowRef}
        className={`tree-row${isGroup ? '' : ' tree-row--clickable'}${isSelected ? ' tree-row--selected' : ''}`}
        style={{ paddingLeft: depth * 16 + 4 }}
        onClick={isGroup ? undefined : () => client.request('selectContentObject', { id: node.id } as SelectContentObjectRequest).catch(console.error)}
        onDoubleClick={isGroup ? undefined : (e) => { e.stopPropagation(); client.request('selectContentObject', { id: node.id, permanent: true } as SelectContentObjectRequest).catch(console.error); }}
        onContextMenu={(node.isFileBacked || node.children.length > 0) ? (e) => onContextMenu(node, e) : undefined}
      >
        {hasChildren ? (
          <span
            className={'chevron' + (isExpanded ? ' expanded' : '')}
            onClick={e => { e.stopPropagation(); onToggle(node.id); }}
          >›</span>
        ) : (
          <span className="chevron-spacer" />
        )}

        {badgeChar != null && (
          <span className={`badge badge-${node.type}`}>{badgeChar}</span>
        )}

        <span className="tree-label" title={node.label}>{node.label}</span>
        {allowedSelectionTypes?.includes(node.type) && (
          <button className="select-as-target-btn"
            onClick={e => { e.stopPropagation(); onSelectAsTarget(node); }}>
            Select
          </button>
        )}
      </div>

      {isExpanded && node.children.map(child => (
        <TreeNodeView
          key={child.id}
          node={child}
          expanded={expanded}
          onToggle={onToggle}
          depth={depth + 1}
          selectedId={selectedId}
          onContextMenu={onContextMenu}
          allowedSelectionTypes={allowedSelectionTypes}
          onSelectAsTarget={onSelectAsTarget}
        />
      ))}
    </div>
  );
}
