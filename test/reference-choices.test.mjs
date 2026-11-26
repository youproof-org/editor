// The catalogue the reference popup searches: every target the loaded content holds,
// under the path the site's graph keys it by, with the labels, reading positions and
// group keys the shared resolution uses, and the templates with how the loaded files
// use them. A sidebar pick reports the same path the catalogue has.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Module from 'node:module'

const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'vscode') return {}
  return realLoad.call(this, request, ...rest)
}

const {
  loadContent, numberContent, readDisplayTemplates, buildReferenceChoices, registerHandlers, groupKeys, parseRefTarget,
} = await import('../out/test/host.js')

const form = (word) => ({ canonical: word, cases: { ine: { base: word, suffix: 'ben' } } })
const single = (key, word) => ({ default: key, variants: { [key]: form(word) } })
const REGISTRY = {
  xx: {
    cases: ['ine'],
    definition: { default: 'definition', variants: { definition: form('definíció'), axiom: form('axióma') } },
    theorem: single('theorem', 'tétel'),
    proof: single('proof', 'bizonyítás'),
    remark: single('remark', 'megjegyzés'),
  },
}

const TEMPLATES = `index-label:
  targets: [definition, theorem]
  template: '[{target.index} {target.label.canonical}]'

chapter-index:
  targets: [chapter]
  template: '[{target.index} fejezet]'

claim-index:
  targets: [claim]
  template: '[{target.parent.index} {target.index} pont]'

chapters:
  targets: [chapter]
  list:
    count: { min: 2 }
    order: authored
    item:
      first: '[{target.index}]'
      separator: ', '
      last-separator: ' és '

each-label:
  targets: [definition, theorem]
  list:
    count: { min: 2 }
    group-by: label
    item:
      first: '[{target.index}]'
      only: '[{target.index}]'
      separator: ', '
    group:
      separator: '; '
`

const yamlFile = (dir, name, text) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, name), text)
}
const embeds = (...targets) => targets.map((t) => `  - type: embed\n    target: ${t}\n`).join('')

const PRIME = 'definitions.a.terms.prime'

/**
 * Chapter 1 (egy) with sections s1 and s2, chapter 2 (ketto) with s3. s1 embeds
 * definition a, which defines the term `prime` and lists remark r; s2 embeds
 * theorem t with its proof p, and definition b, whose body has two claims and a
 * third inside a subsection. Remark `free` is listed by nothing. s3 cites the term
 * three times with two texts, and uses the templates.
 */
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'yp-choices-'))
  const books = path.join(root, 'books')
  yamlFile(books, 'episodes.yaml', '- konyv\n')
  const book = path.join(books, 'konyv')
  yamlFile(book, 'book.yaml', 'type: book\nname: konyv\nlocale: xx\ntitle: Könyv\nparts:\n  - elso\n')
  yamlFile(path.join(book, '01-elso'), 'part.yaml', 'type: part\nname: elso\nlocale: xx\ntitle: Első\nchapters:\n  - egy\n  - ketto\n')
  const egy = path.join(book, '01-elso', '01-egy')
  yamlFile(egy, 'chapter.yaml', 'type: chapter\nname: egy\nlocale: xx\ntitle: Egy\nsections:\n  - s1\n  - s2\n')
  yamlFile(egy, '01-s1.yaml', `type: section\nname: s1\nlocale: xx\ntitle: Első szakasz\nbody:\n${embeds('definitions.a', 'definitions.a.remarks.r')}`)
  yamlFile(egy, '02-s2.yaml', `type: section\nname: s2\nlocale: xx\ntitle: Második szakasz\nbody:\n${embeds('theorems.t', 'theorems.t.proofs.p', 'definitions.b')}`)
  const ketto = path.join(book, '01-elso', '02-ketto')
  yamlFile(ketto, 'chapter.yaml', 'type: chapter\nname: ketto\nlocale: xx\ntitle: Kettő\nsections:\n  - s3\n')
  yamlFile(ketto, '01-s3.yaml', `type: section
name: s3
locale: xx
title: Harmadik szakasz
references:
  - { text: '[prím]', target: ${PRIME} }
  - { text: '[prímszám]', target: ${PRIME} }
  - { text: '[prím]', target: ${PRIME} }
  - { display: index-label, target: theorems.t }
  - { display: index-label, target: definitions.b }
  - { display: chapters, targets: [books.konyv.chapters.egy, books.konyv.chapters.ketto] }
  - { display: each-label, targets: [definitions.a, theorems.t] }
body:
  - type: narrative
    content: '[0], [1], [2], [3], [4], [5], [6].'
`)

  const ns = path.join(root, 'knowledge-base', 'proba')
  yamlFile(ns, 'namespace.yaml', 'type: namespace\nname: proba\nlocale: xx\ntitle: Próba\n')
  const entity = (folder, name, extra = '', body = '  - type: narrative\n    content: Szöveg.\n') =>
    yamlFile(path.join(ns, folder), `${name}.yaml`, `type: ${folder.slice(0, -1)}\nname: ${name}\nlocale: xx\n${extra}body:\n${body}`)
  entity('definitions', 'a', 'title: Prím\nremarks:\n  - r\nterms:\n  prime:\n    canonical: prímszám\n    synonyms: [prím]\n')
  entity('definitions', 'b', 'title: B\nlabel: axiom\n',
    '  - type: claim\n    name: elso\n    content: Az **első** állítás $x$.\n  - type: claim\n    name: masodik\n    content: Második.\n' +
    '  - type: subsection\n    title: Al\n    blocks:\n      - type: claim\n        name: belso\n        content: Belső.\n')
  entity('theorems', 't', 'title: T\nproofs:\n  - p\n')
  entity('proofs', 'p')
  entity('remarks', 'r')
  entity('remarks', 'free')
  yamlFile(path.join(root, 'display-templates'), 'display-templates.xx.yaml', TEMPLATES)
  return root
}

