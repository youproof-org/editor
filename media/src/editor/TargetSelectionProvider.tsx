import { Dispatch, ReactNode, SetStateAction, useMemo } from 'react';
import { TargetSelectionContext } from './contexts/TargetSelectionContext';
import { useTargetSelection } from './hooks/useTargetSelection';
import type { ContentObjectData, ContentTargetObject } from '../shared/types';

interface Props {
  draftRef:         React.MutableRefObject<ContentObjectData | null>;
  setDraft:         Dispatch<SetStateAction<ContentObjectData | null>>;
  setTargetObjects: Dispatch<SetStateAction<Record<string, ContentTargetObject>>>;
  markDirty:        () => void;
  targetObjects:    Record<string, ContentTargetObject>;
  children:         ReactNode;
}

export default function TargetSelectionProvider({
  draftRef, setDraft, setTargetObjects, markDirty, targetObjects, children,
}: Props) {
  const {
    selectingSelectorId,
    handleRefTargetChange,
    handleBeginSelectTarget,
    handleEndSelectTarget,
    handleOpenTarget,
  } = useTargetSelection({ draftRef, setDraft, setTargetObjects, markDirty });

  const value = useMemo(() => ({
    targetObjects,
    selectingSelectorId,
    onBeginSelectTarget: handleBeginSelectTarget,
    onEndSelectTarget:   handleEndSelectTarget,
    onOpenTarget:        handleOpenTarget,
    onRefTargetChange:   handleRefTargetChange,
  }), [targetObjects, selectingSelectorId, handleBeginSelectTarget, handleEndSelectTarget, handleOpenTarget, handleRefTargetChange]);

  return <TargetSelectionContext.Provider value={value}>{children}</TargetSelectionContext.Provider>;
}
