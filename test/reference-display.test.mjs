// What a reference token shows: the host renders the held item through the
// collection and the editor's numbering, the webview capitalizes it where the site
// starts a sentence with it, and anything the site wouldn't render is an error
// with its reason.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Module from 'node:module'

const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'vscode') return {}
  return realLoad.call(this, request, ...rest)
}

const { loadContent, numberContent, readDisplayTemplates, resolveReferenceToken, resolveReferenceTokens } =
  await import('../out/test/host.js')
const { referenceTokenView, referenceTokenText, referencePlacements, encodeReferenceToken, findReferenceTokens, ReferenceDisplayStore } =
  await import('../out/test/webview.js')

const form = (word) => ({ canonical: word, cases: { ine: { base: word, suffix: 'ben' } } })
const single = (key, word) => ({ default: key, variants: { [key]: form(word) } })
const REGISTRY = {
  xx: {
    cases: ['ine'],
    definition: single('definition', 'definíció'),
    theorem: single('theorem', 'tétel'),
    proof: single('proof', 'bizonyítás'),
    remark: single('remark', 'megjegyzés'),
  },
}

const TEMPLATES = `definition-the:
  targets: [definition]
  template: 'a [{target.index} {target.label.canonical}]'

chapters:
  targets: [chapter]
  list:
    count: 2
    item:
      first: 'a [{target.index}]'
      separator: ' és '
`

const yamlFile = (dir, name, text) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, name), text)
}

/** Two chapters; the first one's section embeds definition a and, when `ghost`, an entity the editor hasn't loaded. */
function fixture({ ghost = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'yp-display-'))
  const books = path.join(root, 'books')
  yamlFile(books, 'episodes.yaml', '- konyv\n')
  const book = path.join(books, 'konyv')
  yamlFile(book, 'book.yaml', 'type: book\nname: konyv\nlocale: xx\ntitle: Könyv\nparts:\n  - elso\n')
  yamlFile(path.join(book, '01-elso'), 'part.yaml', 'type: part\nname: elso\nlocale: xx\ntitle: Első\nchapters:\n  - egy\n  - ketto\n')
  const egy = path.join(book, '01-elso', '01-egy')
  yamlFile(egy, 'chapter.yaml', 'type: chapter\nname: egy\nlocale: xx\ntitle: Egy\nsections:\n  - s1\n')
  yamlFile(egy, '01-s1.yaml', 'type: section\nname: s1\nlocale: xx\ntitle: S1\nbody:\n' +
    (ghost ? '  - type: embed\n    target: definitions.ghost\n' : '') +
    '  - type: embed\n    target: definitions.a\n')
  yamlFile(path.join(book, '01-elso', '02-ketto'), 'chapter.yaml', 'type: chapter\nname: ketto\nlocale: xx\ntitle: Kettő\nsections: []\n')
  const ns = path.join(root, 'knowledge-base', 'proba')
  yamlFile(ns, 'namespace.yaml', 'type: namespace\nname: proba\nlocale: xx\ntitle: Próba\n')
  for (const [folder, name] of [['definitions', 'a'], ['definitions', 'b'], ['theorems', 't']]) {
    yamlFile(path.join(ns, folder), `${name}.yaml`,
      `type: ${folder.slice(0, -1)}\nname: ${name}\nlocale: xx\ntitle: ${name}\nbody:\n  - type: narrative\n    content: Szöveg.\n`)
  }
  yamlFile(path.join(root, 'display-templates'), 'display-templates.xx.yaml', TEMPLATES)
  return root
}

function resolution(root) {
  const templates = readDisplayTemplates(root, 'xx', REGISTRY, ['xx'])
  assert.deepEqual(templates.errors, [])
  return { numbering: numberContent(loadContent(root, 'xx')), templates: templates.collection, labels: REGISTRY }
}

const payload = (item) => encodeReferenceToken(item).slice(2, -1)
const marked = (display) => display.error ?? display.segments.map((s) => (s.kind === 'link' ? `[${s.text}]` : s.text)).join('')

