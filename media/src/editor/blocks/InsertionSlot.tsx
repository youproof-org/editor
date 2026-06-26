import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CREATABLE_BLOCK_TYPES, createEmptyBlock, type CreatableBlockType } from './createBlock';
import type { ContentBlock } from '../../shared/types';

interface Props {
  onInsert: (block: ContentBlock) => void;
}

export default function InsertionSlot({ onInsert }: Props) {
  const [hovering,  setHovering]  = useState(false);
  const [popupPos,  setPopupPos]  = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popupOpen = popupPos !== null;
  const expanded  = hovering || popupOpen;

  const closePopup = () => { setPopupPos(null); setHovering(false); };

  const openPopup = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setPopupPos({ top: rect.top + rect.height / 2, left: rect.right + 4 });
  };

  const choose = (type: CreatableBlockType) => {
    onInsert(createEmptyBlock(type));
    closePopup();
  };

  return (
    <div className={`insertion-slot${expanded ? ' insertion-slot--expanded' : ''}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => { if (!popupOpen) setHovering(false); }}>
      {expanded && (
        <button ref={buttonRef} className="insertion-btn"
          onClick={openPopup}>+</button>
      )}
      {popupOpen && createPortal(
        <>
          <div className="popup-backdrop"
            onMouseDown={e => { e.preventDefault(); closePopup(); }} />
          <div className="block-type-popup"
            style={{ top: popupPos.top, left: popupPos.left }}>
            {CREATABLE_BLOCK_TYPES.map(({ type, label }) => (
              <button key={type} className="block-type-popup-item"
                onClick={() => choose(type)}>{label}</button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
