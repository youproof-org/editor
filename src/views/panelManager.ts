import * as vscode from 'vscode';
import type { MessageServer } from '../protocol/messageServer';

const SCHEME   = 'youproof';
const VIEWTYPE = 'youproof.nodeEditor';
const SUFFIX   = '.youproof-node';

function nodeUri(nodeId: string): vscode.Uri {
  return vscode.Uri.from({ scheme: SCHEME, path: `/${nodeId}${SUFFIX}` });
}

function nodeIdFromUri(uri: vscode.Uri): string {
  const p = uri.path.slice(1);
  return p.endsWith(SUFFIX) ? p.slice(0, -SUFFIX.length) : p;
}

export class PanelManager implements vscode.CustomReadonlyEditorProvider<vscode.CustomDocument> {
  private readonly _panels = new Map<string, vscode.WebviewPanel>();
  private readonly _labels = new Map<string, string>();
  private readonly _types  = new Map<string, string>();
  private readonly _dirtyNodes = new Set<string>();
  private _previewNodeId: string | null = null;
  private _pendingFocusId: string | null = null;

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _server: MessageServer,
    private readonly _onPanelActivated: (nodeId: string) => void,
    private readonly _isValidNodeId: (id: string) => boolean,
  ) {
    _context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(VIEWTYPE, this, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }),
      vscode.window.tabGroups.onDidChangeTabs(e => {
        if (!this._previewNodeId) return;
        for (const tab of e.changed) {
          if (!tab.isPreview &&
              tab.input instanceof vscode.TabInputCustom &&
              (tab.input as vscode.TabInputCustom).viewType === VIEWTYPE) {
            const nodeId = nodeIdFromUri((tab.input as vscode.TabInputCustom).uri);
            if (nodeId === this._previewNodeId) {
              this._previewNodeId = null;
              this._updateTitle(nodeId);
              break;
            }
          }
        }
      }),
    );
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    const nodeId = nodeIdFromUri(document.uri);
    if (!this._isValidNodeId(nodeId)) {
      webviewPanel.dispose();
      return;
    }

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };

    const type = this._types.get(nodeId) ?? '';
    if (type) {
      webviewPanel.iconPath = vscode.Uri.joinPath(
        this._context.extensionUri, 'media', 'icons', `badge-${type}.svg`,
      );
    }

    webviewPanel.webview.html = this._buildHtml(webviewPanel.webview, nodeId);
    this._panels.set(nodeId, webviewPanel);

    if (this._pendingFocusId === nodeId) {
      this._pendingFocusId = null;
      webviewPanel.reveal();
    }

    const disposable = this._server.registerWebview(webviewPanel.webview);

    this._updateTitle(nodeId);

    webviewPanel.onDidChangeViewState(e => {
      if (!e.webviewPanel.active) return;
      const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (!(activeTab?.input instanceof vscode.TabInputCustom)) return;
      if (nodeIdFromUri((activeTab.input as vscode.TabInputCustom).uri) !== nodeId) return;
      this._onPanelActivated(nodeId);
    });

    webviewPanel.onDidDispose(() => {
      this._panels.delete(nodeId);
      this._labels.delete(nodeId);
      this._types.delete(nodeId);
      this._dirtyNodes.delete(nodeId);
      if (this._previewNodeId === nodeId) this._previewNodeId = null;
      disposable.dispose();
    });
  }

  open(nodeId: string, label: string, _filePath: string, type = '', permanent = false): void {
    this._labels.set(nodeId, label);
    this._types.set(nodeId, type);

    const existing = this._panels.get(nodeId);
    if (existing) {
      if (!existing.active) existing.reveal();
      return;
    }

    if (!permanent) {
      this._previewNodeId = nodeId;
    }

    vscode.commands.executeCommand('vscode.openWith', nodeUri(nodeId), VIEWTYPE, {
      viewColumn: vscode.ViewColumn.Active,
      preview: !permanent,
    });
  }

  promote(nodeId: string): void {
    if (this._previewNodeId !== nodeId) return;
    this._previewNodeId = null;
    this._updateTitle(nodeId);
    if (!this._panels.has(nodeId)) return;
    vscode.commands.executeCommand('workbench.action.keepEditor');
  }

  isDirty(nodeId: string): boolean {
    return this._dirtyNodes.has(nodeId);
  }

  focusWhenReady(nodeId: string): void {
    this._pendingFocusId = nodeId;
  }

  closeAll(): string[] {
    const ids = [...this._panels.keys()];
    for (const panel of this._panels.values()) panel.dispose();
    return ids;
  }

  setDirty(nodeId: string, dirty: boolean): void {
    if (dirty) this._dirtyNodes.add(nodeId);
    else this._dirtyNodes.delete(nodeId);
    this._updateTitle(nodeId);
  }

  private _updateTitle(nodeId: string): void {
    const panel = this._panels.get(nodeId);
    if (!panel) return;
    const label = this._labels.get(nodeId) ?? '';
    panel.title = this._dirtyNodes.has(nodeId) ? `● ${label}` : label;
  }

  private _buildHtml(webview: vscode.Webview, nodeId: string): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'media', 'editor.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'media', 'editor.css'),
    );
    const csp = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src ${csp};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>YouProof</title>
</head>
<body>
  <div id="root" data-node-id="${nodeId}"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
