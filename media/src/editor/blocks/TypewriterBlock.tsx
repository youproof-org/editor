import ListBlockImpl, { ListItemInput } from './ListBlockImpl';
import type { ContentTypewriterBlock } from '../../shared/types';

interface Props {
  block: ContentTypewriterBlock;
  onBlockChange: (updated: ContentTypewriterBlock) => void;
}

export default function TypewriterBlock({ block, onBlockChange }: Props) {
  return (
    <ListBlockImpl
      leadIn={block.leadIn}
      onLeadInChange={v => onBlockChange({ ...block, leadIn: v })}
      items={block.rows}
      onItemsChange={rows => onBlockChange({ ...block, rows })}
      renderItem={(p, ref) => <ListItemInput ref={ref} {...p} />}
    />
  );
}