function choicesOf(root) {
  const templates = readDisplayTemplates(root, 'xx', REGISTRY, ['xx'])
  assert.deepEqual(templates.errors, [])
  const content = loadContent(root, 'xx', 'xx', templates.collection)
  const numbering = numberContent(content)
  const resolution = { numbering, templates: templates.collection, labels: REGISTRY }
  return { content, numbering, resolution, choices: buildReferenceChoices(content, resolution) }
}

const byPath = (choices) => new Map(choices.targets.map((target) => [target.path, target]))

test('every target is listed under the path the site keys it by, in reading order', () => {
  const { choices } = choicesOf(fixture())
  assert.deepEqual(choices.targets.map((t) => t.path), [
    'books.konyv.chapters.egy',
    'books.konyv.chapters.egy.sections.s1',
    'definitions.a',
    PRIME,
    'definitions.a.remarks.r',
    'books.konyv.chapters.egy.sections.s2',
    'theorems.t',
    'theorems.t.proofs.p',
    'definitions.b',
    'definitions.b.claims.elso',
    'definitions.b.claims.masodik',
    'books.konyv.chapters.ketto',
    'books.konyv.chapters.ketto.sections.s3',
  ])
  const targets = byPath(choices)
  assert.equal(targets.get('definitions.a.remarks.r').owner, '1.1. Definíció', 'an attached remark sits under its owner')
  assert.ok(!choices.targets.some((t) => t.path.endsWith('free')), 'a remark nothing lists has no address the grammar accepts')
  assert.ok(!choices.targets.some((t) => t.path.endsWith('belso')), 'a claim inside a subsection is not numbered by the site')
})

test('labels, owners, positions and group keys are the ones the resolution uses', () => {
  const { choices, numbering } = choicesOf(fixture())
  const targets = byPath(choices)
  const pick = (p, ...keys) => Object.fromEntries(keys.map((key) => [key, targets.get(p)[key]]))
  assert.deepEqual(pick('books.konyv.chapters.ketto', 'kind', 'label', 'title'), { kind: 'chapter', label: '2.', title: 'Kettő' })
  assert.deepEqual(pick('books.konyv.chapters.egy.sections.s2', 'kind', 'label', 'title'), { kind: 'section', label: '1.2.', title: 'Második szakasz' })
  assert.deepEqual(pick('definitions.b', 'label', 'labelName', 'title'), { label: '1.3. Axióma', labelName: 'Axióma', title: 'B' })
  assert.deepEqual(pick('theorems.t.proofs.p', 'label', 'owner'), { label: 'Bizonyítás', owner: '1.2. Tétel' })
  assert.deepEqual(pick('definitions.b.claims.masodik', 'kind', 'label', 'owner'), { kind: 'claim', label: '2.', owner: '1.3. Axióma' })
  assert.equal(targets.get('definitions.b.claims.elso').title, 'Az első állítás $x$.')
  assert.deepEqual(pick(PRIME, 'kind', 'label', 'owner', 'synonyms'), { kind: 'term', label: 'prímszám', owner: '1.1. Definíció', synonyms: ['prím'] })
  for (const target of choices.targets) {
    assert.equal(target.position, numbering.index.positions.get(target.path), target.path)
    assert.deepEqual(target.groups, groupKeys(parseRefTarget(target.path, 't'), numbering.index, REGISTRY), target.path)
  }
  assert.equal(targets.get('definitions.b').groups.label, 'definition:axiom')
  assert.equal(targets.get('definitions.b.claims.elso').groups.parent, 'definitions.b')
})

