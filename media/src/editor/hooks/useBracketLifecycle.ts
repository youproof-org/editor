import { Dispatch, SetStateAction, useCallback, useState } from 'react';
import { countSegments, getAllBlocksText } from '../bracketScan';
import { maskFormulas } from '../../shared/formula';
import type { BracketInfo } from '../contexts/BracketEditingContext';
import type { ContentObjectData } from '../../shared/types';

interface Params {
  setDraft:  Dispatch<SetStateAction<ContentObjectData | null>>;
  markDirty: () => void;
}

export function useBracketLifecycle({ setDraft, markDirty }: Params) {
  const [activeItem, setActiveItem] = useState<BracketInfo | null>(null);

  const handleBracketContentChange = useCallback((prev: BracketInfo | null, curr: BracketInfo) => {
    setDraft(d => {
      if (!d) return d;
      if (curr.type === 'ref') {
        if (prev === null) {
          if (d.references.find(r => r.name === curr.name)) return d;
          return { ...d, references: [...d.references, { id: crypto.randomUUID(), name: curr.name, display: '' }] };
        }
        const prevEntry      = d.references.find(r => r.name === prev.name);
        const currEntry      = d.references.find(r => r.name === curr.name);
        const text           = getAllBlocksText(d);
        const onlyOccurrence = countSegments(text, prev.name, 'ref') <= 1;
        if (currEntry) {
          return (onlyOccurrence && prevEntry)
            ? { ...d, references: d.references.filter(r => r.id !== prevEntry.id) }
            : d;
        }
        if (onlyOccurrence && prevEntry) {
          return { ...d, references: d.references.map(r => r.id === prevEntry.id ? { ...r, name: curr.name } : r) };
        }
        return { ...d, references: [...d.references, { id: crypto.randomUUID(), name: curr.name, display: prevEntry?.display ?? '', targetId: prevEntry?.targetId }] };
      } else {
        if (!('terms' in d)) return d;
        if (prev === null) {
          if (d.terms.find(t => t.name === curr.name)) return d;
          return { ...d, terms: [...d.terms, { id: crypto.randomUUID(), name: curr.name, display: '', canonical: '', synonyms: [] }] };
        }
        const prevEntry      = d.terms.find(t => t.name === prev.name);
        const currEntry      = d.terms.find(t => t.name === curr.name);
        const text           = getAllBlocksText(d);
        const onlyOccurrence = countSegments(text, prev.name, 'term') <= 1;
        if (currEntry) {
          return (onlyOccurrence && prevEntry)
            ? { ...d, terms: d.terms.filter(t => t.id !== prevEntry.id) }
            : d;
        }
        if (onlyOccurrence && prevEntry) {
          return { ...d, terms: d.terms.map(t => t.id === prevEntry.id ? { ...t, name: curr.name } : t) };
        }
        return { ...d, terms: [...d.terms, { id: crypto.randomUUID(), name: curr.name, display: prevEntry?.display ?? '', canonical: prevEntry?.canonical ?? '', synonyms: prevEntry?.synonyms ?? [] }] };
      }
    });
    setActiveItem(curr);
    markDirty();
  }, [markDirty]);

  const handleBracketEmpty = useCallback((info: BracketInfo) => {
    setDraft(d => {
      if (!d) return d;
      const text = maskFormulas(getAllBlocksText(d));
      if (info.type === 'ref') {
        const re = new RegExp(`(?<!\\[)\\[${info.name}\\](?!\\])`);
        if (re.test(text)) return d;
        return { ...d, references: d.references.filter(r => r.name !== info.name) };
      }
      if (!('terms' in d)) return d;
      const re = new RegExp(`\\[\\[${info.name}\\]\\]`);
      if (re.test(text)) return d;
      return { ...d, terms: d.terms.filter(t => t.name !== info.name) };
    });
    markDirty();
  }, [markDirty]);

  return { activeItem, setActiveItem, handleBracketContentChange, handleBracketEmpty };
}
