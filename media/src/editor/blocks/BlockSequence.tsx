import { Fragment } from 'react';
import BlockView from '../BlockView';
import InsertionSlot from './InsertionSlot';
import { useBlockOpsContext } from '../contexts/BlockOpsContext';
import type { ContentBlock } from '../../shared/types';

interface Props {
  blocks:   ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
}

export default function BlockSequence({ blocks, onChange }: Props) {
  const { prepareLayoutAnimation } = useBlockOpsContext();
  const insertAt = (i: number, b: ContentBlock) => {
    prepareLayoutAnimation();
    onChange([...blocks.slice(0, i), b, ...blocks.slice(i)]);
  };
  const updateAt = (b: ContentBlock) => onChange(blocks.map(x => x.id === b.id ? b : x));
  return (
    <>
      <InsertionSlot onInsert={(b) => insertAt(0, b)} />
      {blocks.map((block, i) => (
        <Fragment key={block.id}>
          <BlockView block={block} onBlockChange={updateAt} />
          <InsertionSlot onInsert={(b) => insertAt(i + 1, b)} />
        </Fragment>
      ))}
    </>
  );
}
