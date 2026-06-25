import { Dispatch, ReactNode, SetStateAction, useMemo } from 'react';
import { BlockOpsContext } from './contexts/BlockOpsContext';
import { useBlockOps } from './hooks/useBlockOps';
import type { ContentObjectData } from '../shared/types';

interface Props {
  draft:     ContentObjectData | null;
  setDraft:  Dispatch<SetStateAction<ContentObjectData | null>>;
  markDirty: () => void;
  children:  ReactNode;
}

export default function BlockOpsProvider({ draft, setDraft, markDirty, children }: Props) {
  const { handleMoveBlock, handleDeleteBlock, canMoveBlockHere, prepareLayoutAnimation } =
    useBlockOps({ draft, setDraft, markDirty });

  const value = useMemo(() => ({
    moveBlock:              handleMoveBlock,
    canMoveBlock:           canMoveBlockHere,
    deleteBlock:            handleDeleteBlock,
    prepareLayoutAnimation,
  }), [handleMoveBlock, canMoveBlockHere, handleDeleteBlock, prepareLayoutAnimation]);

  return <BlockOpsContext.Provider value={value}>{children}</BlockOpsContext.Provider>;
}
