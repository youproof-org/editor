import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Params<T> {
  typed:        string;
  fetchItems:   (() => Promise<T[]>) | null;
  getKey:       (item: T) => string;
  getMatchText: (item: T) => string;
  onCommit:     (item: T) => void;
  /** If false, items are displayed in fetcher order (no internal filter/sort). Defaults to true. */
  filterAndSort?: boolean;
}

export interface UseSuggestionPopupReturn<T> {
  active:          boolean;
  displayed:       T[];
  selectedIdx:     number | null;
  open:            () => void;
  close:           () => void;
  onTyped:         () => void;
  handleKeyDown:   (e: KeyboardEvent | React.KeyboardEvent) => 'consumed' | 'ignored';
  // Standalone navigation actions (return true when consumed). Useful for CodeMirror keymaps.
  navigateUp:     () => boolean;
  navigateDown:   () => boolean;
  escape:         () => boolean;
  commitSelected: () => boolean;
  selectedItemRef: React.RefObject<HTMLDivElement | null>;
}

export function useSuggestionPopup<T>(params: Params<T>): UseSuggestionPopupReturn<T> {
  const { typed, fetchItems, getKey, getMatchText, onCommit, filterAndSort = true } = params;

  const [active,      setActive]      = useState(false);
  const [items,       setItems]       = useState<T[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const fetchIdRef      = useRef(0);
  const selectedItemRef = useRef<HTMLDivElement | null>(null);

  const lowerTyped = typed.toLowerCase();

  const displayed = useMemo(() => {
    if (!active) return [];
    if (!filterAndSort) return items;
    if (!lowerTyped) return items;
    const starts: T[] = [];
    const contains: T[] = [];
    for (const it of items) {
      const m = getMatchText(it).toLowerCase();
      if (m.startsWith(lowerTyped)) starts.push(it);
      else if (m.includes(lowerTyped)) contains.push(it);
    }
    const cmp = (a: T, b: T) => getMatchText(a).localeCompare(getMatchText(b));
    starts.sort(cmp);
    contains.sort(cmp);
    return [...starts, ...contains];
  }, [active, items, lowerTyped, getMatchText, filterAndSort]);

  // Keep selection in range when filtering changes the list.
  useEffect(() => {
    if (selectedIdx === null) return;
    if (selectedIdx >= displayed.length) setSelectedIdx(null);
  }, [displayed.length, selectedIdx]);

  useEffect(() => {
    if (selectedIdx === null) return;
    // display:contents elements have no box, so scrollIntoView is a no-op on
    // them. The table-mode popup applies display:contents to the item wrapper
    // and the row so cell children participate directly in the popup grid;
    // walk down to the first descendant that actually renders a box.
    let el: HTMLElement | null = selectedItemRef.current;
    while (el && getComputedStyle(el).display === 'contents') {
      el = el.firstElementChild as HTMLElement | null;
    }
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  const open = useCallback(() => {
    if (!fetchItems) return;
    setActive(true);
    const id = ++fetchIdRef.current;
    fetchItems()
      .then(list => { if (fetchIdRef.current === id) setItems(list); })
      .catch(() => {});
  }, [fetchItems]);

  const close = useCallback(() => {
    setActive(false);
    setItems([]);
    setSelectedIdx(null);
    fetchIdRef.current++;
  }, []);

  const onTyped = useCallback(() => {
    setSelectedIdx(null);
  }, []);

  const navigateUp = useCallback((): boolean => {
    if (!active || displayed.length === 0) return false;
    setSelectedIdx(prev => (prev === null || prev === 0) ? displayed.length - 1 : prev - 1);
    return true;
  }, [active, displayed.length]);

  const navigateDown = useCallback((): boolean => {
    if (!active || displayed.length === 0) return false;
    setSelectedIdx(prev => (prev === null || prev >= displayed.length - 1) ? 0 : prev + 1);
    return true;
  }, [active, displayed.length]);

  const escape = useCallback((): boolean => {
    if (!active || selectedIdx === null) return false;
    setSelectedIdx(null);
    return true;
  }, [active, selectedIdx]);

  const commitSelected = useCallback((): boolean => {
    if (!active || selectedIdx === null || selectedIdx >= displayed.length) return false;
    onCommit(displayed[selectedIdx]);
    setSelectedIdx(null);
    return true;
  }, [active, displayed, selectedIdx, onCommit]);

  const handleKeyDown = useCallback((e: KeyboardEvent | React.KeyboardEvent): 'consumed' | 'ignored' => {
    if (!active || displayed.length === 0) return 'ignored';
    if (e.key === 'ArrowDown') { e.preventDefault(); navigateDown(); return 'consumed'; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); navigateUp();   return 'consumed'; }
    if (e.key === 'Escape')    { if (escape())         { e.preventDefault(); return 'consumed'; } return 'ignored'; }
    if (e.key === 'Enter')     { if (commitSelected()) { e.preventDefault(); return 'consumed'; } return 'ignored'; }
    return 'ignored';
  }, [active, displayed.length, navigateUp, navigateDown, escape, commitSelected]);

  // No-op statement to silence unused-warning for getKey when consumer doesn't use it.
  void getKey;

  return {
    active, displayed, selectedIdx,
    open, close, onTyped,
    handleKeyDown, navigateUp, navigateDown, escape, commitSelected,
    selectedItemRef,
  };
}
