import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { MessageServer } from './protocol/messageServer';
import { SidebarProvider } from './views/sidebarProvider';
import { PanelManager } from './views/panelManager';
import { loadContent } from './content/loader';
import type { LoadedContent } from './content/model';
import { registerHandlers, resolveContentRoot } from './handlers';

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const server = new MessageServer();
  let contentCache: LoadedContent | null = null;
  let selectedId: string | null = null;

  function getContent(): LoadedContent {
    if (!contentCache) contentCache = loadContent(resolveContentRoot(context));
    return contentCache;
  }

  const panelManager = new PanelManager(context, server, (nodeId) => {
    if (nodeId !== selectedId) {
      selectedId = nodeId;
      server.notify('contentObjectSelected', { id: nodeId });
    }
  }, (id) => getContent().idToObject.has(id));

  registerHandlers({
    server,
    panelManager,
    context,
    getContent,
    getSelectedId:     () => selectedId,
    setSelectedId:     (id) => { selectedId = id; },
    resetContentCache: () => { contentCache = null; },
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, new SidebarProvider(context, server)),
  );

  watchForReload(context);
}

// ─── Dev-mode reload watcher ──────────────────────────────────────────────────

function watchForReload(context: vscode.ExtensionContext): void {
  let extensionDir = context.extensionUri.fsPath;
  try { extensionDir = fs.realpathSync(extensionDir); } catch { /* use as-is */ }

  const sentinelPath = path.join(extensionDir, '.needs-reload');
  const activatedAt  = Date.now();

  const checkSentinel = () => {
    try {
      const stat = fs.statSync(sentinelPath);
      fs.unlinkSync(sentinelPath);
      if (stat.mtimeMs > activatedAt) {
        vscode.window.showInformationMessage(
          'YouProof Editor updated. Reload to apply changes.', 'Reload VS Code',
        ).then(sel => { if (sel === 'Reload VS Code') vscode.commands.executeCommand('workbench.action.reloadWindow'); });
      }
    } catch { /* sentinel absent */ }
  };

  checkSentinel();
  try {
    const watcher = fs.watch(extensionDir, (_, filename) => {
      if (!filename || filename === '.needs-reload') checkSentinel();
    });
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch { /* fs.watch unavailable */ }
}

export function deactivate(): void {}
