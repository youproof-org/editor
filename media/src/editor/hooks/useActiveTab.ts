import { useEffect, useState } from 'react';
import type { BracketInfo } from '../contexts/BracketEditingContext';
import type { ContentObjectData } from '../../shared/types';

export function useActiveTab(
  draft: ContentObjectData | null,
  selectedId: string | null,
  activeItem: BracketInfo | null,
) {
  const [activeTabId, setActiveTabId] = useState<string>('');

  // Initial default when the draft first loads (set once; manual tab clicks persist).
  useEffect(() => {
    if (draft && activeTabId === '') {
      setActiveTabId('terms' in draft ? 'terms' : 'refs');
    }
  }, [draft]);

  // Auto-switch based on the currently-edited bracket or the selected ref/term.
  useEffect(() => {
    if (activeItem) {
      setActiveTabId(activeItem.type === 'term' ? 'terms' : 'refs');
      return;
    }
    if (!selectedId || !draft) return;
    if ('terms' in draft && draft.terms.find(t => t.id === selectedId)) {
      setActiveTabId('terms');
    } else if (draft.references.find(r => r.id === selectedId)) {
      setActiveTabId('refs');
    }
  }, [activeItem, selectedId, draft]);

  return { activeTabId, setActiveTabId };
}
