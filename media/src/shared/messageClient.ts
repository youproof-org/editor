interface VsCodeApi {
  postMessage(msg: unknown): void;
}

interface RequestMessage {
  kind: 'request';
  id: string;
  method: string;
  params: unknown;
}

interface ResponseMessage {
  kind: 'response';
  id: string;
  result?: unknown;
  error?: string;
}

interface NotificationMessage {
  kind: 'notification';
  method: string;
  params: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export class MessageClient {
  private _nextId = 0;
  private readonly _pending = new Map<string, PendingRequest>();
  private readonly _notificationHandlers = new Map<string, Array<(params: unknown) => void>>();

  constructor(private readonly _vscode: VsCodeApi) {
    window.addEventListener('message', (event: MessageEvent) => {
      const msg = event.data as ResponseMessage | NotificationMessage;
      if (msg?.kind === 'response') {
        const pending = this._pending.get(msg.id);
        if (pending) {
          this._pending.delete(msg.id);
          if (msg.error !== undefined) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.result);
          }
        }
      } else if (msg?.kind === 'notification') {
        const handlers = this._notificationHandlers.get(msg.method);
        if (handlers) {
          for (const h of handlers) h(msg.params);
        }
      }
    });
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    const id = String(this._nextId++);
    return new Promise<T>((resolve, reject) => {
      this._pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      const msg: RequestMessage = { kind: 'request', id, method, params: params ?? null };
      this._vscode.postMessage(msg);
    });
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    const existing = this._notificationHandlers.get(method);
    if (existing) {
      existing.push(handler);
    } else {
      this._notificationHandlers.set(method, [handler]);
    }
  }
}
