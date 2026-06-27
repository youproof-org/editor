import * as vscode from 'vscode';
import type { RequestMessage, ResponseMessage, NotificationMessage } from './types';

export class MessageServer {
  private readonly _queue: Array<{ webview: vscode.Webview; msg: RequestMessage }> = [];
  private _busy = false;
  private readonly _handlers = new Map<string, (params: unknown) => Promise<unknown>>();
  private readonly _webviews = new Set<vscode.Webview>();

  registerWebview(webview: vscode.Webview): vscode.Disposable {
    this._webviews.add(webview);
    const sub = webview.onDidReceiveMessage((raw: unknown) => {
      const msg = raw as RequestMessage;
      if (msg?.kind === 'request') {
        this._enqueue(webview, msg);
      }
    });
    return {
      dispose: () => {
        this._webviews.delete(webview);
        sub.dispose();
      },
    };
  }

  onRequest(method: string, handler: (params: unknown) => Promise<unknown>): void {
    this._handlers.set(method, handler);
  }

  notify(method: string, params: unknown): void {
    const msg: NotificationMessage = { kind: 'notification', method, params };
    for (const webview of this._webviews) {
      webview.postMessage(msg);
    }
  }

  private _enqueue(webview: vscode.Webview, msg: RequestMessage): void {
    this._queue.push({ webview, msg });
    this._drain();
  }

  private async _drain(): Promise<void> {
    if (this._busy || this._queue.length === 0) return;
    this._busy = true;
    const { webview, msg } = this._queue.shift()!;

    let response: ResponseMessage;
    const handler = this._handlers.get(msg.method);
    if (!handler) {
      response = { kind: 'response', id: msg.id, error: `Unknown method: ${msg.method}` };
    } else {
      try {
        const result = await handler(msg.params);
        response = { kind: 'response', id: msg.id, result };
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Request failed.';
        response = { kind: 'response', id: msg.id, error };
      }
    }

    webview.postMessage(response);
    this._busy = false;
    this._drain();
  }
}
