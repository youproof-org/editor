// What the reference popup does to a CodeMirror field, at the level of the editor
// state: confirming writes one token as one step of the history, an edit's preview
// shows in its token without changing the text, and closing it changes nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  EditorState, EditorSelection, EditorView, history, undo, redo, undoDepth, referenceTokens, referenceTokenText,
  encodeReferenceToken, findReferenceTokens, openReferencePopup, previewReference, closeReferencePopup, referencePopupField,
  confirmReferenceSpec, confirmSelfReferenceSpec, removeReferenceSpec, cancelReferenceSpec, referenceTokenAtCaret, selectedReferenceToken,
} = require('../out/test/webview.js')

const PRIME = { text: 'prím', target: 'definitions.p.terms.prime' }
const THEOREM = { display: 'the-index-label', target: 'theorems.t' }
const OTHER = { display: 'index-label-ine', target: 'theorems.t' }
const segments = {
  [findReferenceTokens(encodeReferenceToken(PRIME))[0].payload]: [{ kind: 'link', text: 'prím', target: 'definitions.p.terms.prime' }],
  [findReferenceTokens(encodeReferenceToken(THEOREM))[0].payload]: [{ kind: 'text', text: 'a ' }, { kind: 'link', text: '23.10. Tétel', target: 'theorems.t' }],
  [findReferenceTokens(encodeReferenceToken(OTHER))[0].payload]: [{ kind: 'text', text: 'a ' }, { kind: 'link', text: '23.10. Tétel', target: 'theorems.t' }, { kind: 'text', text: 'ben' }],
}
const displays = { get: (payload) => (segments[payload] ? { segments: segments[payload] } : undefined), subscribe: () => () => {} }

function field(doc, selection) {
  return EditorState.create({ doc, selection, extensions: [history(), referenceTokens({ displays })] })
}
const items = (state) => findReferenceTokens(state.doc.toString()).map((token) => token.item)
const apply = (state, spec) => state.update(spec).state
function run(state, command) {
  let next = state
  assert.ok(command({ state, dispatch: (tr) => { next = tr.state } }))
  return next
}
const open = (state, mode, from, to) => apply(state, { effects: openReferencePopup.of({ mode, from, to }) })

function shown(state) {
  const views = []
  for (const source of state.facet(EditorView.decorations)) {
    if (typeof source === 'function') continue
    source.between(0, state.doc.length, (_from, _to, decoration) => { views.push([decoration.spec.widget.role, referenceTokenText(decoration.spec.widget.view)]) })
  }
  return views
}

test('confirming the create popup puts one token at the caret, and one undo takes it away again', () => {
  let state = field('Ha $n$ ', EditorSelection.cursor(7))
  state = apply(state, { changes: { from: 7, insert: 'x ' }, selection: EditorSelection.cursor(9), userEvent: 'input.type' })
  state = open(state, 'create', 9, 9)
  state = apply(state, confirmReferenceSpec(state, PRIME))
  assert.deepEqual(items(state), [PRIME])
  assert.equal(state.selection.main.head, state.doc.length, 'the caret is after the token')
  assert.equal(state.field(referencePopupField), null)
  state = run(state, undo)
  assert.equal(state.doc.toString(), 'Ha $n$ x ', 'only the token goes, not the typing before it')
  state = run(state, redo)
  assert.deepEqual(items(state), [PRIME])
})

test('with a selection, the token replaces the selected words in one step', () => {
  let state = field('Ha $n$ prím, akkor', EditorSelection.range(7, 11))
  state = open(state, 'create', 7, 11)
  state = apply(state, confirmReferenceSpec(state, PRIME))
  assert.equal(state.doc.toString(), `Ha $n$ ${encodeReferenceToken(PRIME)}, akkor`)
  assert.equal(undoDepth(state), 1)
  state = run(state, undo)
  assert.equal(state.doc.toString(), 'Ha $n$ prím, akkor')
})

test('confirming an edit replaces the token, and undo brings back the old item', () => {
  const doc = `Lásd ${encodeReferenceToken(THEOREM)} itt.`
  const [token] = findReferenceTokens(doc)
  let state = open(field(doc), 'edit', token.from, token.to)
  state = apply(state, confirmReferenceSpec(state, OTHER))
  assert.deepEqual(items(state), [OTHER])
  state = run(state, undo)
  assert.deepEqual(items(state), [THEOREM])
  assert.equal(state.doc.toString(), doc)
})

