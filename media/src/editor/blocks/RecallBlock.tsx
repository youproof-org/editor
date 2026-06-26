import type { ContentRecallBlock } from '../../shared/types';

interface Props {
  block: ContentRecallBlock;
  onBlockChange: (updated: ContentRecallBlock) => void;
}

export default function RecallBlock({ block }: Props) {
  return <div className="block-meta">{block.targetType}: {block.targetId}</div>;
}
