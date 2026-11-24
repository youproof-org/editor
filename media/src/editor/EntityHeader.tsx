import { useClient } from '../shared/clientContext';
import { badgeChar } from './Badge';
import EntityLabelPicker, { EntityLabelHints, type EntityLabelProps } from './EntityLabelPicker';
import { useRefTermEditingContext } from './contexts/RefTermEditingContext';
import type { OpenContentObjectFileRequest } from '../shared/types';

interface Props {
  nodeId: string;
  type:   string;
  title:  string;
  isDirty: boolean;
  entityLabel?: EntityLabelProps;
}

export default function EntityHeader({ nodeId, type, title, isDirty, entityLabel }: Props) {
  const client = useClient();
  const { onLabelChange } = useRefTermEditingContext();
  const badge = badgeChar(type);
  return (
    <>
      <div className="entity-header">
        <span className={`entity-badge badge-${type}`}>{badge}</span>
        <span className="entity-title">{title}</span>
        {entityLabel && <EntityLabelPicker {...entityLabel} onChange={onLabelChange} />}
        {isDirty && <span className="entity-dirty">●</span>}
      </div>
      {entityLabel && <EntityLabelHints {...entityLabel} />}
      <button
        className="open-file-btn"
        onClick={() => client.request('openContentObjectFile', { id: nodeId } as OpenContentObjectFileRequest).catch(console.error)}
      >
        Open YAML file
      </button>
    </>
  );
}
