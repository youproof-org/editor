import * as vscode from 'vscode';
import { MessageServer } from './protocol/messageServer';
import { SidebarProvider } from './views/sidebarProvider';
import { PanelManager } from './views/panelManager';
import { loadContent } from './content/loader';
import { DEFAULT_LOCALE } from './content/locales';
import type { LoadedContent } from './content/model';
import { registerHandlers, resolveContentRoot } from './handlers';

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const server = new MessageServer();
  let contentCache: LoadedContent | null = null;
  let selectedId: string | null = null;
  // The editor loads exactly one locale at a time; DEFAULT_LOCALE on startup,
  // switched by the per-locale reload buttons (see the reloadModel handler).
  let activeLocale = DEFAULT_LOCALE;

  function getContent(): LoadedContent {
    if (!contentCache) contentCache = loadContent(resolveContentRoot(context), activeLocale);
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
    getActiveLocale:   () => activeLocale,
    setActiveLocale:   (l) => { activeLocale = l; },
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, new SidebarProvider(context, server)),
  );
}

export function deactivate(): void {}
