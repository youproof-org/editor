import { createRoot } from 'react-dom/client';
import NodeView from './NodeView';
import { MessageClient } from '../shared/messageClient';
import { ClientContext } from '../shared/clientContext';

interface VsCodeApi { postMessage(msg: unknown): void; }
declare function acquireVsCodeApi(): VsCodeApi;

const client = new MessageClient(acquireVsCodeApi());
const rootEl = document.getElementById('root')!;
const nodeId = rootEl.dataset.nodeId ?? '';

createRoot(rootEl).render(
  <ClientContext.Provider value={client}>
    <NodeView nodeId={nodeId} />
  </ClientContext.Provider>,
);
