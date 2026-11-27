import { test } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'

const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'vscode') return {}
  return realLoad.call(this, request, ...rest)
}

const { registerHandlers } = await import('../out/test/host.js')

function handlers() {
  const content = {
    idToFilePath: new Map([['section', '/c/section.yaml'], ['theorem', '/c/theorem.yaml']]),
    idToObject: new Map([
      ['section', { type: 'section', name: 'section' }],
      ['theorem', { type: 'theorem', name: 'theorem' }],
      ['claim', { type: 'claim', name: 'claim', parent: { id: 'theorem' } }],
    ]),
  }
  const calls = []
  const requests = new Map()
  registerHandlers({
    server: { onRequest: (method, handler) => requests.set(method, handler), notify: () => {} },
    getContent: () => content,
    getSelectedId: () => null,
    setSelectedId: () => {},
    panelManager: {
      open: (id) => { calls.push(`open ${id}`) },
      promote: async (id) => { await Promise.resolve(); calls.push(`promote ${id}`) },
    },
  })
  return { select: requests.get('selectContentObject'), calls }
}

test('a panel that opens a target is promoted out of preview first, and the target opens as a preview', async () => {
  const { select, calls } = handlers()
  await select({ id: 'theorem', openedFrom: 'section' })
  assert.deepEqual(calls, ['promote section', 'open theorem'])
})

test('a target in the panel\'s own file promotes nothing', async () => {
  const { select, calls } = handlers()
  await select({ id: 'claim', openedFrom: 'theorem' })
  assert.deepEqual(calls, ['open theorem'])
})

test('a sidebar click opens a preview and promotes nothing', async () => {
  const { select, calls } = handlers()
  await select({ id: 'theorem' })
  assert.deepEqual(calls, ['open theorem'])
})
