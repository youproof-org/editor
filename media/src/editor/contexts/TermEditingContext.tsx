import { createContext, useContext } from 'react';
import type { RenameEvent } from './BracketEditingContext';
import type { ContentTerm } from '../../shared/types';

export interface TermEditingContextValue {
  onTermChange:      (updated: ContentTerm) => void;
  onLabelChange:     (label: string | undefined) => void;
  subscribeToRename: (handler: (event: RenameEvent) => void) => () => void;
}

export const TermEditingContext = createContext<TermEditingContextValue | null>(null);

export function useTermEditingContext(): TermEditingContextValue {
  const ctx = useContext(TermEditingContext);
  if (!ctx) throw new Error('useTermEditingContext used outside provider');
  return ctx;
}
