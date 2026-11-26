import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useClient } from '../shared/clientContext';
import type { GetReferenceChoicesRequest, GetReferenceChoicesResponse, ReferenceChoices } from '../shared/types';
import { ReferencePopupContext, type ReferencePopupHost, type ReferencePopupRequest } from './contexts/ReferencePopupContext';
import { cancelReferenceSpec } from './referencePopupState';
import ReferencePopup from './ReferencePopup';

interface Props {
  nodeId: string;
  children: ReactNode;
}

/**
 * The panel's one reference popup. A field opens it with `[` or on a token; opening
 * it for another field closes the one that is open, with nothing changed. What it
 * offers is asked for when it first opens, and again after `referenceDisplaysChanged`.
 */
export default function ReferencePopupProvider({ nodeId, children }: Props) {
  const client = useClient();
  const [open, setOpen] = useState<{ key: number; request: ReferencePopupRequest } | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const [choices, setChoices] = useState<ReferenceChoices | null>(null);
  const [choicesError, setChoicesError] = useState<string | null>(null);
  const staleRef = useRef(true);
  const nextKey = useRef(0);

  const load = useCallback(() => {
    staleRef.current = false;
    client.request<GetReferenceChoicesResponse>('getReferenceChoices', { id: nodeId } as GetReferenceChoicesRequest)
      .then((loaded) => { setChoices(loaded); setChoicesError(null); })
      .catch((err: Error) => { staleRef.current = true; setChoicesError(err.message); });
  }, [client, nodeId]);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    client.onNotification('referenceDisplaysChanged', () => {
      staleRef.current = true;
      if (openRef.current) loadRef.current();
    });
  }, []);

  const host = useMemo<ReferencePopupHost>(() => ({
    open(request) {
      const current = openRef.current?.request;
      if (current && current.view !== request.view && current.view.dom.isConnected) current.view.dispatch(cancelReferenceSpec());
      if (staleRef.current) loadRef.current();
      setOpen({ key: nextKey.current++, request });
    },
  }), []);

  const closeOpen = useCallback((key: number) => setOpen((current) => (current?.key === key ? null : current)), []);

  return (
    <ReferencePopupContext.Provider value={host}>
      {children}
      {open && createPortal(
        <ReferencePopup key={open.key} request={open.request} choices={choices} choicesError={choicesError} onClose={() => closeOpen(open.key)} />,
        document.body,
      )}
    </ReferencePopupContext.Provider>
  );
}
