import { useCallback, useEffect, useRef, useState } from 'react';
import { useClient } from '../../shared/clientContext';
import type { SelectContentObjectRequest } from '../../shared/types';

export function useEntitySelection(nodeId: string) {
  const client = useClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  useEffect(() => {
    client.onNotification('contentObjectSelected', (params) => {
      setSelectedId((params as { id: string }).id);
    });
  }, []);

  const handleSelectId = useCallback((id: string) => {
    if (selectedIdRef.current === id) return;
    client.request('selectContentObject', { id } as SelectContentObjectRequest).catch(console.error);
  }, []);

  const handleSelectBlock = useCallback((id: string, blockType: string) => {
    handleSelectId(blockType === 'claim' ? id : nodeId);
  }, [handleSelectId, nodeId]);

  return { selectedId, setSelectedId, handleSelectId, handleSelectBlock };
}
