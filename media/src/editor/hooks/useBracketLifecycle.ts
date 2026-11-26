import { Dispatch, SetStateAction, useCallback, useState } from 'react';
import { countTermSegments, getAllBlocksText } from '../bracketScan';
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
      if (!d || !('terms' in d)) return d;
      if (prev === null) {
        if (d.terms.find(t => t.name === curr.name)) return d;
        return { ...d, terms: [...d.terms, { id: crypto.randomUUID(), name: curr.name, slug: '', display: '', canonical: '', synonyms: [] }] };
      }
      const prevEntry      = d.terms.find(t => t.name === prev.name);
      const currEntry      = d.terms.find(t => t.name === curr.name);
      const onlyOccurrence = countTermSegments(getAllBlocksText(d), prev.name) <= 1;
      if (currEntry) {
        return (onlyOccurrence && prevEntry)
          ? { ...d, terms: d.terms.filter(t => t.id !== prevEntry.id) }
          : d;
      }
      if (onlyOccurrence && prevEntry) {
        return { ...d, terms: d.terms.map(t => t.id === prevEntry.id ? { ...t, name: curr.name } : t) };
      }
      return { ...d, terms: [...d.terms, { id: crypto.randomUUID(), name: curr.name, slug: prevEntry?.slug ?? '', display: prevEntry?.display ?? '', canonical: prevEntry?.canonical ?? '', synonyms: prevEntry?.synonyms ?? [] }] };
    });
    setActiveItem(curr);
    markDirty();
  }, [markDirty]);

  const handleBracketEmpty = useCallback((info: BracketInfo) => {
    setDraft(d => {
      if (!d || !('terms' in d)) return d;
      if (new RegExp(`\\[\\[${info.name}\\]\\]`).test(maskFormulas(getAllBlocksText(d)))) return d;
      return { ...d, terms: d.terms.filter(t => t.name !== info.name) };
    });
    markDirty();
  }, [markDirty]);

  return { activeItem, setActiveItem, handleBracketContentChange, handleBracketEmpty };
}