test('the edit preview shows in the token, highlighted, without changing the text', () => {
  const doc = `Lásd ${encodeReferenceToken(THEOREM)} itt.`
  const [token] = findReferenceTokens(doc)
  let state = open(field(doc), 'edit', token.from, token.to)
  assert.deepEqual(shown(state), [['active', 'a [23.10. Tétel]']])
  state = apply(state, { effects: previewReference.of(findReferenceTokens(encodeReferenceToken(OTHER))[0].payload) })
  assert.equal(state.doc.toString(), doc)
  assert.deepEqual(shown(state), [['active', 'a [23.10. Tétel]ben']])
  state = apply(state, cancelReferenceSpec())
  assert.equal(state.doc.toString(), doc)
  assert.deepEqual(shown(state), [['token', 'a [23.10. Tétel]']], 'Escape restores the token as it was')
  assert.equal(undoDepth(state), 0, 'opening, previewing and closing add nothing to the history')
})

test('the create popup shows its draft as a ghost at the caret, capitalized where a sentence starts', () => {
  let state = open(field('Kész. '), 'create', 6, 6)
  assert.deepEqual(shown(state), [])
  state = apply(state, { effects: previewReference.of(findReferenceTokens(encodeReferenceToken(THEOREM))[0].payload) })
  assert.deepEqual(shown(state), [['ghost', 'A [23.10. Tétel]']])
  assert.equal(state.doc.toString(), 'Kész. ')
  state = apply(state, { effects: closeReferencePopup.of(null) })
  assert.deepEqual(shown(state), [])
})

test('removing in the edit popup deletes the token in one step, and the figure self-reference is [*]', () => {
  const doc = `Lásd ${encodeReferenceToken(THEOREM)} itt.`
  const [token] = findReferenceTokens(doc)
  let state = open(field(doc), 'edit', token.from, token.to)
  state = apply(state, removeReferenceSpec(state))
  assert.equal(state.doc.toString(), 'Lásd  itt.')
  state = run(state, undo)
  assert.equal(state.doc.toString(), doc)
  let figure = open(field('Az ábra: '), 'create', 9, 9)
  figure = apply(figure, confirmSelfReferenceSpec(figure))
  assert.equal(figure.doc.toString(), 'Az ábra: [*]')
  assert.deepEqual(removeReferenceSpec(figure), {}, 'nothing to remove without an edit popup')
})

test('the popup follows its token through other changes, and ends when its token is deleted', () => {
  const doc = `Lásd ${encodeReferenceToken(THEOREM)} itt.`
  const [token] = findReferenceTokens(doc)
  let state = open(field(doc), 'edit', token.from, token.to)
  state = apply(state, { changes: { from: 0, insert: 'Most ' } })
  assert.deepEqual(state.field(referencePopupField), { mode: 'edit', from: token.from + 5, to: token.to + 5 })
  state = apply(state, { changes: { from: state.doc.length, insert: '!' } })
  assert.equal(state.field(referencePopupField).from, token.from + 5)
  state = apply(state, { changes: { from: token.from + 5, to: token.to + 5 } })
  assert.equal(state.field(referencePopupField), null)
  let create = open(field('ab'), 'create', 1, 1)
  create = apply(create, { changes: { from: 0, insert: 'x' } })
  assert.deepEqual(create.field(referencePopupField), { mode: 'create', from: 2, to: 2 })
})

test('F2 finds the token touching the caret, the one before it first, and Enter a token that is selected', () => {
  const a = encodeReferenceToken(PRIME)
  const b = encodeReferenceToken(THEOREM)
  const doc = `x ${a}${b} y`
  const [ta, tb] = findReferenceTokens(doc)
  assert.deepEqual(referenceTokenAtCaret(field(doc, EditorSelection.cursor(ta.to))), { from: ta.from, to: ta.to })
  assert.deepEqual(referenceTokenAtCaret(field(doc, EditorSelection.cursor(ta.from))), { from: ta.from, to: ta.to })
  assert.deepEqual(referenceTokenAtCaret(field(doc, EditorSelection.cursor(tb.to))), { from: tb.from, to: tb.to })
  assert.equal(referenceTokenAtCaret(field(doc, EditorSelection.cursor(0))), null)
  assert.deepEqual(selectedReferenceToken(field(doc, EditorSelection.range(tb.to, tb.from))), { from: tb.from, to: tb.to })
  assert.equal(selectedReferenceToken(field(doc, EditorSelection.range(ta.from, tb.to))), null, 'two tokens are not one')
  assert.equal(selectedReferenceToken(field(doc, EditorSelection.cursor(ta.to))), null)
})
