// The reference popup's logic, apart from React and the DOM: the search over the
// catalogue, the templates it offers for the targets, the draft's problems in the
// words of the site build's reader, the item a confirm writes, Text mode, and
// where the popup goes so that it never covers what it belongs to.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Module from 'node:module'

const require = createRequire(import.meta.url)
const {
  searchReferenceTargets, candidateTemplates, filterTemplates, draftProblem, textModeProblem, buildReferenceItem,
  draftFromItem, leavesItemUnchanged, textFromSegments, targetGroups, choicesByPath, draftTarget, orderedTargets,
  canReorder, kindsKey,
} = require('../out/test/webview.js')

const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'vscode') return {}
  return realLoad.call(this, request, ...rest)
}
const host = await import('../out/test/host.js')

const chapter = (n, title, position) => ({
  path: `books.b.chapters.c${n}`, kind: 'chapter', id: `c${n}`, label: `${n}.`, title, position, groups: { type: 'chapter' },
})
const CHOICES = {
  templates: [
    { name: 'index-label', targets: ['definition', 'theorem'], count: { min: 1, max: 1 }, list: false, order: 'sorted', uses: { theorem: 3, definition: 9 } },
    { name: 'the-index-label', targets: ['definition', 'theorem'], count: { min: 1, max: 1 }, list: false, order: 'sorted', uses: { theorem: 20 } },
    { name: 'the-index-chapter', targets: ['chapter'], count: { min: 1, max: 1 }, list: false, order: 'sorted', uses: { chapter: 5 } },
    { name: 'claim-point', targets: ['claim'], count: { min: 1, max: 1 }, list: false, order: 'sorted', uses: {} },
    { name: 'claim-statement', targets: ['claim'], count: { min: 1, max: 1 }, list: false, order: 'sorted', uses: {} },
    { name: 'indexes-chapter', targets: ['chapter'], count: { min: 2 }, list: true, order: 'sorted', uses: { chapter: 2 } },
    { name: 'chapters-authored', targets: ['chapter'], count: { min: 2, max: 3 }, list: true, order: 'authored', uses: {} },
    { name: 'each-label', targets: ['definition', 'theorem'], count: { min: 2 }, list: true, order: 'sorted', groupBy: 'label', uses: { 'definition+theorem': 4 } },
  ],
  targets: [
    chapter(23, 'Alice és Bob prímszámok után nyomoz', 1),
    { path: 'definitions.d', kind: 'definition', id: 'd', label: '23.9. Definíció', labelName: 'Definíció', title: 'Miller-Rabin-tanú', position: 2, groups: { type: 'definition', label: 'definition:definition' } },
    { path: 'definitions.p', kind: 'definition', id: 'p', label: '16.13. Definíció', labelName: 'Definíció', title: 'Prímtulajdonságú elem', position: 3, groups: { type: 'definition', label: 'definition:definition' } },
    {
      path: 'definitions.p.terms.prime', kind: 'term', id: 'pt', label: 'prímtulajdonságú elem', owner: '16.13. Definíció', synonyms: ['prím'],
      texts: [{ text: 'prím', uses: 172 }, { text: 'prímszám', uses: 87 }, { text: 'prímtulajdonságú', uses: 19 }], position: 4, groups: { type: 'term' },
    },
    { path: 'theorems.t', kind: 'theorem', id: 't', label: '23.10. Tétel', labelName: 'Tétel', title: 'Prímszámok tanúi', position: 5, groups: { type: 'theorem', label: 'theorem:theorem' } },
    { path: 'theorems.t.claims.c', kind: 'claim', id: 'tc', label: '3.', owner: '23.10. Tétel', position: 6, groups: { type: 'claim', parent: 'theorems.t' } },
    chapter(24, 'Alice és Bob komolyabb fegyverekhez nyúl', 7),
    { path: 'theorems.u', kind: 'theorem', id: 'u', label: '24.16. Tétel', labelName: 'Tétel', title: 'A Miller-Rabin-nemtanúk', position: 8, groups: { type: 'theorem', label: 'theorem:theorem' } },
    { path: 'definitions.q.terms.composite', kind: 'term', id: 'q', label: 'összetett szám', texts: [{ text: 'összetett', uses: 3 }], groups: { type: 'term' } },
  ],
}
const byPath = choicesByPath(CHOICES)
const t = (p) => draftTarget(p, byPath)
const names = (templates) => templates.map((template) => template.name)
const shown = (hits) => hits.map((hit) => (hit.kind === 'term' ? `${hit.text} -> ${hit.target.path}`
  : hit.kind === 'target' ? hit.target.path : hit.kind === 'url' ? `url ${hit.url}` : hit.kind === 'path' ? `path ${hit.path}` : 'self'))

