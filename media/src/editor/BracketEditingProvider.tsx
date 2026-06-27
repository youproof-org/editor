import { Dispatch, ReactNode, SetStateAction, useMemo, useRef } from 'react';
import { BracketEditingContext } from './contexts/BracketEditingContext';
import { useBracketLifecycle } from './hooks/useBracketLifecycle';
import type { BracketInfo } from './contexts/BracketEditingContext';
import type { ContentObjectData, RefSuggestion } from '../shared/types';

interface Props {
  draft:               ContentObjectData | null;
  setDraft:            Dispatch<SetStateAction<ContentObjectData | null>>;
  markDirty:           () => void;
  fetchRefSuggestions: ((query: string) => Promise<RefSuggestion[]>) | null;
  children:            ReactNode;
}

export default function BracketEditingProvider({ draft, setDraft, markDirty, fetchRefSuggestions, children }: Props) {
  const { activeItem, setActiveItem, handleBracketContentChange, handleBracketEmpty } =
    useBracketLifecycle({ setDraft, markDirty });
  const lastInsertFnRef = useRef<((info: BracketInfo) => void) | null>(null);
  const supportsTerms   = draft !== null && 'terms' in draft;

  const value = useMemo(() => ({
    activeItem,
    setActiveItem,
    onBracketContentChange: handleBracketContentChange,
    onBracketEmpty:         handleBracketEmpty,
    onFieldFocused:  (fn: (info: BracketInfo) => void) => { lastInsertFnRef.current = fn; },
    insertAtFocused: (info: BracketInfo) => lastInsertFnRef.current?.(info),
    supportsTerms,
    fetchRefSuggestions,
  }), [activeItem, setActiveItem, handleBracketContentChange, handleBracketEmpty, supportsTerms, fetchRefSuggestions]);

  return <BracketEditingContext.Provider value={value}>{children}</BracketEditingContext.Provider>;
}
