import TargetSelector from '../TargetSelector';
import Field from './Field';
import { useTargetSelectionContext } from '../contexts/TargetSelectionContext';
import type { ContentEmbedBlock } from '../../shared/types';

const EMBED_ALLOWED_TYPES = ['definition', 'theorem', 'proof', 'remark'];

interface Props {
  block: ContentEmbedBlock;
  onBlockChange: (updated: ContentEmbedBlock) => void;
}

export default function EmbedBlock({ block, onBlockChange }: Props) {
  const { targetObjects, selectingSelectorId, onBeginSelectTarget, onEndSelectTarget, onOpenTarget } =
    useTargetSelectionContext();
  const target = block.targetId ? targetObjects[block.targetId] : undefined;

  return (
    <>
    <Field label="Show title">
      <div className="embed-target-field">
        <input type="checkbox"
          checked={!!block.showTitle}
          onChange={e => onBlockChange({ ...block, showTitle: e.target.checked ? true : undefined })} />
      </div>
    </Field>
    <Field label="Target">
      <div className="embed-target-field">
      <TargetSelector
        target={target}
        allowedTypes={EMBED_ALLOWED_TYPES}
        settingUrl={false}
        selectingTarget={selectingSelectorId === block.id}
        anySelecting={selectingSelectorId !== null}
        onBeginSelectTarget={() => onBeginSelectTarget(block.id, EMBED_ALLOWED_TYPES)}
        onEndSelectTarget={r => onEndSelectTarget(r)}
        onSetUrl={() => {/* unreachable: 'external' not in allowedTypes */}}
        onClearTarget={() => onBlockChange({ ...block, targetType: '', targetId: '' })}
        onStartSettingUrl={() => {/* unreachable */}}
        onOpenTarget={() => onOpenTarget(block.targetId, block.targetType)}
      />
      </div>
    </Field>
    </>
  );
}
