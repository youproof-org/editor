import { Dispatch, ReactNode, SetStateAction, useMemo } from 'react';
import { TermEditingContext } from './contexts/TermEditingContext';
import { useTermEditing } from './hooks/useTermEditing';
import type { ContentObjectData } from '../shared/types';

interface Props {
  setDraft:  Dispatch<SetStateAction<ContentObjectData | null>>;
  draftRef:  React.MutableRefObject<ContentObjectData | null>;
  markDirty: () => void;
  children:  ReactNode;
}

export default function TermEditingProvider({ setDraft, draftRef, markDirty, children }: Props) {
  const { handleTermChange, handleLabelChange, subscribeToRename } =
    useTermEditing({ setDraft, draftRef, markDirty });

  const value = useMemo(() => ({
    onTermChange:  handleTermChange,
    onLabelChange: handleLabelChange,
    subscribeToRename,
  }), [handleTermChange, handleLabelChange, subscribeToRename]);

  return <TermEditingContext.Provider value={value}>{children}</TermEditingContext.Provider>;
}
