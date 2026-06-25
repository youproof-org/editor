import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { useClient } from '../../shared/clientContext';
import type {
  BeginSelectTargetRequest,
  ContentBlock,
  ContentObjectData,
  ContentTargetObject,
  EndSelectTargetRequest,
  OpenExternalUrlRequest,
  SelectContentObjectRequest,
} from '../../shared/types';

interface Params {
  draftRef:         React.MutableRefObject<ContentObjectData | null>;
  setDraft:         Dispatch<SetStateAction<ContentObjectData | null>>;
  setTargetObjects: Dispatch<SetStateAction<Record<string, ContentTargetObject>>>;
  markDirty:        () => void;
}

export function useTargetSelection({ draftRef, setDraft, setTargetObjects, markDirty }: Params) {
  const client = useClient();
  const [selectingSelectorId, setSelectingSelectorId] = useState<string | null>(null);
  // True iff this panel initiated the currently-in-flight target selection.
  // `targetSelectionEnded` is broadcast to all panels, so without this gate
  // every panel would call markDirty() on every successful selection.
  const initiatedByThisPanelRef = useRef(false);

  const handleRefTargetChange = useCallback((refId: string, target: ContentTargetObject | null) => {
    setDraft(prev => {
      if (!prev) return prev;
      return { ...prev, references: prev.references.map(r =>
        r.id === refId ? { ...r, targetId: target?.id } : r
      )};
    });
    if (target) setTargetObjects(prev => ({ ...prev, [target.id]: target }));
    markDirty();
  }, [markDirty]);

  const handleBlockTargetChange = useCallback((blockId: string, target: ContentTargetObject | null) => {
    const updateBlock = (b: ContentBlock): ContentBlock => {
      if (b.id === blockId && (b.blockType === 'embed' || b.blockType === 'recall')) {
        return { ...b, targetType: target?.type ?? '', targetId: target?.id ?? '' };
      }
      if (b.blockType === 'subsection' || b.blockType === 'details') {
        return { ...b, blocks: b.blocks.map(updateBlock) };
      }
      return b;
    };
    setDraft(prev => {
      if (!prev) return prev;
      if (prev.type === 'chapter') {
        return {
          ...prev,
          abstract:            prev.abstract.map(updateBlock),
          prerequisiteWarning: prev.prerequisiteWarning.map(updateBlock),
          prologue:            prev.prologue.map(updateBlock),
          epilogue:            prev.epilogue.map(updateBlock),
        };
      }
      return { ...prev, body: prev.body.map(updateBlock) };
    });
    if (target) setTargetObjects(prev => ({ ...prev, [target.id]: target }));
    markDirty();
  }, [markDirty]);

  useEffect(() => {
    client.onNotification('targetSelectionStarted', (params) => {
      setSelectingSelectorId((params as { selectorId: string }).selectorId);
    });
    client.onNotification('targetSelectionEnded', (params) => {
      const { selectorId, result } = params as { selectorId: string; result: ContentTargetObject | null };
      setSelectingSelectorId(null);
      if (!initiatedByThisPanelRef.current) return;
      initiatedByThisPanelRef.current = false;
      if (!result) return;
      const isRef = !!draftRef.current?.references.find(r => r.id === selectorId);
      if (isRef) handleRefTargetChange(selectorId, result);
      else handleBlockTargetChange(selectorId, result);
    });
  }, []);

  const handleBeginSelectTarget = useCallback((selectorId: string, allowedTypes: string[]) => {
    initiatedByThisPanelRef.current = true;
    client.request('beginSelectTarget', { selectorId, allowedTypes } as BeginSelectTargetRequest).catch(console.error);
  }, []);

  const handleEndSelectTarget = useCallback((result: ContentTargetObject | null) => {
    client.request('endSelectTarget', { targetId: result?.id ?? null } as EndSelectTargetRequest).catch(console.error);
  }, []);

  const handleOpenTarget = useCallback((targetId: string, targetType: string) => {
    if (targetType === 'external') {
      client.request('openExternalUrl', { url: targetId } as OpenExternalUrlRequest).catch(console.error);
    } else {
      client.request('selectContentObject', { id: targetId } as SelectContentObjectRequest).catch(console.error);
    }
  }, []);

  return {
    selectingSelectorId,
    handleRefTargetChange,
    handleBeginSelectTarget,
    handleEndSelectTarget,
    handleOpenTarget,
  };
}
