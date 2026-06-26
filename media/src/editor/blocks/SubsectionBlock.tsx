import BlockSequence from './BlockSequence';
import Field from './Field';
import type { ContentSubsectionBlock } from '../../shared/types';

interface Props {
  block: ContentSubsectionBlock;
  onBlockChange: (updated: ContentSubsectionBlock) => void;
}

export default function SubsectionBlock({ block, onBlockChange }: Props) {
  return (
    <>
      <Field label="Title">
        <input className="field-input" value={block.title}
          onChange={e => onBlockChange({ ...block, title: e.target.value })} />
      </Field>
      <BlockSequence blocks={block.blocks}
        onChange={blocks => onBlockChange({ ...block, blocks })} />
    </>
  );
}
