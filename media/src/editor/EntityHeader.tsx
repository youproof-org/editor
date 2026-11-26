import { useClient } from '../shared/clientContext';
import { badgeChar } from './Badge';
import EntityLabelPicker, { EntityLabelHints, type EntityLabelProps } from './EntityLabelPicker';
import { useTermEditingContext } from './contexts/TermEditingContext';
import type { OpenContentObjectFileRequest } from '../shared/types';

interface Props {
  nodeId: string;
  type:   string;
  title:  string;
  isDirty: boolean;
  entityLabel?: EntityLabelProps;
  hasReferencesDictionary: boolean;
}

export default function EntityHeader({ nodeId, type, title, isDirty, entityLabel, hasReferencesDictionary }: Props) {
  const client = useClient();
  const { onLabelChange } = useTermEditingContext();
  const badge = badgeChar(type);
  return (
    <>
      <div className="entity-header">
        <span className={`entity-badge badge-${type}`}>{badge}</span>
        <span className="entity-title">{title}</span>
        {isDirty && <span className="entity-dirty">●</span>}
      </div>
      {entityLabel && <EntityLabelPicker {...entityLabel} onChange={onLabelChange} />}
      {entityLabel && <EntityLabelHints {...entityLabel} />}
      {hasReferencesDictionary && (
        <div className="field-hint">
          This file still has a <code>references</code> dictionary, which the site no longer accepts. Saving is
          refused until it is converted to a list in the YAML file and the content is reloaded.
        </div>
      )}
      <button
        className="open-file-btn"
        onClick={() => client.request('openContentObjectFile', { id: nodeId } as OpenContentObjectFileRequest).catch(console.error)}
      >
        Open YAML file
      </button>
    </>
  );
}