test('the host renders a held item as the site renders it, with each link naming its target', () => {
  const r = resolution(fixture())
  const one = resolveReferenceToken(payload({ display: 'definition-the', target: 'definitions.a' }), 'xx', r)
  assert.deepEqual(one, { segments: [
    { kind: 'text', text: 'a ' },
    { kind: 'link', text: '1.1. definíció', target: 'definitions.a' },
    { kind: 'text', text: '' },
  ] })
  const list = resolveReferenceToken(payload({ display: 'chapters', targets: ['books.konyv.chapters.ketto', 'books.konyv.chapters.egy'] }), 'xx', r)
  assert.equal(marked(list), 'a [1.] és a [2.]', 'a list is sorted by content position')
  assert.deepEqual(list.segments.filter((s) => s.kind === 'link').map((s) => s.target),
    ['books.konyv.chapters.egy', 'books.konyv.chapters.ketto'])
  const literal = resolveReferenceToken(payload({ text: 'a [szó szerint]', target: 'https://example.org' }), 'xx', r)
  assert.equal(marked(literal), 'a [szó szerint]')
  assert.equal(literal.segments[1].target, 'https://example.org')
})

test('what the site would reject renders as an error with its reason', () => {
  const r = resolution(fixture())
  const error = (item) => resolveReferenceToken(payload(item), 'xx', r).error
  assert.equal(error({ display: 'nincs', target: 'definitions.a' }), "'nincs' is not a display template in 'xx'")
  assert.equal(error({ display: 'definition-the', target: 'theorems.t' }),
    "template 'definition-the' takes definition targets, not a theorem ('theorems.t')")
  assert.match(error({ display: 'definition-the', targets: ['definitions.a', 'definitions.b'] }), /^template 'definition-the' /)
  assert.match(error({ display: 'chapters', targets: ['books.konyv.chapters.egy'] }), /^template 'chapters' /)
  assert.equal(error({ display: 'definition-the', target: 'definitions.nincs' }), "'definitions.nincs' is not in the content graph.")
  assert.equal(error({ display: 'definition-the' }), "an item has exactly one of 'target' and 'targets'")
  assert.equal(resolveReferenceToken('!!', 'xx', r).error, "This reference is damaged and can't be read.")
})

