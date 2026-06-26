import { useLayoutEffect, useRef } from 'react';
import HighlightedText from './HighlightedText';
import Badge from './Badge';
import type { RefSuggestion } from '../shared/types';

interface Props {
  item:  RefSuggestion;
  typed: string;
}

export default function RefSuggestionRow({ item, typed }: Props) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  // When a cell's content is wider than its grid track, scroll the cell so the
  // highlighted match (rendered as <strong> by HighlightedText) is visible.
  // Done with scrollLeft += delta instead of scrollIntoView, so we don't scroll
  // the popup container too.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    for (const cell of Array.from(row.children) as HTMLElement[]) {
      const mark = cell.querySelector('strong') as HTMLElement | null;
      if (!mark) { cell.scrollLeft = 0; continue; }
      const cellRect = cell.getBoundingClientRect();
      const markRect = mark.getBoundingClientRect();
      if (markRect.left < cellRect.left) {
        cell.scrollLeft += markRect.left - cellRect.left - 4;
      } else if (markRect.right > cellRect.right) {
        cell.scrollLeft += markRect.right - cellRect.right + 4;
      }
    }
  }, [item.name, item.display, item.target.label, typed]);

  return (
    <div className={`ref-suggestion-row ref-suggestion-row--${item.source}`} ref={rowRef}>
      <span className="ref-suggestion-key">[<HighlightedText text={item.name} typed={typed} />]</span>
      <span className="ref-suggestion-display"><HighlightedText text={item.display} typed={typed} /></span>
      <span className="ref-suggestion-target">
        <Badge type={item.target.type} />
        <HighlightedText text={item.target.label} typed={typed} />
      </span>
    </div>
  );
}