test('a word finds the link texts other references use for a term, most used first, then the term by its forms', () => {
  assert.deepEqual(shown(searchReferenceTargets(CHOICES, 'prím')).slice(0, 4), [
    'prím -> definitions.p.terms.prime',
    'prímszám -> definitions.p.terms.prime',
    'prímtulajdonságú -> definitions.p.terms.prime',
    'prímtulajdonságú elem -> definitions.p.terms.prime',
  ])
  assert.deepEqual(shown(searchReferenceTargets(CHOICES, 'Primsz')), [
    'prímszám -> definitions.p.terms.prime', 'books.b.chapters.c23', 'theorems.t',
  ], 'case and accents fold; then the titles with a word that starts with it, in reading order')
  assert.deepEqual(shown(searchReferenceTargets(CHOICES, 'tetel')).slice(0, 3), ['theorems.t', 'theorems.t.claims.c', 'theorems.u'])
  assert.deepEqual(shown(searchReferenceTargets(CHOICES, 'rabin')), ['definitions.d', 'theorems.u'], 'a word inside a title')
  assert.deepEqual(shown(searchReferenceTargets(CHOICES, 'zetett')), ['összetett -> definitions.q.terms.composite', 'összetett szám -> definitions.q.terms.composite'], 'contains comes last')
})

test('a number finds the numbered target, a URL gives a URL row, a path a path row, * the self-reference', () => {
  assert.deepEqual(shown(searchReferenceTargets(CHOICES, '24.16')), ['theorems.u'])
  assert.deepEqual(shown(searchReferenceTargets(CHOICES, '23.10')), ['theorems.t', 'theorems.t.claims.c'])
  assert.deepEqual(shown(searchReferenceTargets(CHOICES, '23')).slice(0, 3), ['books.b.chapters.c23', 'definitions.d', 'theorems.t'])
  assert.deepEqual(shown(searchReferenceTargets(CHOICES, ' https://hu.wikipedia.org/wiki/Prímszám ')), ['url https://hu.wikipedia.org/wiki/Prímszám'])
  assert.deepEqual(shown(searchReferenceTargets(CHOICES, 'articles.puthagorasz')), ['path articles.puthagorasz'])
  assert.deepEqual(shown(searchReferenceTargets(CHOICES, 'theorems.u')), ['theorems.u'], 'a path the catalogue has is its target')
  assert.deepEqual(shown(searchReferenceTargets(CHOICES, '*')), [])
  assert.deepEqual(shown(searchReferenceTargets(CHOICES, '*', { allowSelfReference: true })), ['self'])
  assert.deepEqual(shown(searchReferenceTargets(CHOICES, '', { allowSelfReference: true })), ['self'])
  assert.deepEqual(shown(searchReferenceTargets(CHOICES, '')), [])
})

