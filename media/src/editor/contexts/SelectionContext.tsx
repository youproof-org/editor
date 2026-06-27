import { createContext, useContext } from 'react';

export interface SelectionContextValue {
  selectedId:    string | null;
  onSelectBlock: (id: string, blockType: string) => void;
}

export const SelectionContext = createContext<SelectionContextValue | null>(null);

export function useSelectionContext(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error('useSelectionContext used outside provider');
  return ctx;
}
