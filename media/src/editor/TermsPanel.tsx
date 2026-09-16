import { useState, useEffect, useRef } from 'react';
import type { ContentTerm } from '../shared/types';
import { deriveSlugFromCanonical, isValidSlug } from '../shared/slug';
import StringListEditor from './StringListEditor';

interface Props {
  terms: ContentTerm[];
  onTermChange: (updated: ContentTerm) => void;
  highlightedName?: string | null;
  onInsert?: (name: string) => void;
  onSelect?: (termId: string) => void;
}

export default function TermsPanel({ terms, onTermChange, highlightedName, onInsert, onSelect }: Props) {
  const [colWidths, setColWidths] = useState<(number | null)[]>([null, null, null, null]);
  const resizeState       = useRef<{ col: 0 | 1 | 2 | 3; startX: number; startW: number } | null>(null);
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
          {colWidths.map((w, i) => (
            <col key={i} style={w != null ? { width: w } : undefined} />
          ))}
          <col />
        </colgroup>
        <thead>
          <tr>
            <th className="refs-table-th--icon" />
            {(['Name', 'Slug', 'Display', 'Canonical'] as const).map((label, i) => (
              <th key={label}>{label}<span className="col-resizer"
                onMouseDown={e => {
                  e.preventDefault();
                  const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
                  const startW = colWidths[i] ?? th.getBoundingClientRect().width;
                  resizeState.current = { col: i as 0 | 1 | 2 | 3, startX: e.clientX, startW };
                }}
                onDoubleClick={e => { e.preventDefault(); setColWidths(prev => { const next = [...prev]; next[i] = null; return next; }); }} /></th>
            ))}
            <th>Synonyms</th>
          </tr>
        </thead>
        <tbody>
          {terms.map(term => {
            const isDup = terms.filter(t => t.name === term.name).length > 1;
            // Anchors collide on the EFFECTIVE slug, since a term with none is
            // cited by its key — the same rule the site build applies, so the
            // editor flags exactly what a save would be refused for.
            const anchor    = term.slug || term.name;
            const anchorDup = terms.filter(t => (t.slug || t.name) === anchor).length > 1;
            const slugState =
              anchorDup                       ? 'invalid'
              : term.slug === ''              ? 'warn'
              : !isValidSlug(term.slug)       ? 'invalid'
              : 'ok';
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
                    className={`ref-input${slugState === 'ok' ? '' : ` ref-input--${slugState}`}`}
                    value={term.slug}
                    placeholder={deriveSlugFromCanonical(term.canonical)}
                    title={
                      slugState === 'warn'
                        ? `No slug — this term is cited in English, as fogalmak.${term.name}.`
                        : slugState === 'invalid'
                          ? 'Not a usable anchor: it must be lowercase kebab-case and unique on this node. Saving is blocked until it is.'
                          : undefined
                    }
                    onChange={e => onTermChange({ ...term, slug: e.target.value })}
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
                    onChange={e => {
                      const canonical = e.target.value;
                      // Keep the slug in step with `canonical` while it is still
                      // the derived value — and stop the moment it is not. The
                      // test is stateless on purpose: comparing against the
                      // derivation of the PREVIOUS canonical distinguishes "never
                      // filled in" and "auto-filled" from "written by hand"
                      // without tracking which fields have been touched, so it
                      // survives a remount and a reload.
                      const derived = term.slug === '' || term.slug === deriveSlugFromCanonical(term.canonical);
                      onTermChange({
                        ...term,
                        canonical,
                        slug: derived ? deriveSlugFromCanonical(canonical) : term.slug,
                      });
                    }}
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
