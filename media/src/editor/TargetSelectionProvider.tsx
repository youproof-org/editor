import { Dispatch, ReactNode, SetStateAction, useMemo } from 'react';
import { TargetSelectionContext } from './contexts/TargetSelectionContext';
import { useTargetSelection } from './hooks/useTargetSelection';
import type { ContentObjectData, ContentTargetObject } from '../shared/types';

interface Props {
  nodeId:           string;
  setDraft:         Dispatch<SetStateAction<ContentObjectData | null>>;
  setTargetObjects: Dispatch<SetStateAction<Record<string, ContentTargetObject>>>;
  markDirty:        () => void;
  targetObjects:    Record<string, ContentTargetObject>;
  children:         ReactNode;
}

export default function TargetSelectionProvider({
  nodeId, setDraft, setTargetObjects, markDirty, targetObjects, children,
}: Props) {
  const {
    selectingSelectorId,
    handleBeginSelectTarget,
    handleEndSelectTarget,
    handleTargetSelected,
    handleOpenTarget,
  } = useTargetSelection({ nodeId, setDraft, setTargetObjects, markDirty });

  const value = useMemo(() => ({
    targetObjects,
    selectingSelectorId,
    onBeginSelectTarget: handleBeginSelectTarget,
    onEndSelectTarget:   handleEndSelectTarget,
    onTargetSelected:    handleTargetSelected,
    onOpenTarget:        handleOpenTarget,
  }), [targetObjects, selectingSelectorId, handleBeginSelectTarget, handleEndSelectTarget, handleTargetSelected, handleOpenTarget]);

  return <TargetSelectionContext.Provider value={value}>{children}</TargetSelectionContext.Provider>;
}
