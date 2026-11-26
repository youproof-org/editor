import { RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { anchorInPane, intersectRects, placeReferencePopup, type PopupPlacement, type Rect } from '../referencePopupPlacement';
import { referencePopupField } from '../referencePopupState';

const asRect = (r: DOMRect | { top: number; bottom: number; left: number; right: number }): Rect =>
  ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });

/** The rectangles the popup must not cover: the highlighted token or the ghost, else the caret. */
function anchorRects(view: EditorView): Rect[] {
  const marked = view.contentDOM.querySelector('.cm-yp-ref-active, .cm-yp-ref-ghost');
  if (marked) {
    const rects = [...marked.getClientRects()].filter((r) => r.width > 0 || r.height > 0).map(asRect);
    if (rects.length > 0) return rects;
  }
  const session = view.state.field(referencePopupField, false);
  const caret = session ? view.coordsAtPos(session.from) : null;
  return caret ? [asRect(caret)] : [];
}

function paneRect(view: EditorView): Rect {
  const window_ = { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
  const pane = view.dom.closest('.node-view-content');
  return pane ? intersectRects(asRect(pane.getBoundingClientRect()), window_) : window_;
}

/**
 * Keeps the popup placed by `placeReferencePopup` while the text scrolls, the
 * window or the popup resizes, or the field redraws, at most once a frame. When its
 * anchor leaves the pane, or the field's popup has ended, `onLost` is called.
 */
export function useReferencePopupPlacement(
  popupRef: RefObject<HTMLDivElement>, view: EditorView, width: number, onLost: () => void,
): PopupPlacement | null {
  const [placement, setPlacement] = useState<PopupPlacement | null>(null);
  const onLostRef = useRef(onLost);
  onLostRef.current = onLost;

  const place = () => {
    const popup = popupRef.current;
    if (!popup) return;
    if (!view.dom.isConnected || !view.state.field(referencePopupField, false)) {
      onLostRef.current();
      return;
    }
    const anchor = anchorRects(view);
    const pane = paneRect(view);
    if (!anchorInPane(anchor, pane)) {
      onLostRef.current();
      return;
    }
    const next = placeReferencePopup(anchor, { width, height: popup.scrollHeight }, pane);
    setPlacement((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  useLayoutEffect(() => { placeRef.current(); });

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        placeRef.current();
      });
    };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const resized = new ResizeObserver(schedule);
    if (popupRef.current) resized.observe(popupRef.current);
    const redrawn = new MutationObserver(schedule);
    redrawn.observe(view.contentDOM, { childList: true, subtree: true, characterData: true, attributes: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      resized.disconnect();
      redrawn.disconnect();
    };
  }, [view]);

  return placement;
}
