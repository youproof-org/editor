// A stand-in for the `vscode` module, enough to run the real extension
// (out/extension.js) outside VS Code: each webview is a page in headless Chromium,
// and the editor tabs follow VS Code's preview rules, as far as the extension
// relies on them (a preview tab is replaced by the next preview, keepEditor pins the
// active tab, and pinning shows in tabGroups.onDidChangeTabs).
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ORIGIN = 'http://vscode-webview.test'

const THEME = `:root {
  --vscode-font-family: -apple-system, "Segoe UI", sans-serif; --vscode-font-size: 13px;
  --vscode-editor-font-family: Menlo, monospace; --vscode-editor-font-size: 12px;
  --vscode-foreground: #cccccc; --vscode-editor-background: #1e1e1e; --vscode-sideBar-background: #252526;
  --vscode-editorWidget-background: #252526; --vscode-input-background: #3c3c3c; --vscode-descriptionForeground: #9d9d9d;
  --vscode-button-background: #0e639c; --vscode-button-foreground: #ffffff; --vscode-focusBorder: #007fd4;
  --vscode-list-activeSelectionBackground: #04395e; --vscode-list-hoverBackground: #2a2d2e;
}
body { background: var(--vscode-editor-background); color: var(--vscode-foreground); }`

class Emitter {
  listeners = new Set()
  event = (listener) => {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }
  fire(value) { for (const listener of [...this.listeners]) listener(value) }
}

class Uri {
  constructor(scheme, p) { this.scheme = scheme; this.path = p; this.fsPath = p }
  static file(p) { return new Uri('file', path.resolve(p)) }
  static from({ scheme, path: p }) { return new Uri(scheme, p) }
  static parse(s) { return Object.assign(new Uri('parsed', s), { toString: () => s }) }
  static joinPath(base, ...parts) { return new Uri(base.scheme, path.join(base.path, ...parts)) }
  toString() { return `${this.scheme}://${this.path}` }
}

class RelativePattern {
  constructor(base, pattern) { this.base = base; this.pattern = pattern }
}

class TabInputCustom {
  constructor(uri, viewType) { this.uri = uri; this.viewType = viewType }
}

