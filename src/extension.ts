import * as path from 'path';
import * as vscode from 'vscode';
import { MessageServer } from './protocol/messageServer';
import { SidebarProvider } from './views/sidebarProvider';
import { PanelManager } from './views/panelManager';
import { loadContent } from './content/loader';
import { setLocales } from './content/locales';
import { readServicesData, ServicesDataError, type ServicesData } from './content/servicesData';
import {
  describeDisplayTemplateErrors, DISPLAY_TEMPLATES_DIR, displayTemplatesFile, readDisplayTemplates, type DisplayTemplates,
} from './content/displayTemplates';
import { describeNumberingProblems, numberContent } from './content/numbering';
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
  let displayTemplates: DisplayTemplates | null = null;
  let reportedNumberingProblems: string | undefined;

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

  function reloadDisplayTemplates(): DisplayTemplates {
    const { localeConfig, entityLabels } = getServices();
    const loaded = readDisplayTemplates(
      resolveContentRoot(context), activeLocale ?? localeConfig.defaultLocale, entityLabels, localeConfig.locales,
    );
    const problem = describeDisplayTemplateErrors(loaded);
    if (problem) vscode.window.showErrorMessage(problem);
    displayTemplates = loaded;
    return loaded;
  }

  function getDisplayTemplates(): DisplayTemplates {
    const locale = activeLocale ?? getServices().localeConfig.defaultLocale;
    return displayTemplates?.locale === locale ? displayTemplates : reloadDisplayTemplates();
  }

  function getContent(): LoadedContent {
    if (!contentCache) {
      const { localeConfig } = getServices();
      contentCache = loadContent(resolveContentRoot(context), activeLocale ?? localeConfig.defaultLocale, localeConfig.locales[0]);
      reportNumberingProblems(contentCache);
    }
    return contentCache;
  }

  // Shown when the problems change, so a save that leaves them as they were
  // doesn't show them again; a reload always does.
  function reportNumberingProblems(content: LoadedContent): void {
    const problem = describeNumberingProblems(numberContent(content).problems);
    if (problem && problem !== reportedNumberingProblems) vscode.window.showErrorMessage(problem);
    reportedNumberingProblems = problem;
  }

  const contentRootSet = !!vscode.workspace.getConfiguration('youproof').get<string>('contentRoot')?.trim();
  if (contentRootSet) {
    try {
      reloadServices();
      reloadDisplayTemplates();
    } catch (err) {
      if (err instanceof ServicesDataError) vscode.window.showErrorMessage(err.message);
      else throw err;
    }
    watchDisplayTemplates();
  }

  function watchDisplayTemplates(): void {
    const dir = vscode.Uri.file(path.join(resolveContentRoot(context), DISPLAY_TEMPLATES_DIR));
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, 'display-templates.*.yaml'));
    const onChange = (uri: vscode.Uri): void => {
      if (!services) return;
      const locale = activeLocale ?? services.localeConfig.defaultLocale;
      if (uri.fsPath === displayTemplatesFile(resolveContentRoot(context), locale)) reloadDisplayTemplates();
    };
    watcher.onDidChange(onChange);
    watcher.onDidCreate(onChange);
    watcher.onDidDelete(onChange);
    context.subscriptions.push(watcher);
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
    reloadServices:    () => {
      displayTemplates = null;
      return reloadServices();
    },
    getSelectedId:     () => selectedId,
    setSelectedId:     (id) => { selectedId = id; },
    resetContentCache: () => {
      contentCache = null;
      reportedNumberingProblems = undefined;
    },
    contentChanged:    () => { if (contentCache) reportNumberingProblems(contentCache); },
    getActiveLocale:   () => activeLocale ?? getServices().localeConfig.defaultLocale,
    setActiveLocale:   (l) => {
      activeLocale = l;
      getDisplayTemplates();
    },
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, new SidebarProvider(context, server)),
  );
}

export function deactivate(): void {}
