import { createContext, useContext } from 'react';
import type { MessageClient } from './messageClient';

export const ClientContext = createContext<MessageClient | null>(null);

export function useClient(): MessageClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error('MessageClient not provided');
  return client;
}
