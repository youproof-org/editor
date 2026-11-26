export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PopupPlacement {
  top: number;
  left: number;
  side: 'below' | 'above';
  /** Set when the popup is taller than the room on its side, which it then scrolls in. */
  maxHeight?: number;
  /** Set when the popup is wider than the pane. */
  maxWidth?: number;
}

export const POPUP_MARGIN = 8;
const GAP = 2;

/** The smallest rectangle around all of `rects`: a token wrapped over two lines counts as both its line boxes. */
export function unionRect(rects: readonly Rect[]): Rect {
  return {
    top: Math.min(...rects.map((r) => r.top)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
    left: Math.min(...rects.map((r) => r.left)),
    right: Math.max(...rects.map((r) => r.right)),
  };
}

export function intersectRects(a: Rect, b: Rect): Rect {
  return { top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom), left: Math.max(a.left, b.left), right: Math.min(a.right, b.right) };
}

/** Whether any of the anchor is inside the pane; a popup whose anchor has left it closes. */
export function anchorInPane(anchorRects: readonly Rect[], pane: Rect): boolean {
  if (anchorRects.length === 0) return false;
  const anchor = unionRect(anchorRects);
  return anchor.bottom > pane.top && anchor.top < pane.bottom;
}

/**
 * Where the reference popup goes so that it never covers its anchor: below it and
 * left-aligned with it, else above it, else on the side with more room, scrolling
 * inside. It is shifted sideways to stay in the pane, which can't move it over the
 * anchor, since it sits wholly above or below the anchor's lines.
 */
export function placeReferencePopup(
  anchorRects: readonly Rect[], popup: { width: number; height: number }, pane: Rect,
): PopupPlacement {
  const anchor = unionRect(anchorRects);
  const below = pane.bottom - POPUP_MARGIN - (anchor.bottom + GAP);
  const above = anchor.top - GAP - (pane.top + POPUP_MARGIN);
  const side = popup.height <= below ? 'below' : popup.height <= above ? 'above' : below >= above ? 'below' : 'above';
  const room = Math.max(0, side === 'below' ? below : above);
  const height = Math.min(popup.height, room);
  const top = side === 'below' ? anchor.bottom + GAP : anchor.top - GAP - height;

  const paneWidth = pane.right - pane.left - 2 * POPUP_MARGIN;
  const width = Math.min(popup.width, paneWidth);
  const left = Math.max(pane.left + POPUP_MARGIN, Math.min(anchor.left, pane.right - POPUP_MARGIN - width));
  return {
    top, left, side,
    ...(height < popup.height ? { maxHeight: height } : {}),
    ...(width < popup.width ? { maxWidth: width } : {}),
  };
}
