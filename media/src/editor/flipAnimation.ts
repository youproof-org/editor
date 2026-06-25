export function captureBlockRects(): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>();
  document.querySelectorAll<HTMLElement>('[data-block-id]').forEach(el => {
    const id = el.dataset.blockId;
    if (id) map.set(id, el.getBoundingClientRect());
  });
  return map;
}

export function runFlipFromRects(oldRects: Map<string, DOMRect>): void {
  const newRects = captureBlockRects();
  document.querySelectorAll<HTMLElement>('[data-block-id]').forEach(el => {
    const id = el.dataset.blockId; if (!id) return;
    const o = oldRects.get(id); if (!o) return;
    const n = newRects.get(id); if (!n) return;
    const dx = o.left - n.left;
    const dy = o.top  - n.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

    el.style.transition = 'none';
    el.style.transform  = `translate(${dx}px, ${dy}px)`;
    void el.offsetHeight;

    requestAnimationFrame(() => {
      el.style.transition = 'transform 400ms ease';
      el.style.transform  = '';
      const onEnd = () => {
        el.style.transition = '';
        el.removeEventListener('transitionend', onEnd);
      };
      el.addEventListener('transitionend', onEnd);
    });
  });
}
