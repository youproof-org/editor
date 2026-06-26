import ListBlockImpl, { ListItemCM } from './ListBlockImpl';
import type { ContentOrderedListBlock } from '../../shared/types';

interface Props {
  block: ContentOrderedListBlock;
  onBlockChange: (updated: ContentOrderedListBlock) => void;
}

export default function OrderedListBlock({ block, onBlockChange }: Props) {
  return (
    <ListBlockImpl
      leadIn={block.leadIn}
      onLeadInChange={v => onBlockChange({ ...block, leadIn: v })}
      items={block.items}
      onItemsChange={items => onBlockChange({ ...block, items })}
      marker={i => `${i + 1}.`}
      renderItem={(p, ref) => <ListItemCM ref={ref} {...p} />}
    />
  );
}