test('the templates offered take every target kind and the count, the most used for the kinds first, ties in collection order', () => {
  assert.deepEqual(names(candidateTemplates(CHOICES.templates, [t('theorems.t')])), ['the-index-label', 'index-label'])
  assert.deepEqual(names(candidateTemplates(CHOICES.templates, [t('definitions.d')])), ['index-label', 'the-index-label'])
  assert.deepEqual(names(candidateTemplates(CHOICES.templates, [t('theorems.t.claims.c')])), ['claim-point', 'claim-statement'])
  assert.deepEqual(names(candidateTemplates(CHOICES.templates, [t('books.b.chapters.c23'), t('books.b.chapters.c24')])), ['indexes-chapter', 'chapters-authored'])
  assert.deepEqual(names(candidateTemplates(CHOICES.templates, [t('definitions.d'), t('theorems.t')])), ['each-label'])
  assert.deepEqual(names(candidateTemplates(CHOICES.templates, [t('books.b.chapters.c23'), t('theorems.t')])), [])
  assert.deepEqual(names(candidateTemplates(CHOICES.templates, [t('https://example.org')])), [], 'no template takes a URL')
  assert.equal(kindsKey(['theorem', 'definition', 'theorem']), 'definition+theorem')
  const preview = { 'index-label': 'a [23.10. Tétel]ban', 'the-index-label': 'a [23.10. Tétel]' }
  assert.deepEqual(names(filterTemplates(candidateTemplates(CHOICES.templates, [t('theorems.t')]), 'BAN', (n) => preview[n])), ['index-label'])
  assert.deepEqual(names(filterTemplates(CHOICES.templates, 'chapter', () => undefined)), ['the-index-chapter', 'indexes-chapter', 'chapters-authored'])
})

test('a target change that makes the chosen template invalid keeps the choice and says why, as the reader does', () => {
  const draft = { mode: 'template', display: 'the-index-chapter', text: '', targets: [t('books.b.chapters.c23')] }
  assert.equal(draftProblem(draft, CHOICES.templates), undefined)
  const added = { ...draft, targets: [...draft.targets, t('books.b.chapters.c24')] }
  assert.equal(draftProblem(added, CHOICES.templates), "template 'the-index-chapter' takes exactly 1 target, not 2")
  assert.equal(added.display, 'the-index-chapter')
  const wrongKind = { ...draft, targets: [t('theorems.t')] }
  assert.equal(draftProblem(wrongKind, CHOICES.templates), "template 'the-index-chapter' takes chapter targets, not a theorem ('theorems.t')")
  assert.equal(draftProblem({ ...draft, targets: [] }, CHOICES.templates), 'Add a target.')
  assert.equal(draftProblem({ ...draft, display: undefined }, CHOICES.templates), 'Choose a template.')
  assert.match(draftProblem({ mode: 'text', text: 'a {x}', targets: [t('theorems.t')] }, CHOICES.templates), /^text: \{x\} is an expression/)
  assert.equal(draftProblem({ mode: 'text', text: '', targets: [t('theorems.t')] }, CHOICES.templates), "'text' must be non-empty link text")
})

test('the problems read as the site build\'s reader words them', () => {
  const collection = Object.fromEntries(CHOICES.templates.map((c) => [c.name, c.list
    ? { kind: 'list', name: c.name, targets: c.targets, list: { count: c.count } }
    : { kind: 'single', name: c.name, targets: c.targets, template: '[x]' }]))
  const drafts = [
    { mode: 'template', display: 'the-index-chapter', text: '', targets: [t('books.b.chapters.c23'), t('books.b.chapters.c24')] },
    { mode: 'template', display: 'the-index-chapter', text: '', targets: [t('theorems.t')] },
    { mode: 'template', display: 'chapters-authored', text: '', targets: [t('books.b.chapters.c23')] },
    { mode: 'template', display: 'each-label', text: '', targets: [t('theorems.t'), t('https://example.org')] },
    { mode: 'text', text: 'a [x]', targets: [t('theorems.t'), t('theorems.u')] },
    { mode: 'text', text: 'a [x] [y]', targets: [t('theorems.t')] },
  ]
  for (const draft of drafts) {
    const { errors } = host.readReferences([buildReferenceItem(draft, CHOICES.templates)], { locale: 'xx', templates: { xx: collection }, texts: ['[0]'] })
    assert.equal(draftProblem(draft, CHOICES.templates), errors.map((e) => e.replace(/^reference \[0\]: /, '')).join('; '))
  }
})

