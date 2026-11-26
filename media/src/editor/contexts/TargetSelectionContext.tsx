import { createContext, useContext } from 'react';
import type { ContentTargetObject } from '../../shared/types';

export interface TargetSelectionContextValue {
  targetObjects:       Record<string, ContentTargetObject>;
  selectingSelectorId: string | null;
  onBeginSelectTarget: (selectorId: string, allowedTypes: string[]) => void;
  onEndSelectTarget:   (result: ContentTargetObject | null) => void;
  /** Routes the result of the picks `selectorId` starts to `listener` instead of an embed block; returns the undo. */
  onTargetSelected:    (selectorId: string, listener: (result: ContentTargetObject | null) => void) => () => void;
  onOpenTarget:        (targetId: string, targetType: string) => void;
}

export const TargetSelectionContext = createContext<TargetSelectionContextValue | null>(null);

export function useTargetSelectionContext(): TargetSelectionContextValue {
  const ctx = useContext(TargetSelectionContext);
  if (!ctx) throw new Error('useTargetSelectionContext used outside provider');
  return ctx;
}
