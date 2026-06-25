import { useState, useEffect, useRef } from 'react';
import type { ContentTerm } from '../shared/types';
import StringListEditor from './StringListEditor';

interface Props {
  terms: ContentTerm[];
  onTermChange: (updated: ContentTerm) => void;
  highlightedName?: string | null;
  onInsert?: (name: string) => void;
  onSelect?: (termId: string) => void;
}

export default function TermsPanel({ terms, onTermChange, highlightedName, onInsert, onSelect }: Props) {
  const [colWidths, setColWidths] = useState<(number | null)[]>([null, null, null]);
  const resizeState       = useRef<{ col: 0 | 1 | 2; startX: number; startW: number } | null>(null);
  const highlightedRowRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    highlightedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [highlightedName]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const rs = resizeState.current;
      if (!rs) return;
      setColWidths(prev => {
        const next = [...prev];
        next[rs.col] = Math.max(50, rs.startW + (e.clientX - rs.startX));
        return next;
      });
    };
    const onUp = () => { resizeState.current = null; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
  }, []);

  return (
    <>
      <table className="refs-table refs-table--terms">
        <colgroup>
          <col style={{ width: 28 }} />
          <col style={colWidths[0] != null ? { width: colWidths[0] } : undefined} />
          <col style={colWidths[1] != null ? { width: colWidths[1] } : undefined} />
          <col style={colWidths[2] != null ? { width: colWidths[2] } : undefined} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th className="refs-table-th--icon" />
            <th>Name<span className="col-resizer"
              onMouseDown={e => {
                e.preventDefault();
                const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
                const startW = colWidths[0] ?? th.getBoundingClientRect().width;
                resizeState.current = { col: 0, startX: e.clientX, startW };
              }}
              onDoubleClick={e => { e.preventDefault(); setColWidths(prev => { const next = [...prev]; next[0] = null; return next; }); }} /></th>
            <th>Display<span className="col-resizer"
              onMouseDown={e => {
                e.preventDefault();
                const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
                const startW = colWidths[1] ?? th.getBoundingClientRect().width;
                resizeState.current = { col: 1, startX: e.clientX, startW };
              }}
              onDoubleClick={e => { e.preventDefault(); setColWidths(prev => { const next = [...prev]; next[1] = null; return next; }); }} /></th>
            <th>Canonical<span className="col-resizer"
              onMouseDown={e => {
                e.preventDefault();
                const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
                const startW = colWidths[2] ?? th.getBoundingClientRect().width;
                resizeState.current = { col: 2, startX: e.clientX, startW };
              }}
              onDoubleClick={e => { e.preventDefault(); setColWidths(prev => { const next = [...prev]; next[2] = null; return next; }); }} /></th>
            <th>Synonyms</th>
          </tr>
        </thead>
        <tbody>
          {terms.map(term => {
            const isDup = terms.filter(t => t.name === term.name).length > 1;
            return (
              <tr key={term.id}
                ref={term.name === highlightedName ? highlightedRowRef : null}
                className={term.name === highlightedName ? 'ref-row--active' : undefined}
                onFocus={() => onSelect?.(term.id)}
                onClick={() => onSelect?.(term.id)}>
                <td className="refs-table-td--icon"><button className="row-insert-btn term-row-icon" onClick={() => onInsert?.(term.name)}>★</button></td>
                <td>
                  <input
                    className={`ref-input${isDup ? ' ref-input--dup' : ''}`}
                    value={term.name}
                    onChange={e => {
                      const v = e.target.value;
                      if (!v) return;
                      if (terms.some(t2 => t2.id !== term.id && t2.name === v)) return;
                      onTermChange({ ...term, name: v });
                    }}
                  />
                </td>
                <td>
                  <input
                    className="ref-input"
                    value={term.display}
                    onChange={e => onTermChange({ ...term, display: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="ref-input"
                    value={term.canonical}
                    onChange={e => onTermChange({ ...term, canonical: e.target.value })}
                  />
                </td>
                <td>
                  <StringListEditor
                    items={term.synonyms}
                    onChange={items => onTermChange({ ...term, synonyms: items })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
