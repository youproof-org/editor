export interface RequestMessage {
  kind: 'request';
  id: string;
  method: string;
  params: unknown;
}

export interface ResponseMessage {
  kind: 'response';
  id: string;
  result?: unknown;
  error?: string;
}

export interface NotificationMessage {
  kind: 'notification';
  method: string;
  params: unknown;
}