test('a number missing content could change renders as an error, not as a number', () => {
  const r = resolution(fixture({ ghost: true }))
  assert.match(resolveReferenceToken(payload({ display: 'definition-the', target: 'definitions.a' }), 'xx', r).error,
    /^'definitions\.a' can't be numbered as the site numbers it, because .*definitions\.ghost/)
  assert.equal(marked(resolveReferenceToken(payload({ text: '[szó]', target: 'definitions.a' }), 'xx', r)), '[szó]',
    'literal text has no number to withhold')
})

test('every payload asked for is answered, keyed by the payload', () => {
  const r = resolution(fixture())
  const a = payload({ display: 'definition-the', target: 'definitions.a' })
  assert.deepEqual(Object.keys(resolveReferenceTokens([a, 'x'], 'xx', r)), [a, 'x'])
})

const placements = (text) => referencePlacements(text).map(({ read, sentenceStart }) => (read ? (sentenceStart ? 'start' : 'mid') : 'unread'))

test('a token is capitalized where the site starts a sentence with it', () => {
  const t = encodeReferenceToken({ text: '[x]', target: 'definitions.a' })
  assert.deepEqual(placements(`${t} és ${t}. ${t}? ${t}! ${t}`), ['start', 'mid', 'start', 'start', 'start'])
  assert.deepEqual(placements(`  ${t}`), ['start'], 'leading whitespace')
  assert.deepEqual(placements(`Lásd.&nbsp;${t}`), ['start'], 'the site reads entities first')
  assert.deepEqual(placements(`Lásd **${t}** és **mint ${t}**`), ['start', 'mid'], 'inside bold the bold text is the sentence')
  assert.deepEqual(placements(`$x ${t}$ és ^${t}^ de ${t}`), ['unread', 'unread', 'mid'])
  assert.deepEqual(placements(`[0]. ${t}`), ['start'], 'an index typed as text counts as text before it')
})

const view = (item, placement, display, reads) => referenceTokenView({ item }, placement, display, reads)
const START = { read: true, sentenceStart: true }
const MID = { read: true, sentenceStart: false }
const ITEM = { display: 'definition-the', target: 'definitions.a' }
const DISPLAY = { segments: [{ kind: 'text', text: 'a ' }, { kind: 'link', text: '1.1. definíció', target: 'definitions.a' }, { kind: 'text', text: '' }] }

test('a rendered token shows its words and its link apart, capitalized at the start of a sentence', () => {
  assert.deepEqual(view(ITEM, MID, DISPLAY), {
    state: 'rendered', parts: [{ text: 'a ' }, { text: '1.1. definíció', target: 'definitions.a' }],
  })
  assert.equal(referenceTokenText(view(ITEM, START, DISPLAY)), 'A [1.1. definíció]')
  const linkFirst = { segments: [{ kind: 'text', text: '' }, { kind: 'link', text: 'tétel', target: 't' }, { kind: 'text', text: 'ben' }] }
  assert.equal(referenceTokenText(view(ITEM, START, linkFirst)), '[Tétel]ben')
})

test('a token that is not rendered shows its name, as an error with the reason or as pending', () => {
  assert.deepEqual(view(ITEM, MID, undefined), { state: 'pending', parts: [{ text: 'definition-the' }] })
  assert.deepEqual(view(ITEM, MID, { error: 'nem jó' }), { state: 'error', parts: [{ text: 'definition-the' }], reason: 'nem jó' })
  assert.equal(view(undefined, MID, DISPLAY).reason, "This reference is damaged and can't be read.")
  assert.match(view(ITEM, { read: false, sentenceStart: false }, DISPLAY).reason, /inside \$\.\.\.\$ or \^\.\.\.\^/)
  assert.match(view(ITEM, MID, DISPLAY, false).reason, /reads no references in this field/)
  assert.equal(view({ text: '[szó]', target: 'x' }, MID, { error: 'e' }).parts[0].text, '[szó]')
})

function fakeClient(answer) {
  const calls = []
  return {
    calls,
    request(method, params) {
      calls.push({ method, params })
      return new Promise((resolve) => setTimeout(() => resolve(answer(params)), 0))
    },
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

test('the panel asks for the displays it lacks in one request, and asks again for all of them on refresh', async () => {
  let version = 1
  const client = fakeClient(({ payloads }) => ({
    displays: Object.fromEntries(payloads.map((p) => [p, { segments: [{ kind: 'text', text: `${p}${version}` }] }])),
  }))
  const store = new ReferenceDisplayStore(client, 'owner')
  let notified = 0
  store.subscribe(() => notified++)
  assert.equal(store.get('a'), undefined)
  assert.equal(store.get('b'), undefined)
  store.get('a')
  await tick()
  assert.deepEqual(client.calls, [{ method: 'resolveReferenceTokens', params: { id: 'owner', payloads: ['a', 'b'] } }])
  assert.equal(store.get('a').segments[0].text, 'a1')
  assert.equal(notified, 1)

  version = 2
  store.refresh()
  assert.equal(store.get('a').segments[0].text, 'a1', 'the old display stays until the new one arrives')
  await tick()
  assert.equal(client.calls.length, 2)
  assert.deepEqual(client.calls[1].params.payloads, ['a', 'b'])
  assert.equal(store.get('b').segments[0].text, 'b2')
})

test('an answer that a refresh overtook is dropped, and a failed request shows on each token', async () => {
  let version = 1
  const client = fakeClient(({ payloads }) => ({
    displays: Object.fromEntries(payloads.map((p) => [p, { segments: [{ kind: 'text', text: `${p}${version++}` }] }])),
  }))
  const store = new ReferenceDisplayStore(client, 'owner')
  store.get('a')
  await Promise.resolve()
  store.refresh()
  await tick()
  assert.equal(store.get('a').segments[0].text, 'a2')

  const failing = new ReferenceDisplayStore({ request: () => Promise.reject(new Error('nincs gazda')) }, 'owner')
  failing.get('a')
  await tick()
  assert.equal(failing.get('a').error, 'The editor could not render this reference: nincs gazda')
})

test('a token decoded from the text renders by its payload', () => {
  const [token] = findReferenceTokens(`x ${encodeReferenceToken(ITEM)} y`)
  assert.equal(token.payload, payload(ITEM))
  assert.deepEqual(token.item, ITEM)
})
