import { useCallback, useEffect } from 'react';
import { useClient } from '../../shared/clientContext';
import { getAllBlocksText, sortByOccurrence } from '../bracketScan';
import type {
  ContentObjectData,
  SaveContentObjectRequest,
  SaveChapterObjectRequest,
} from '../../shared/types';

interface Params {
  nodeId:      string;
  draft:       ContentObjectData | null;
  isDirtyRef:  React.MutableRefObject<boolean>;
  setIsDirty:  (v: boolean) => void;
  setError:    (msg: string) => void;
}

export function useSaveOnCtrlS({ nodeId, draft, isDirtyRef, setIsDirty, setError }: Params) {
  const client = useClient();

  const save = useCallback((d: ContentObjectData) => {
    const termsToSave = 'terms' in d ? sortByOccurrence(d.terms, getAllBlocksText(d)) : undefined;

    let params: SaveContentObjectRequest;
    if (d.type === 'chapter') {
      params = { id: nodeId, entityType: 'chapter',
        abstract: d.abstract, prerequisiteWarning: d.prerequisiteWarning,
        prologue: d.prologue, epilogue: d.epilogue } as SaveChapterObjectRequest;
    } else {
      const labelToSave = d.type === 'section' ? undefined : d.label;
      params = {
        id: nodeId, entityType: d.type, body: d.body,
        ...(termsToSave ? { terms: termsToSave } : {}),
        ...(labelToSave ? { label: labelToSave } : {}),
      } as SaveContentObjectRequest;
    }

    client.request('saveContentObject', params)
      .then(() => {
        isDirtyRef.current = false;
        setIsDirty(false);
      })
      .catch((err: Error) => setError(err.message));
  }, [nodeId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (isDirtyRef.current && draft) save(draft);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draft, save]);
}
