// The webview's handling of a reference token in a CodeMirror field, at the level
// of the editor state, which needs no DOM: a token is never cut by a change or a
// selection, and undo, redo, copy and paste carry its item with it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  EditorState, EditorSelection, history, undo, redo, referenceTokens, isInReferenceToken, encodeReferenceToken, findReferenceTokens,
} = require('../out/test/webview.js')

const A = { text: '[a]', target: 'definitions.a' }
const B = { display: 'index-label', targets: ['definitions.b', 'definitions.c'] }
const tokenA = encodeReferenceToken(A)
const tokenB = encodeReferenceToken(B)

function field(doc) {
  return EditorState.create({ doc, extensions: [history(), referenceTokens()] })
}

const items = (state) => findReferenceTokens(state.doc.toString()).map((token) => token.item)

function run(state, command) {
  let next = state
  assert.ok(command({ state, dispatch: (tr) => { next = tr.state } }))
  return next
}

test('a token holds its item, and the payload holds none of the characters the inline grammar reads', () => {
  const tricky = { text: 'modulo $n$ **[e]** ^2^', target: 'https://example.org/é?x=[1]' }
  const token = encodeReferenceToken(tricky)
  assert.match(token, /^\[@[A-Za-z0-9_-]+\]$/)
  assert.deepEqual(findReferenceTokens(`előtte ${token} utána`).map((t) => t.item), [tricky])
})

test('a change that starts or ends inside a token takes the whole token, and an insertion inside one goes after it', () => {
  const doc = `Lásd ${tokenA} és ${tokenB}.`
  const [a] = findReferenceTokens(doc)
  let state = field(doc)
  state = state.update({ changes: { from: a.from + 3, to: a.to + 2, insert: 'X' }, userEvent: 'delete' }).state
  assert.equal(state.doc.toString(), `Lásd Xs ${tokenB}.`)
  const [b] = findReferenceTokens(state.doc.toString())
  state = state.update({ changes: { from: b.from + 4, insert: 'Y' }, userEvent: 'input.type' }).state
  assert.equal(state.doc.toString(), `Lásd Xs ${tokenB}Y.`)
})

test('a selection never starts or ends inside a token, and a caret steps over it', () => {
  const doc = `Lásd ${tokenA} itt.`
  const [a] = findReferenceTokens(doc)
  let state = field(doc)
  state = state.update({ selection: EditorSelection.range(2, a.from + 4) }).state
  assert.deepEqual([state.selection.main.anchor, state.selection.main.head], [2, a.to])
  state = state.update({ selection: EditorSelection.range(a.to + 2, a.from + 4) }).state
  assert.deepEqual([state.selection.main.anchor, state.selection.main.head], [a.to + 2, a.from])
  state = state.update({ selection: EditorSelection.cursor(2) }).state
  state = state.update({ selection: EditorSelection.cursor(a.from + 4) }).state
  assert.equal(state.selection.main.head, a.to, 'moving right, the caret lands after the token')
  state = state.update({ selection: EditorSelection.cursor(a.from + 4) }).state
  assert.equal(state.selection.main.head, a.from, 'moving left, before it')
  assert.ok(isInReferenceToken(doc, a.from) && !isInReferenceToken(doc, a.to))
})

test('deleting a selection that covers a token removes it, and undo and redo restore and remove it with its item', () => {
  const doc = `Lásd ${tokenA} és ${tokenB}.`
  const [a] = findReferenceTokens(doc)
  let state = field(doc)
  state = state.update({ changes: { from: a.from - 1, to: a.to }, userEvent: 'delete.selection' }).state
  assert.deepEqual(items(state), [B])
  state = run(state, undo)
  assert.equal(state.doc.toString(), doc)
  assert.deepEqual(items(state), [A, B])
  state = run(state, redo)
  assert.deepEqual(items(state), [B])
})

test('a copied token pasted elsewhere is a second, independent reference', () => {
  const doc = `Lásd ${tokenA}. Itt:`
  const [a] = findReferenceTokens(doc)
  let state = field(doc)
  const copied = state.sliceDoc(a.from - 5, a.to)
  state = state.update({ changes: { from: state.doc.length, insert: ` ${copied}` }, userEvent: 'input.paste' }).state
  assert.deepEqual(items(state), [A, A])
  const [first] = findReferenceTokens(state.doc.toString())
  state = state.update({ changes: { from: first.from, to: first.to }, userEvent: 'delete' }).state
  assert.deepEqual(items(state), [A], 'deleting the original leaves the copy')
})
