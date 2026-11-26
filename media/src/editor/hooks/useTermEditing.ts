import { Dispatch, SetStateAction, useCallback, useRef } from 'react';
import type { RenameEvent } from '../contexts/BracketEditingContext';
import type { ContentObjectData, ContentTerm } from '../../shared/types';

interface Params {
  setDraft:  Dispatch<SetStateAction<ContentObjectData | null>>;
  draftRef:  React.MutableRefObject<ContentObjectData | null>;
  markDirty: () => void;
}

export function useTermEditing({ setDraft, draftRef, markDirty }: Params) {
  const renameHandlersRef = useRef<Set<(e: RenameEvent) => void>>(new Set());

  const handleTermChange = useCallback((updated: ContentTerm) => {
    const oldName = draftRef.current && 'terms' in draftRef.current
      ? draftRef.current.terms.find(t => t.id === updated.id)?.name
      : undefined;
    setDraft(prev => {
      if (!prev || !('terms' in prev)) return prev;
      return { ...prev, terms: prev.terms.map(t => t.id === updated.id ? updated : t) };
    });
    if (oldName !== undefined && oldName !== updated.name) {
      renameHandlersRef.current.forEach(h => h({ oldName, newName: updated.name }));
    }
    markDirty();
  }, [markDirty]);

  const handleLabelChange = useCallback((label: string | undefined) => {
    setDraft(prev => {
      if (!prev || prev.type === 'chapter' || prev.type === 'section') return prev;
      const { label: _previous, ...rest } = prev;
      return label === undefined ? rest : { ...rest, label };
    });
    markDirty();
  }, [markDirty]);

  const subscribeToRename = useCallback((handler: (e: RenameEvent) => void) => {
    renameHandlersRef.current.add(handler);
    return () => { renameHandlersRef.current.delete(handler); };
  }, []);

  return { handleTermChange, handleLabelChange, subscribeToRename };
}
