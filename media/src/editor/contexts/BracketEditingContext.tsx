import { createContext, useContext } from 'react';
import type { RefSuggestion } from '../../shared/types';

export interface BracketInfo { type: 'ref' | 'term'; name: string; }
export interface RenameEvent  { type: 'ref' | 'term'; oldName: string; newName: string; }

export interface BracketEditingContextValue {
  activeItem:             BracketInfo | null;
  setActiveItem:          (info: BracketInfo | null) => void;
  onBracketContentChange: (prev: BracketInfo | null, curr: BracketInfo) => void;
  onBracketEmpty:         (info: BracketInfo) => void;
  onFieldFocused:         (insertFn: (info: BracketInfo) => void) => void;
  insertAtFocused:        (info: BracketInfo) => void;
  supportsTerms:          boolean;
  fetchRefSuggestions:    ((query: string) => Promise<RefSuggestion[]>) | null;
}

export const BracketEditingContext = createContext<BracketEditingContextValue | null>(null);

export function useBracketEditingContext(): BracketEditingContextValue {
  const ctx = useContext(BracketEditingContext);
  if (!ctx) throw new Error('useBracketEditingContext used outside provider');
  return ctx;
}
