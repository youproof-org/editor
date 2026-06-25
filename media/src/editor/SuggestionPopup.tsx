import { ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface AnchorRect {
  top:    number;
  bottom: number;
  left:   number;
  right:  number;
}

interface Props<T> {
  items:            T[];
  selectedIdx:      number | null;
  getKey:           (item: T) => string;
  renderItem:       (item: T, isSelected: boolean) => ReactNode;
  renderContainer?: (items: ReactNode) => ReactNode;
  anchorRect:       AnchorRect;
  preferred?:       'above' | 'below';
  onPick:           (item: T) => void;
  selectedItemRef:  React.RefObject<HTMLDivElement | null>;
}

const MARGIN = 8;

function placePopup(
  anchor: AnchorRect,
  popup:  { w: number; h: number },
  preferred: 'above' | 'below',
): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const fitsAbove = anchor.top    - popup.h - MARGIN >= 0;
  const fitsBelow = anchor.bottom + popup.h + MARGIN <= vh;
  const placeAbove = preferred === 'above' ? (fitsAbove || !fitsBelow) : !fitsBelow;

  let top = placeAbove ? anchor.top - popup.h : anchor.bottom;
  top = Math.max(MARGIN, Math.min(vh - popup.h - MARGIN, top));

  const anchorCenter = (anchor.left + anchor.right) / 2;
  const idealLeft    = anchorCenter - popup.w / 2;
  const left         = Math.max(MARGIN, Math.min(vw - popup.w - MARGIN, idealLeft));

  return { top, left };
}

export default function SuggestionPopup<T>({
  items, selectedIdx, getKey, renderItem, renderContainer, anchorRect, preferred = 'above', onPick, selectedItemRef,
}: Props<T>) {
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; ready: boolean }>(() => ({
    top:   anchorRect.top,
    left:  anchorRect.left,
    ready: false,
  }));

  useLayoutEffect(() => {
    if (!popupRef.current) return;
    const rect = popupRef.current.getBoundingClientRect();
    const { top, left } = placePopup(anchorRect, { w: rect.width, h: rect.height }, preferred);
    setCoords({ top, left, ready: true });
  }, [anchorRect.top, anchorRect.bottom, anchorRect.left, anchorRect.right, preferred, items.length]);

  // Reposition on viewport resize.
  useLayoutEffect(() => {
    const onResize = () => {
      if (!popupRef.current) return;
      const rect = popupRef.current.getBoundingClientRect();
      const { top, left } = placePopup(anchorRect, { w: rect.width, h: rect.height }, preferred);
      setCoords({ top, left, ready: true });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [anchorRect.top, anchorRect.bottom, anchorRect.left, anchorRect.right, preferred]);

  const itemEls = (
    <>
      {items.map((item, i) => (
        <div
          key={getKey(item)}
          ref={i === selectedIdx ? selectedItemRef : null}
          className={`ref-display-suggestion-item${i === selectedIdx ? ' ref-display-suggestion-item--selected' : ''}`}
          onMouseDown={e => { e.preventDefault(); onPick(item); }}
        >
          {renderItem(item, i === selectedIdx)}
        </div>
      ))}
    </>
  );

  return createPortal(
    <div
      ref={popupRef}
      className="ref-display-suggestions"
      style={{
        top:        coords.top,
        left:       coords.left,
        visibility: coords.ready ? 'visible' : 'hidden',
      }}
    >
      {renderContainer ? renderContainer(itemEls) : itemEls}
    </div>,
    document.body,
  );
}
