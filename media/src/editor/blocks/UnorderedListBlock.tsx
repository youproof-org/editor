import ListBlockImpl, { ListItemCM } from './ListBlockImpl';
import type { ContentUnorderedListBlock } from '../../shared/types';

interface Props {
  block: ContentUnorderedListBlock;
  onBlockChange: (updated: ContentUnorderedListBlock) => void;
}

export default function UnorderedListBlock({ block, onBlockChange }: Props) {
  return (
    <ListBlockImpl
      leadIn={block.leadIn}
      onLeadInChange={v => onBlockChange({ ...block, leadIn: v })}
      items={block.items}
      onItemsChange={items => onBlockChange({ ...block, items })}
      marker={() => '•'}
      renderItem={(p, ref) => <ListItemCM ref={ref} {...p} />}
    />
  );
}
