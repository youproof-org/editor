import { useClient } from '../shared/clientContext';
import { badgeChar } from './Badge';
import type { OpenContentObjectFileRequest } from '../shared/types';

interface Props {
  nodeId: string;
  type:   string;
  title:  string;
  isDirty: boolean;
}

export default function EntityHeader({ nodeId, type, title, isDirty }: Props) {
  const client = useClient();
  const badge = badgeChar(type);
  return (
    <>
      <div className="entity-header">
        <span className={`entity-badge badge-${type}`}>{badge}</span>
        <span className="entity-title">{title}</span>
        {isDirty && <span className="entity-dirty">●</span>}
      </div>
      <button
        className="open-file-btn"
        onClick={() => client.request('openContentObjectFile', { id: nodeId } as OpenContentObjectFileRequest).catch(console.error)}
      >
        Open YAML file
      </button>
    </>
  );
}
