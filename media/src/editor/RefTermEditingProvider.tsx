import { Dispatch, ReactNode, SetStateAction, useMemo } from 'react';
import { RefTermEditingContext } from './contexts/RefTermEditingContext';
import { useRefTermEditing } from './hooks/useRefTermEditing';
import type { ContentObjectData, ContentTargetObject } from '../shared/types';

interface Props {
  setDraft:         Dispatch<SetStateAction<ContentObjectData | null>>;
  setTargetObjects: Dispatch<SetStateAction<Record<string, ContentTargetObject>>>;
  draftRef:         React.MutableRefObject<ContentObjectData | null>;
  markDirty:        () => void;
  children:         ReactNode;
}

export default function RefTermEditingProvider({ setDraft, setTargetObjects, draftRef, markDirty, children }: Props) {
  const { handleRefChange, handleTermChange, handleLabelsChange, subscribeToRename, ensureRefFromSuggestion } =
    useRefTermEditing({ setDraft, setTargetObjects, draftRef, markDirty });

  const value = useMemo(() => ({
    onRefChange:    handleRefChange,
    onTermChange:   handleTermChange,
    onLabelsChange: handleLabelsChange,
    subscribeToRename,
    ensureRefFromSuggestion,
  }), [handleRefChange, handleTermChange, handleLabelsChange, subscribeToRename, ensureRefFromSuggestion]);

  return <RefTermEditingContext.Provider value={value}>{children}</RefTermEditingContext.Provider>;
}