test('the item has display or text first, then target for one and targets for several, in reading order unless authored', () => {
  const one = buildReferenceItem({ mode: 'template', display: 'index-label', text: 'x', targets: [t('theorems.t')] }, CHOICES.templates)
  assert.deepEqual(Object.entries(one), [['display', 'index-label'], ['target', 'theorems.t']])
  const text = buildReferenceItem({ mode: 'text', display: 'index-label', text: 'prím', targets: [t('definitions.p.terms.prime')] }, CHOICES.templates)
  assert.deepEqual(Object.entries(text), [['text', 'prím'], ['target', 'definitions.p.terms.prime']])
  const sorted = { mode: 'template', display: 'indexes-chapter', text: '', targets: [t('books.b.chapters.c24'), t('books.b.chapters.c23')] }
  assert.deepEqual(Object.entries(buildReferenceItem(sorted, CHOICES.templates)), [['display', 'indexes-chapter'], ['targets', ['books.b.chapters.c23', 'books.b.chapters.c24']]])
  assert.equal(canReorder(sorted, CHOICES.templates), false)
  const authored = { ...sorted, display: 'chapters-authored' }
  assert.deepEqual(buildReferenceItem(authored, CHOICES.templates).targets, ['books.b.chapters.c24', 'books.b.chapters.c23'])
  assert.equal(canReorder(authored, CHOICES.templates), true)
  const unembedded = orderedTargets({ ...sorted, targets: [t('definitions.q.terms.composite'), t('theorems.u'), t('https://x.org')] }, CHOICES.templates)
  assert.deepEqual(unembedded.map((x) => x.path), ['theorems.u', 'definitions.q.terms.composite', 'https://x.org'])
})

test('an edit that changes nothing leaves the item as it is, even with its targets out of reading order', () => {
  const item = { targets: ['books.b.chapters.c24', 'books.b.chapters.c23'], display: 'indexes-chapter' }
  const draft = draftFromItem(item, byPath)
  assert.deepEqual(draft, { mode: 'template', display: 'indexes-chapter', text: '', targets: [t('books.b.chapters.c24'), t('books.b.chapters.c23')] })
  assert.equal(leavesItemUnchanged(item, draft, CHOICES.templates), true)
  assert.equal(leavesItemUnchanged(item, { ...draft, display: 'chapters-authored' }, CHOICES.templates), false)
  assert.equal(leavesItemUnchanged(item, { ...draft, targets: draft.targets.slice(1) }, CHOICES.templates), false)
  const textItem = { text: 'prím', target: 'definitions.p.terms.prime' }
  assert.equal(leavesItemUnchanged(textItem, draftFromItem(textItem, byPath), CHOICES.templates), true)
  assert.equal(leavesItemUnchanged(textItem, { ...draftFromItem(textItem, byPath), text: 'prímek' }, CHOICES.templates), false)
  assert.equal(draftFromItem({ display: 'x', target: 3 }, byPath), undefined)
  assert.equal(draftFromItem(undefined, byPath), undefined)
  assert.deepEqual(draftFromItem({ text: 'cikk', target: 'articles.a' }, byPath).targets, [{ path: 'articles.a', kind: 'article' }])
})

test('Text mode starts from the rendered display with its links in brackets, and needs exactly one target', () => {
  assert.equal(textFromSegments([{ kind: 'text', text: 'a ' }, { kind: 'link', text: '23.10. Tétel', target: 'theorems.t' }, { kind: 'text', text: 'ben' }]), 'a [23.10. Tétel]ben')
  assert.equal(textModeProblem({ mode: 'template', text: '', targets: [t('theorems.t')] }), undefined)
  assert.equal(textModeProblem({ mode: 'template', text: '', targets: [t('theorems.t'), t('theorems.u')] }),
    "a 'text' item has one target. Several targets need a list template in 'display'")
})

