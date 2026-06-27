import { createContext, useContext } from 'react';

export interface BlockOpsContextValue {
  moveBlock:              (id: string, direction: 'up' | 'down') => void;
  canMoveBlock:           (id: string, direction: 'up' | 'down') => boolean;
  deleteBlock:            (id: string) => void;
  prepareLayoutAnimation: () => void;
}

export const BlockOpsContext = createContext<BlockOpsContextValue | null>(null);

export function useBlockOpsContext(): BlockOpsContextValue {
  const ctx = useContext(BlockOpsContext);
  if (!ctx) throw new Error('useBlockOpsContext used outside provider');
  return ctx;
}