/** The fake, and `vscode` as the extension sees it (`module`). */
export function createVscodeFake({ browser, settings, extensionDir }) {
  const errors = []
  const opened = []
  const external = []
  const watchers = []
  const pages = new Set()
  const tabsChanged = new Emitter()
  let customEditor = null
  let sidebarProvider = null
  const tabs = []
  let activeTab = null

  function webview(kind) {
    const received = new Emitter()
    let page = null
    let ready = null
    const view = {
      kind,
      options: {},
      cspSource: ORIGIN,
      asWebviewUri: (uri) => ({ toString: () => `${ORIGIN}${uri.fsPath}` }),
      onDidReceiveMessage: received.event,
      postMessage: async (message) => {
        await ready
        if (!page.isClosed()) await page.evaluate((m) => window.postMessage(m, '*'), message).catch(() => {})
        return true
      },
      get page() { return page },
      get ready() { return ready },
      set html(html) {
        ready = (async () => {
          page = await browser.newPage({ viewport: { width: 900, height: Number(process.env.YOUPROOF_UI_HEIGHT ?? 700) } })
          pages.add(page)
          page.on('pageerror', (error) => errors.push(`page error: ${error.message}`))
          await page.route(`${ORIGIN}/**`, (route) => {
            const url = new URL(route.request().url())
            if (url.pathname === '/__webview') {
              return route.fulfill({ contentType: 'text/html', body: html.replace('</head>', `<link href="${ORIGIN}/__theme.css" rel="stylesheet"></head>`) })
            }
            if (url.pathname === '/__theme.css') return route.fulfill({ contentType: 'text/css', body: THEME })
            const file = decodeURIComponent(url.pathname)
            const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'image/svg+xml'
            return route.fulfill({ contentType: type, body: readFileSync(file) })
          })
          await page.exposeFunction('__ypPostToHost', (message) => received.fire(message))
          await page.addInitScript(() => {
            window.acquireVsCodeApi = () => ({ postMessage: (message) => window.__ypPostToHost(message), getState: () => undefined, setState: () => {} })
          })
          await page.goto(`${ORIGIN}/__webview`)
        })()
      },
    }
    return view
  }

  function panel(uri) {
    const disposed = new Emitter()
    const viewState = new Emitter()
    const p = {
      webview: webview('panel'),
      title: '',
      iconPath: undefined,
      get active() { return activeTab?.panel === p },
      get visible() { return this.active },
      reveal: () => activate(tabs.find((tab) => tab.panel === p)),
      dispose: () => {
        const at = tabs.findIndex((tab) => tab.panel === p)
        if (at === -1) return
        const [tab] = tabs.splice(at, 1)
        if (activeTab === tab) activeTab = tabs.at(-1) ?? null
        disposed.fire()
        tab.page?.close().catch(() => {})
      },
      onDidDispose: disposed.event,
      onDidChangeViewState: viewState.event,
      viewState,
    }
    return p
  }

  function activate(tab) {
    if (!tab || activeTab === tab) return
    activeTab = tab
    tab.panel.viewState.fire({ webviewPanel: tab.panel })
  }

  async function openWith(uri, viewType, options) {
    const existing = tabs.find((tab) => tab.input.uri.path === uri.path)
    if (existing) { activate(existing); return }
    if (options?.preview) tabs.find((tab) => tab.isPreview)?.panel.dispose()
    const tab = { input: new TabInputCustom(uri, viewType), isPreview: !!options?.preview, panel: panel(uri) }
    tabs.push(tab)
    const document = customEditor.provider.openCustomDocument(uri)
    customEditor.provider.resolveCustomEditor(document, tab.panel, {})
    await tab.panel.webview.ready
    tab.page = tab.panel.webview.page
    activate(tab)
  }

  const module = {
    Uri, RelativePattern, TabInputCustom,
    ViewColumn: { Active: -1, One: 1 },
    window: {
      showErrorMessage: async (message) => { errors.push(message); return undefined },
      registerCustomEditorProvider: (viewType, provider) => { customEditor = { viewType, provider }; return { dispose() {} } },
      registerWebviewViewProvider: (viewId, provider) => { sidebarProvider = provider; return { dispose() {} } },
      tabGroups: {
        onDidChangeTabs: tabsChanged.event,
        get activeTabGroup() { return { activeTab } },
      },
    },
    workspace: {
      getConfiguration: () => ({ get: (key) => settings[key] }),
      get workspaceFolders() { return [{ uri: Uri.file(settings.contentRoot) }] },
      createFileSystemWatcher: (pattern) => {
        const change = new Emitter(); const create = new Emitter(); const remove = new Emitter()
        watchers.push({ pattern, change, create, remove })
        return { onDidChange: change.event, onDidCreate: create.event, onDidDelete: remove.event, dispose() {} }
      },
    },
    commands: {
      // VS Code runs an extension's commands in the order it sends them.
      executeCommand: (command, ...args) => (commandQueue = commandQueue.then(() => runCommand(command, ...args))),
    },
    env: { openExternal: async (uri) => { external.push(String(uri)); return true } },
  }

  let commandQueue = Promise.resolve()
  const commandsRun = []
  async function runCommand(command, ...args) {
    commandsRun.push(command)
    if (command === 'vscode.openWith') return openWith(...args)
    if (command === 'workbench.action.keepEditor') {
      if (activeTab?.isPreview) {
        activeTab.isPreview = false
        tabsChanged.fire({ opened: [], closed: [], changed: [activeTab] })
      }
      return undefined
    }
    if (command === 'vscode.open') { opened.push(args[0].fsPath); return undefined }
    throw new Error(`the fake has no command ${command}`)
  }

  return {
    module,
    errors,
    opened,
    commandsRun,
    /** Settles when the commands sent so far have run. */
    idle: () => commandQueue,
    external,
    context: { subscriptions: [], extensionUri: Uri.file(extensionDir) },
    /** The open editor tabs, in order, as `{ nodeId, preview, active, page }`. */
    tabs: () => tabs.map((tab) => ({
      nodeId: tab.input.uri.path.slice(1).replace(/\.youproof-node$/, ''),
      preview: tab.isPreview, active: tab === activeTab, page: tab.page,
    })),
    /** Close every editor tab, as the user would. */
    closeTabs() {
      for (const tab of [...tabs]) tab.panel.dispose()
    },
    async sidebar() {
      const view = { webview: webview('sidebar'), onDidDispose: () => ({ dispose() {} }), onDidChangeVisibility: () => ({ dispose() {} }), visible: true }
      sidebarProvider.resolveWebviewView(view)
      await view.webview.ready
      return view.webview
    },
    /** Tell the watchers a file changed on disk, as VS Code would. */
    fileChanged(file) {
      for (const { pattern, change } of watchers) {
        const glob = new RegExp(`^${pattern.pattern.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*')}$`)
        if (path.dirname(file) === pattern.base.fsPath && glob.test(path.basename(file))) change.fire(Uri.file(file))
      }
    },
    async close() {
      for (const page of pages) await page.close().catch(() => {})
    },
  }
}