test('a grouping template groups the targets in the order of their first member, under what they share', () => {
  const template = CHOICES.templates.find((x) => x.name === 'each-label')
  const groups = targetGroups([t('definitions.d'), t('theorems.t'), t('theorems.u')], template, byPath)
  assert.deepEqual(groups.map((g) => [g.header, g.targets.map((x) => x.path)]), [
    ['Definíció', ['definitions.d']],
    ['Tétel', ['theorems.t', 'theorems.u']],
  ])
  assert.deepEqual(targetGroups([t('definitions.d')], CHOICES.templates[0], byPath), [{ targets: [t('definitions.d')] }])
})

const contentDir = process.env.YOUPROOF_CONTENT_DIR
const servicesDir = process.env.SERVICES_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'services')

test('on the real content, prím, prímsz and 24.16 find what authors cite', { skip: !contentDir && 'set YOUPROOF_CONTENT_DIR to a content checkout' }, () => {
  const root = path.resolve(contentDir)
  const services = host.readServicesData(servicesDir)
  const templates = host.readDisplayTemplates(root, 'hu', services.entityLabels, services.localeConfig.locales).collection
  const content = host.loadContent(root, 'hu', 'hu', templates)
  const choices = host.buildReferenceChoices(content, { numbering: host.numberContent(content), templates, labels: services.entityLabels })
  const first = (query) => searchReferenceTargets(choices, query)[0]
  assert.deepEqual([first('prím').text, first('prím').target.path], ['prím', 'definitions.primtulajdonsagu-elem.terms.prime'])
  assert.equal(first('prímsz').text, 'prímszám')
  assert.deepEqual([first('24.16').target.kind, first('24.16').target.label], ['theorem', '24.16. Tétel'])
  const theorem = draftTarget(first('24.16').target.path, choicesByPath(choices))
  assert.equal(candidateTemplates(choices.templates, [theorem])[0].name, 'the-index-label')
})

const { placeReferencePopup, anchorInPane, nearestScrollTop } = require('../out/test/webview.js')
const PANE = { top: 0, bottom: 600, left: 0, right: 400 }
const rect = (top, left, width = 80, height = 18) => ({ top, bottom: top + height, left, right: left + width })
const covers = (placed, size, r) => placed.top < r.bottom && placed.top + (placed.maxHeight ?? size.height) > r.top

test('the popup opens below its anchor, left-aligned, and flips above when there is no room below', () => {
  const size = { width: 300, height: 200 }
  assert.deepEqual(placeReferencePopup([rect(100, 40)], size, PANE), { top: 120, left: 40, side: 'below' })
  const low = rect(500, 40)
  assert.deepEqual(placeReferencePopup([low], size, PANE), { top: 298, left: 40, side: 'above' })
  assert.ok(!covers(placeReferencePopup([low], size, PANE), size, low))
})

test('when neither side fits it takes the larger one and scrolls inside', () => {
  const size = { width: 300, height: 500 }
  const placed = placeReferencePopup([rect(400, 40)], size, PANE)
  assert.deepEqual(placed, { top: 8, left: 40, side: 'above', maxHeight: 390 })
  const high = placeReferencePopup([rect(150, 40)], size, PANE)
  assert.deepEqual(high, { top: 170, left: 40, side: 'below', maxHeight: 422 })
})

test('it shifts sideways to stay in the pane, at either edge, and narrows in a pane narrower than it', () => {
  const size = { width: 300, height: 100 }
  assert.equal(placeReferencePopup([rect(100, 350, 40)], size, PANE).left, 92, 'clamped to the right edge')
  assert.equal(placeReferencePopup([rect(100, -30)], size, PANE).left, 8, 'clamped to the left edge')
  const pane = { top: 0, bottom: 600, left: 100, right: 300 }
  assert.deepEqual(placeReferencePopup([rect(100, 150)], size, pane), { top: 120, left: 108, side: 'below', maxWidth: 184 })
})

