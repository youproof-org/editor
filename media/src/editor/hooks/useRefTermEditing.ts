import { Dispatch, SetStateAction, useCallback, useRef } from 'react';
import type { RenameEvent } from '../contexts/BracketEditingContext';
import type { ContentLabels, ContentObjectData, ContentTargetObject, ContentTerm, RefSuggestion } from '../../shared/types';

interface Params {
  setDraft:         Dispatch<SetStateAction<ContentObjectData | null>>;
  setTargetObjects: Dispatch<SetStateAction<Record<string, ContentTargetObject>>>;
  draftRef:         React.MutableRefObject<ContentObjectData | null>;
  markDirty:        () => void;
}

export function useRefTermEditing({ setDraft, setTargetObjects, draftRef, markDirty }: Params) {
  const renameHandlersRef = useRef<Set<(e: RenameEvent) => void>>(new Set());

  const handleRefChange = useCallback((id: string, field: 'name' | 'display', value: string) => {
    const oldName = field === 'name' ? draftRef.current?.references.find(r => r.id === id)?.name : undefined;
    setDraft(prev => {
      if (!prev) return prev;
      return { ...prev, references: prev.references.map(r => r.id === id ? { ...r, [field]: value } : r) };
    });
    if (field === 'name' && oldName !== undefined && oldName !== value) {
      renameHandlersRef.current.forEach(h => h({ type: 'ref', oldName, newName: value }));
    }
    markDirty();
  }, [markDirty]);

  const handleTermChange = useCallback((updated: ContentTerm) => {
    const oldName = draftRef.current && 'terms' in draftRef.current
      ? draftRef.current.terms.find(t => t.id === updated.id)?.name
      : undefined;
    setDraft(prev => {
      if (!prev || !('terms' in prev)) return prev;
      return { ...prev, terms: prev.terms.map(t => t.id === updated.id ? updated : t) };
    });
    if (oldName !== undefined && oldName !== updated.name) {
      renameHandlersRef.current.forEach(h => h({ type: 'term', oldName, newName: updated.name }));
    }
    markDirty();
  }, [markDirty]);

  const handleLabelsChange = useCallback((labels: ContentLabels | undefined) => {
    setDraft(prev => {
      if (!prev) return prev;
      if (prev.type !== 'definition' && prev.type !== 'theorem') return prev;
      return { ...prev, labels };
    });
    markDirty();
  }, [markDirty]);

  const subscribeToRename = useCallback((handler: (e: RenameEvent) => void) => {
    renameHandlersRef.current.add(handler);
    return () => { renameHandlersRef.current.delete(handler); };
  }, []);

  const ensureRefFromSuggestion = useCallback((s: RefSuggestion) => {
    setDraft(prev => {
      if (!prev) return prev;
      if (prev.references.some(r => r.name === s.name)) return prev;
      return {
        ...prev,
        references: [...prev.references, {
          id:       crypto.randomUUID(),
          name:     s.name,
          display:  s.display,
          targetId: s.target.id,
        }],
      };
    });
    setTargetObjects(prev => prev[s.target.id] ? prev : { ...prev, [s.target.id]: s.target });
    markDirty();
  }, [markDirty]);

  return { handleRefChange, handleTermChange, handleLabelsChange, subscribeToRename, ensureRefFromSuggestion };
}
