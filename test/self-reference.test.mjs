// A figure's [*] in the host: the number the site gives the figure, and the
// self-reference display filled in with it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'

const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'vscode') return {}
  return realLoad.call(this, request, ...rest)
}

const { figureIndex, resolveSelfReference } = await import('../out/test/host.js')

const figure = (id) => ({ id, blockType: 'figure', src: 'x.png' })

function content() {
  const entity = { id: 'thm', type: 'theorem', body: [figure('in-theorem')] }
  const chapter = (name, prologue, sections, epilogue = []) => ({ name, prologue, sections: sections.map((body) => ({ body })), epilogue })
  const first = chapter('c1', [figure('a')], [[figure('b'), { id: 'e', blockType: 'embed', target: { type: 'theorem', target: 'thm' } }]])
  const second = chapter('c2', [], [[{ id: 's', blockType: 'subsection', blocks: [figure('c')] }], [figure('d')]], [figure('z')])
  const books = [{ parts: [{ chapters: [first] }, { chapters: [second] }] }]
  const ids = ['a', 'b', 'in-theorem', 'c', 'd', 'z', 'orphan']
  return { books, idToObject: new Map([...ids.map((id) => [id, figure(id)]), ['thm', entity]]) }
}

test('a figure is numbered among the figures of its chapter, embedded entities, subsections and parts included', () => {
  const c = content()
  assert.deepEqual(['a', 'b', 'in-theorem', 'c', 'd', 'z', 'orphan'].map((id) => figureIndex(c, id)),
    ['1.1.', '1.2.', '1.3.', '2.1.', '2.2.', '2.3.', undefined])
})

test('the self-reference display is filled in with the number, and says why where the site shows [*] as an error', () => {
  const c = content()
  assert.deepEqual(resolveSelfReference(c, 'd', '{the(target.index)} [{target.index} ábrán]'),
    { segments: [{ kind: 'text', text: 'a ' }, { kind: 'link', text: '2.2. ábrán', target: '' }, { kind: 'text', text: '' }] })
  assert.deepEqual(resolveSelfReference(c, 'orphan', '{target.index} [ábra]').segments[1], { kind: 'link', text: 'ábra', target: '' },
    'a figure no chapter shows keeps its display as written, as the site does')
  assert.match(resolveSelfReference(c, 'a', '').error, /no self-reference display/)
  assert.match(resolveSelfReference(c, 'new-block', '[ábra]').error, /once the file is saved/)
})