test('template uses are counted per kinds of targets, and term texts per term', () => {
  const { choices } = choicesOf(fixture())
  assert.deepEqual(choices.templates.map((t) => t.name), ['index-label', 'chapter-index', 'claim-index', 'chapters', 'each-label'])
  const template = (name) => choices.templates.find((t) => t.name === name)
  assert.deepEqual(template('index-label'), {
    name: 'index-label', targets: ['definition', 'theorem'], count: { min: 1, max: 1 }, list: false, order: 'sorted',
    uses: { definition: 1, theorem: 1 },
  })
  assert.deepEqual(template('chapters'), {
    name: 'chapters', targets: ['chapter'], count: { min: 2 }, list: true, order: 'authored', uses: { chapter: 1 },
  })
  assert.deepEqual(template('each-label').uses, { 'definition+theorem': 1 })
  assert.equal(template('each-label').groupBy, 'label')
  assert.deepEqual(template('claim-index').uses, {})
  assert.deepEqual(byPath(choices).get(PRIME).texts, [{ text: '[prím]', uses: 2 }, { text: '[prímszám]', uses: 1 }])
})

test('a target the numbering withholds carries the reason', () => {
  const root = fixture()
  const chapter = path.join(root, 'books', 'konyv', '01-elso', '01-egy', 'chapter.yaml')
  writeFileSync(chapter, readFileSync(chapter, 'utf8').replace('  - s1\n', '  - s0\n  - s1\n'))
  const targets = byPath(choicesOf(root).choices)
  assert.match(targets.get('theorems.t').problem, /'theorems\.t' can't be numbered .* lists section 's0'/)
  assert.match(targets.get('definitions.b.claims.elso').problem, /can't be numbered/)
  assert.equal(targets.get('books.konyv.chapters.ketto').problem, undefined, 'chapter numbers do not depend on sections')
})

function handlers(root) {
  const { content, resolution } = choicesOf(root)
  const requests = new Map()
  const notified = []
  registerHandlers({
    server: { onRequest: (method, handler) => requests.set(method, handler), notify: (method, params) => notified.push({ method, params }) },
    getContent: () => content,
    getReferenceResolution: () => resolution,
  })
  return { content, requests, notified }
}

test('getReferenceChoices answers for a panel, and a sidebar pick reports the catalogue path', async () => {
  const { content, requests, notified } = handlers(fixture())
  const sectionId = [...content.idToFilePath.keys()].find((id) => content.idToObject.get(id).name === 's3')
  const choices = await requests.get('getReferenceChoices')({ id: sectionId })
  assert.equal(choices.targets.length, 13)
  assert.equal(await requests.get('getReferenceChoices')({ id: sectionId }), choices, 'cached while the numbering is the same')
  await assert.rejects(requests.get('getReferenceChoices')({ id: 'nope' }), /Object not found/)
  for (const target of choices.targets) {
    await requests.get('beginSelectTarget')({ selectorId: 'popup', allowedTypes: ['term'] })
    await requests.get('endSelectTarget')({ targetId: target.id })
    const { params } = notified.at(-1)
    assert.equal(params.selectorId, 'popup')
    assert.equal(params.result.path, target.path, target.path)
    assert.equal(params.result.type, target.kind)
  }
})

test('getReferenceChoices says why when references can\'t be rendered', async () => {
  const requests = new Map()
  const content = { idToObject: new Map([['x', {}]]) }
  registerHandlers({
    server: { onRequest: (method, handler) => requests.set(method, handler), notify: () => {} },
    getContent: () => content,
    getReferenceResolution: () => 'The registry is broken.',
  })
  assert.deepEqual(await requests.get('getReferenceChoices')({ id: 'x' }), { templates: [], targets: [], error: 'The registry is broken.' })
})
