// Runs the real extension (out/extension.js, built by `node scripts/build.js
// --tests`) against the fake `vscode` module in vscodeFake.mjs, on a copy of a
// content tree, with every webview a page in headless Chromium.
import Module, { createRequire } from 'node:module'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createVscodeFake } from './vscodeFake.mjs'

const editorDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const FIXTURE = path.join(editorDir, 'test', 'ui', 'fixture', 'content')
const servicesDir = process.env.SERVICES_DIR || path.resolve(editorDir, '..', 'services')
const require = createRequire(import.meta.url)
const I18N = path.join('apps', 'website', 'lib', 'i18n')

let currentFake = null
const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'vscode') return currentFake.module
  return realLoad.call(this, request, ...rest)
}

let browser = null
async function sharedBrowser() {
  browser ??= await chromium.launch()
  return browser
}

export async function closeBrowser() {
  await browser?.close()
  browser = null
}

/**
 * A running extension over a copy of `content` (the checked-in fixture unless
 * given), with its sidebar open. Close it with `close()`.
 */
export async function openSession({ content = FIXTURE } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'yp-ui-'))
  cpSync(content, root, { recursive: true })
  const services = mkdtempSync(path.join(tmpdir(), 'yp-ui-services-'))
  cpSync(path.join(servicesDir, I18N), path.join(services, I18N), { recursive: true })
  const fake = createVscodeFake({ browser: await sharedBrowser(), settings: { contentRoot: root, servicesRoot: services }, extensionDir: editorDir })
  currentFake = fake
  const entry = require.resolve(path.join(editorDir, 'out', 'extension.js'))
  delete require.cache[entry]
  require(entry).activate(fake.context)
  const sidebar = await fake.sidebar()
  let next = 0
  const pending = new Map()
  const post = sidebar.postMessage
  sidebar.postMessage = (message) => {
    if (message?.kind === 'response' && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(message.error)); else resolve(message.result)
      return Promise.resolve(true)
    }
    return post(message)
  }
  /** A request to the host, as the sidebar would send it. */
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = `ui-test-${next++}`
    pending.set(id, { resolve, reject })
    sidebar.page.evaluate(({ id, method, params }) => window.__ypPostToHost({ kind: 'request', id, method, params }), { id, method, params })
  })

  const tree = async () => {
    const { books, kb } = await request('getContentTree', {})
    const all = []
    const walk = (items) => { for (const item of items ?? []) { all.push(item); walk(item.children) } }
    walk(books); walk(kb)
    return all
  }
  const idOf = async (label) => {
    const found = (await tree()).filter((item) => item.label === label)
    if (found.length !== 1) throw new Error(`${found.length} tree items are labelled ${label}`)
    return found[0].id
  }

  return {
    root,
    fake,
    sidebar: sidebar.page,
    request,
    tree,
    idOf,
    errors: fake.errors,
    /** Open the panel of the tree item labelled `label`, as a click in the sidebar does, or a double click, which is a click and then a permanent select. */
    async open(label, options) {
      return this.openId(await idOf(label), options)
    },
    /** The same, for the content object `id`. */
    async openId(id, { permanent = false } = {}) {
      await request('selectContentObject', { id })
      await fake.idle()
      if (permanent) {
        await waitFor(() => fake.tabs().find((tab) => tab.nodeId === id)?.page)
        await request('selectContentObject', { id, permanent: true })
        await fake.idle()
      }
      const page = await waitFor(() => fake.tabs().find((tab) => tab.nodeId === id)?.page)
      await page.waitForSelector('.node-view')
      await page.waitForFunction(() => !document.querySelector('.cm-yp-ref-pending'))
      return page
    },
    file: (rel) => path.join(root, rel),
    /** The copy of the services files the extension reads, the locales and the entity label registry. */
    servicesFile: (name) => path.join(services, I18N, name),
    read: (rel) => readFileSync(path.join(root, rel), 'utf8'),
    write(rel, text) {
      writeFileSync(path.join(root, rel), text)
      fake.fileChanged(path.join(root, rel))
    },
    async close() {
      await fake.close()
      rmSync(root, { recursive: true, force: true })
      rmSync(services, { recursive: true, force: true })
    },
  }
}

export async function waitFor(get, { timeout = 5000 } = {}) {
  const until = Date.now() + timeout
  for (;;) {
    const value = await get()
    if (value) return value
    if (Date.now() > until) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