test('a token wrapped over two lines is anchored by the union of its line boxes, and neither line is covered', () => {
  const size = { width: 300, height: 200 }
  const lines = [rect(400, 300, 100), rect(418, 0, 60)]
  const placed = placeReferencePopup(lines, size, PANE)
  assert.deepEqual(placed, { top: 198, left: 8, side: 'above' })
  for (const line of lines) assert.ok(!covers(placed, size, line))
  const below = placeReferencePopup([rect(50, 300, 100), rect(68, 0, 60)], size, PANE)
  assert.equal(below.top, 88, 'below the second line')
})

test('an anchor scrolled out of the pane closes the popup', () => {
  assert.equal(anchorInPane([rect(100, 40)], PANE), true)
  assert.equal(anchorInPane([rect(-40, 40)], PANE), false)
  assert.equal(anchorInPane([rect(-10, 40)], PANE), true, 'partly visible')
  assert.equal(anchorInPane([], PANE), false)
})

const { referenceTriggerAt, secondBracketAction, encodeReferenceToken } = require('../out/test/webview.js')

function trigger(marked, readsReferences = true) {
  const from = marked.indexOf('|')
  const to = marked.lastIndexOf('|') - (marked.indexOf('|') === marked.lastIndexOf('|') ? 0 : 1)
  const doc = marked.replace(/\|/g, '')
  return referenceTriggerAt(doc, { from, to, head: to }, readsReferences)
}

test('[ opens the create popup where the site would read a reference put at the caret, and nowhere else', () => {
  assert.deepEqual(trigger('Ha $n$ |'), { from: 7, to: 7, query: '' })
  assert.deepEqual(trigger('Ez **félkövér | szöveg**.'), { from: 14, to: 14, query: '' }, 'the site reads references inside bold')
  assert.equal(trigger('Ha $n |+1$ prím'), null, 'inside $...$')
  assert.equal(trigger('Ha $n |'), null, 'after an unclosed $, while the formula is being typed')
  assert.equal(trigger('Lásd ^lábjegyzet |^.'), null, 'inside ^...^')
  assert.equal(trigger('Egy [[pri|me]] szó'), null, 'inside a term marker')
  assert.equal(trigger('Egy [[|]] szó'), null, 'inside an empty term marker')
  assert.equal(trigger('Szöveg |', false), null, 'a field the site reads no references from')
  assert.deepEqual(trigger(`Lásd ${encodeReferenceToken({ text: 'x', target: 'theorems.t' })} és |`).query, '')
})

test('[ with a selection searches for the selected words and replaces them, unless the selection holds a token or spans lines', () => {
  assert.deepEqual(trigger('Ha $n$ | prím |szám'), { from: 8, to: 12, query: 'prím' }, 'the spaces around it stay')
  const token = encodeReferenceToken({ text: 'x', target: 'theorems.t' })
  const withToken = `Lásd |a ${token}| itt`
  const doc = withToken.replace(/\|/g, '')
  assert.deepEqual(referenceTriggerAt(doc, { from: 5, to: 7 + token.length, head: 7 + token.length }, true), { from: 7 + token.length, to: 7 + token.length, query: '' })
  assert.deepEqual(referenceTriggerAt('egy\nkettő', { from: 1, to: 6, head: 6 }, true), { from: 6, to: 6, query: '' })
})

test('a second [ in an empty search box makes a term marker where the field can hold one, is ignored elsewhere, and searches after a word', () => {
  assert.equal(secondBracketAction('', true), 'term-marker')
  assert.equal(secondBracketAction('', false), 'ignore')
  assert.equal(secondBracketAction('prím', true), 'search')
})

test('a selected row out of view scrolls to the nearest edge, and one in view stays put', () => {
  const view = { top: 100, bottom: 300 }
  assert.equal(nearestScrollTop(50, { top: 150, bottom: 170 }, view), 50, 'in view')
  assert.equal(nearestScrollTop(50, { top: 300, bottom: 320 }, view), 70, 'below: its bottom at the bottom edge')
  assert.equal(nearestScrollTop(50, { top: 80, bottom: 100 }, view), 30, 'above: its top at the top edge')
  assert.equal(nearestScrollTop(0, { top: 320, bottom: 600 }, view), 220, 'taller than the view: its top shows')
})
