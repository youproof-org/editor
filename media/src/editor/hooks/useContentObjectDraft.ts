import { useCallback, useEffect, useRef, useState } from 'react';
import { useClient } from '../../shared/clientContext';
import type {
  ContentObjectData,
  ContentTargetObject,
  GetContentObjectRequest,
  GetContentObjectResponse,
  SetContentObjectDirtyRequest,
} from '../../shared/types';

interface Params {
  nodeId:        string;
  setSelectedId: (id: string | null) => void;
}

export function useContentObjectDraft({ nodeId, setSelectedId }: Params) {
  const client = useClient();
  const [draft, setDraft]                 = useState<ContentObjectData | null>(null);
  const [targetObjects, setTargetObjects] = useState<Record<string, ContentTargetObject>>({});
  const [error, setError]                 = useState<string | null>(null);
  const [isDirty, setIsDirty]             = useState(false);
  const isDirtyRef        = useRef(false);
  const draftRef          = useRef(draft);
  draftRef.current        = draft;
  const targetObjectsRef  = useRef(targetObjects);
  targetObjectsRef.current = targetObjects;

  useEffect(() => {
    if (!nodeId) { setError('No node ID'); return; }
    client.request<GetContentObjectResponse>('getContentObject', { id: nodeId } as GetContentObjectRequest)
      .then(data => {
        setDraft(data.contentObject);
        setTargetObjects(data.targetObjects);
        setSelectedId(data.contentObject.selectedId);
      })
      .catch((err: Error) => setError(err.message));
  }, [nodeId]);

  const markDirty = useCallback(() => {
    if (!isDirtyRef.current) {
      isDirtyRef.current = true;
      setIsDirty(true);
      client.request('setContentObjectDirty', { id: nodeId } as SetContentObjectDirtyRequest).catch(console.error);
    }
  }, [nodeId]);

  return {
    draft, setDraft, draftRef,
    targetObjects, setTargetObjects, targetObjectsRef,
    error, setError,
    isDirty, setIsDirty, isDirtyRef,
    markDirty,
  };
}
