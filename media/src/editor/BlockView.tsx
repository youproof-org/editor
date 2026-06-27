import { useRef, useEffect, useState } from 'react';
import { useSelectionContext } from './contexts/SelectionContext';
import { useBlockOpsContext } from './contexts/BlockOpsContext';
import NarrativeBlock     from './blocks/NarrativeBlock';
import FormulaBlock       from './blocks/FormulaBlock';
import ClaimBlock         from './blocks/ClaimBlock';
import OrderedListBlock   from './blocks/OrderedListBlock';
import UnorderedListBlock from './blocks/UnorderedListBlock';
import TypewriterBlock    from './blocks/TypewriterBlock';
import QuoteBlock         from './blocks/QuoteBlock';
import FigureBlock        from './blocks/FigureBlock';
import SubsectionBlock    from './blocks/SubsectionBlock';
import DetailsBlock       from './blocks/DetailsBlock';
import EmbedBlock         from './blocks/EmbedBlock';
import RecallBlock        from './blocks/RecallBlock';
import type { ContentBlock, ContentClaimBlock } from '../shared/types';

interface Props {
  block: ContentBlock;
  onBlockChange: (updated: ContentBlock) => void;
}

const HEADER_LABEL: Record<ContentBlock['blockType'], (b: ContentBlock) => string> = {
  narrative:        () => 'Narrative Block',
  formula:          () => 'Formula Block',
  figure:           () => 'Figure Block',
  embed:            () => 'Embed Block',
  claim:            (b) => `§ Claim Block - ${(b as ContentClaimBlock).name}`,
  'ordered-list':   () => 'Ordered List Block',
  'unordered-list': () => 'Unordered List Block',
  typewriter:       () => 'Typewriter Block',
  quote:            () => 'Quote Block',
  subsection:       () => 'Subsection Block',
  details:          () => 'Details Block',
  recall:           () => 'Recall Block',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BLOCK_COMPONENT: Record<ContentBlock['blockType'], React.ComponentType<{ block: any; onBlockChange: any }>> = {
  narrative:        NarrativeBlock,
  formula:          FormulaBlock,
  figure:           FigureBlock,
  embed:            EmbedBlock,
  claim:            ClaimBlock,
  'ordered-list':   OrderedListBlock,
  'unordered-list': UnorderedListBlock,
  typewriter:       TypewriterBlock,
  quote:            QuoteBlock,
  subsection:       SubsectionBlock,
  details:          DetailsBlock,
  recall:           RecallBlock,
};

export default function BlockView({ block, onBlockChange }: Props) {
  const { selectedId, onSelectBlock }                  = useSelectionContext();
  const { moveBlock, canMoveBlock, deleteBlock }       = useBlockOpsContext();
  const blockRef = useRef<HTMLDivElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (selectedId === block.id) blockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedId, block.id]);

  const Body = BLOCK_COMPONENT[block.blockType];

  return (
    <div ref={blockRef} className="block" data-block-id={block.id}
      onFocus={e => { e.stopPropagation(); onSelectBlock(block.id, block.blockType); }}>
      <div className="block-header">
        <div className="block-header-label">{HEADER_LABEL[block.blockType](block)}</div>
        <div className="block-header-actions">
          {confirmingDelete ? (
            <>
              <span className="block-action-label">Delete?</span>
              <button className="block-action-btn block-action-btn--confirm"
                onClick={() => { deleteBlock(block.id); setConfirmingDelete(false); }}>Yes</button>
              <button className="block-action-btn"
                onClick={() => setConfirmingDelete(false)}>No</button>
            </>
          ) : (
            <>
              {canMoveBlock(block.id, 'up') && (
                <button className="block-action-btn" title="Move up"
                  onClick={() => moveBlock(block.id, 'up')}>▲</button>
              )}
              {canMoveBlock(block.id, 'down') && (
                <button className="block-action-btn" title="Move down"
                  onClick={() => moveBlock(block.id, 'down')}>▼</button>
              )}
              <button className="block-action-btn" title="Delete"
                onClick={() => setConfirmingDelete(true)}>✕</button>
            </>
          )}
        </div>
      </div>
      <div className="block-content">
        <Body block={block} onBlockChange={onBlockChange} />
      </div>
    </div>
  );
}
