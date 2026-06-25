import TreeNodeView from './TreeNodeView';
import type { ContentTreeItem } from '../shared/types';

interface Props {
  nodes:                 ContentTreeItem[];
  expanded:              Set<string>;
  onToggle:              (id: string) => void;
  selectedId:            string | null;
  onContextMenu:         (node: ContentTreeItem, e: React.MouseEvent) => void;
  allowedSelectionTypes: string[] | null;
  onSelectAsTarget:      (node: ContentTreeItem) => void;
}

export default function TreePanel({ nodes, expanded, onToggle, selectedId, onContextMenu, allowedSelectionTypes, onSelectAsTarget }: Props) {
  return (
    <section className={`panel-section${allowedSelectionTypes !== null ? ' panel-section--selecting' : ''}`}>
      <div className="tree-scroll">
        {nodes.length === 0 && <p className="msg">No content found.</p>}
        {nodes.map(node => (
          <TreeNodeView
            key={node.id}
            node={node}
            expanded={expanded}
            onToggle={onToggle}
            depth={0}
            selectedId={selectedId}
            onContextMenu={onContextMenu}
            allowedSelectionTypes={allowedSelectionTypes}
            onSelectAsTarget={onSelectAsTarget}
          />
        ))}
      </div>
    </section>
  );
}
