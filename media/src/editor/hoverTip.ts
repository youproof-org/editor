/** How long the pointer rests on an element before its tip shows, well under the browser's delay for a native `title`. */
export const HOVER_TIP_DELAY = 120;

/**
 * Show the `data-tip` of the element under the pointer as a tooltip once the
 * pointer has rested on it for `delay` ms, below the element, or above it where
 * the viewport has no room below. A press, a key or a scroll hides it.
 */
export function installHoverTips(doc: Document = document, delay = HOVER_TIP_DELAY): () => void {
  const tip = doc.createElement('div');
  tip.className = 'yp-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  doc.body.append(tip);
  let anchor: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hide = () => {
    clearTimeout(timer);
    anchor = null;
    tip.hidden = true;
  };
  const show = (element: HTMLElement) => {
    if (!element.isConnected) return;
    tip.textContent = element.dataset.tip ?? '';
    tip.hidden = false;
    const view = doc.defaultView!;
    const box = element.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const below = box.bottom + 4;
    tip.style.top = `${below + height <= view.innerHeight ? below : Math.max(0, box.top - 4 - height)}px`;
    tip.style.left = `${Math.max(4, Math.min(box.left, view.innerWidth - width - 4))}px`;
  };
  const onOver = (event: MouseEvent) => {
    const element = (event.target as Element | null)?.closest?.<HTMLElement>('[data-tip]') ?? null;
    if (element === anchor) return;
    hide();
    if (!element || !element.dataset.tip) return;
    anchor = element;
    timer = setTimeout(() => show(element), delay);
  };
  const onOut = (event: MouseEvent) => {
    if (anchor && !(event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget))) hide();
  };

  doc.addEventListener('mouseover', onOver);
  doc.addEventListener('mouseout', onOut);
  doc.addEventListener('mousedown', hide, true);
  doc.addEventListener('keydown', hide, true);
  doc.addEventListener('scroll', hide, true);
  return () => {
    hide();
    tip.remove();
    doc.removeEventListener('mouseover', onOver);
    doc.removeEventListener('mouseout', onOut);
    doc.removeEventListener('mousedown', hide, true);
    doc.removeEventListener('keydown', hide, true);
    doc.removeEventListener('scroll', hide, true);
  };
}
