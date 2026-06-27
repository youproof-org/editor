import { createContext, useContext } from 'react';
import type { RenameEvent } from './BracketEditingContext';
import type { ContentLabels, ContentTerm, RefSuggestion } from '../../shared/types';

export interface RefTermEditingContextValue {
  onRefChange:             (id: string, field: 'name' | 'display', value: string) => void;
  onTermChange:            (updated: ContentTerm) => void;
  onLabelsChange:          (labels: ContentLabels | undefined) => void;
  subscribeToRename:       (handler: (event: RenameEvent) => void) => () => void;
  ensureRefFromSuggestion: (s: RefSuggestion) => void;
}

export const RefTermEditingContext = createContext<RefTermEditingContextValue | null>(null);

export function useRefTermEditingContext(): RefTermEditingContextValue {
  const ctx = useContext(RefTermEditingContext);
  if (!ctx) throw new Error('useRefTermEditingContext used outside provider');
  return ctx;
}
