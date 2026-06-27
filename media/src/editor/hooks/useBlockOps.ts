import { Dispatch, SetStateAction, useCallback, useLayoutEffect, useRef } from 'react';
import {
  moveBlock as moveBlockInArray,
  canMoveBlock as canMoveBlockInArray,
  deleteBlock as deleteBlockInArray,
} from '../blocks/blockMove';
import { captureBlockRects, runFlipFromRects } from '../flipAnimation';
import type { ContentObjectData } from '../../shared/types';

interface Params {
  draft:     ContentObjectData | null;
  setDraft:  Dispatch<SetStateAction<ContentObjectData | null>>;
  markDirty: () => void;
}

export function useBlockOps({ draft, setDraft, markDirty }: Params) {
  const flipPendingRef = useRef<Map<string, DOMRect> | null>(null);

  useLayoutEffect(() => {
    const oldRects = flipPendingRef.current;
    if (!oldRects) return;
    flipPendingRef.current = null;
    runFlipFromRects(oldRects);
  });

  const handleMoveBlock = useCallback((blockId: string, direction: 'up' | 'down') => {
    flipPendingRef.current = captureBlockRects();
    setDraft(prev => {
      if (!prev) return prev;
      if (prev.type === 'chapter') {
        for (const f of ['abstract', 'prerequisiteWarning', 'prologue', 'epilogue'] as const) {
          const next = moveBlockInArray(prev[f], blockId, direction);
          if (next) return { ...prev, [f]: next };
        }
        return prev;
      }
      const next = moveBlockInArray(prev.body, blockId, direction);
      return next ? { ...prev, body: next } : prev;
    });
    markDirty();
  }, [markDirty]);

  const prepareLayoutAnimation = useCallback(() => {
    flipPendingRef.current = captureBlockRects();
  }, []);

  const handleDeleteBlock = useCallback((blockId: string) => {
    flipPendingRef.current = captureBlockRects();
    setDraft(prev => {
      if (!prev) return prev;
      if (prev.type === 'chapter') {
        for (const f of ['abstract', 'prerequisiteWarning', 'prologue', 'epilogue'] as const) {
          const next = deleteBlockInArray(prev[f], blockId);
          if (next) return { ...prev, [f]: next };
        }
        return prev;
      }
      const next = deleteBlockInArray(prev.body, blockId);
      return next ? { ...prev, body: next } : prev;
    });
    markDirty();
  }, [markDirty]);

  const canMoveBlockHere = useCallback((blockId: string, direction: 'up' | 'down') => {
    if (!draft) return false;
    if (draft.type === 'chapter') {
      return canMoveBlockInArray(draft.abstract,            blockId, direction)
          || canMoveBlockInArray(draft.prerequisiteWarning, blockId, direction)
          || canMoveBlockInArray(draft.prologue,            blockId, direction)
          || canMoveBlockInArray(draft.epilogue,            blockId, direction);
    }
    return canMoveBlockInArray(draft.body, blockId, direction);
  }, [draft]);

  return { handleMoveBlock, handleDeleteBlock, canMoveBlockHere, prepareLayoutAnimation };
}
