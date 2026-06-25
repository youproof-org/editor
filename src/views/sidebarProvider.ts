import * as vscode from 'vscode';
import type { MessageServer } from '../protocol/messageServer';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'youproofSidebar';

  private _webviewRegistered = false;

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _server: MessageServer,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };

    webviewView.webview.html = this._buildHtml(webviewView.webview);

    // The WebviewView object is stable across hide/show cycles — register once only.
    if (!this._webviewRegistered) {
      const disposable = this._server.registerWebview(webviewView.webview);
      this._context.subscriptions.push(disposable);
      this._webviewRegistered = true;
    }
  }

  private _buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'media', 'panel.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'media', 'panel.css'),
    );
    const csp = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${csp}; script-src ${csp};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>YouProof Editor</title>
</head>
<body>
  <div id="root"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
