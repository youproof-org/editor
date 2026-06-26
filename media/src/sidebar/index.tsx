import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { MessageClient } from '../shared/messageClient';
import { ClientContext } from '../shared/clientContext';

interface VsCodeApi { postMessage(msg: unknown): void; }
declare function acquireVsCodeApi(): VsCodeApi;

const client = new MessageClient(acquireVsCodeApi());

createRoot(document.getElementById('root')!).render(
  <ClientContext.Provider value={client}>
    <App />
  </ClientContext.Provider>,
);
