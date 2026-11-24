import * as vscode from 'vscode';
import { MessageServer } from './protocol/messageServer';
import { SidebarProvider } from './views/sidebarProvider';
import { PanelManager } from './views/panelManager';
import { loadContent } from './content/loader';
import { setLocales } from './content/locales';
import { readServicesData, ServicesDataError, type ServicesData } from './content/servicesData';
import type { LoadedContent } from './content/model';
import { registerHandlers, resolveContentRoot, resolveServicesRootSetting } from './handlers';

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const server = new MessageServer();
  let contentCache: LoadedContent | null = null;
  let services: ServicesData | null = null;
  let selectedId: string | null = null;
  // The editor loads exactly one locale at a time; youproof.defaultLocale (else the
  // first configured locale) on startup, switched by the per-locale reload buttons (see the reloadModel handler).
  let activeLocale: string | null = null;

  function reloadServices(): ServicesData {
    services = null;
    setLocales([]);
    const loaded = readServicesData(
      resolveServicesRootSetting(context, resolveContentRoot(context)),
      vscode.workspace.getConfiguration('youproof').get<string>('defaultLocale'),
    );
    setLocales(loaded.localeConfig.locales);
    if (loaded.entityLabelsError) {
      vscode.window.showErrorMessage(`${loaded.entityLabelsError} The entity label picker is unavailable until it is fixed.`);
    }
    if (!activeLocale || !loaded.localeConfig.locales.includes(activeLocale)) {
      activeLocale = loaded.localeConfig.defaultLocale;
    }
    services = loaded;
    return loaded;
  }

  function getServices(): ServicesData {
    return services ?? reloadServices();
  }

  function getContent(): LoadedContent {
    if (!contentCache) {
      const { localeConfig } = getServices();
      contentCache = loadContent(resolveContentRoot(context), activeLocale ?? localeConfig.defaultLocale, localeConfig.locales[0]);
    }
    return contentCache;
  }

  const contentRootSet = !!vscode.workspace.getConfiguration('youproof').get<string>('contentRoot')?.trim();
  if (contentRootSet) {
    try {
      reloadServices();
    } catch (err) {
      if (err instanceof ServicesDataError) vscode.window.showErrorMessage(err.message);
      else throw err;
    }
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
    getServices,
    reloadServices,
    getSelectedId:     () => selectedId,
    setSelectedId:     (id) => { selectedId = id; },
    resetContentCache: () => { contentCache = null; },
    getActiveLocale:   () => activeLocale ?? getServices().localeConfig.defaultLocale,
    setActiveLocale:   (l) => { activeLocale = l; },
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, new SidebarProvider(context, server)),
  );
}

export function deactivate(): void {}
