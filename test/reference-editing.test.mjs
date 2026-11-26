// Editing text that holds references, then saving, through the round trip a save
// from the panel takes. Each reference lives in its token, so deleting, moving,
// removing and copying text is all it takes to change the references, and the save
// writes the list and numbers the tokens. Every saved file is checked with the
// build's own rules, readFileReferences from the services content checker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import Module from 'node:module'
import yaml from 'js-yaml'

const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'vscode') return {}
  return realLoad.call(this, request, ...rest)
}

const {
  loadContent, saveFromModel, serializeBlocks, updateModelBlocks, referencesSection, readDisplayTemplates,
  findReferenceTokens, encodeReferenceToken, heldReferences, buildContentTree,
} = await import('../out/test/host.js')

const servicesDir = process.env.SERVICES_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'services')
const checker = await import(pathToFileURL(path.join(servicesDir, 'packages', 'content-checker', 'content-checker.mjs')).href)

const REGISTRY = {
  xx: {
    cases: [],
    definition: { default: 'definition', variants: { definition: { canonical: 'definíció', cases: {} } } },
    theorem: { default: 'theorem', variants: { theorem: { canonical: 'tétel', cases: {} } } },
    proof: { default: 'proof', variants: { proof: { canonical: 'bizonyítás', cases: {} } } },
    remark: { default: 'remark', variants: { remark: { canonical: 'megjegyzés', cases: {} } } },
  },
}

const TEMPLATES = `index-label:
  targets: [definition]
  template: '[{target.index} {target.label.canonical}]'

chapters:
  targets: [chapter]
  list:
    count: 2
    item:
      first: '[{target.index}]'
      separator: ' és '
`

const SECTION = `type: section
name: szakasz
slug: szakasz
locale: xx
title: Szakasz
references:
  - { text: '[a]', target: definitions.a }
  - { display: index-label, target: definitions.b }
  - { text: '[c]', target: 'https://example.org/c' }
  - { text: '[d]', target: definitions.d }
  - { display: chapters, targets: [books.k.chapters.f, books.k.chapters.g] }
  - { text: 'modulo $n$ [e]', target: definitions.e }
body:
  - type: narrative
    content: Első [0] és [1].
  - type: formula
    lead-in: 'Képlet [2]:'
    content: x^2
  - type: subsection
    title: Al
    blocks:
      - type: narrative
        content: Benne [3].
      - type: unordered-list
        items:
          - egy [4]
          - kettő [5]
`

const CHAPTER = `type: chapter
name: fejezet
slug: fejezet
locale: xx
title: Fejezet
references:
  - { text: '[fejezet-ref]', target: definitions.f }
prologue:
  - type: narrative
    content: Előszó [0].
sections:
  - szakasz
`

const SECTION_REL = path.join('books', 'k', 'r', 'f', '01-szakasz.yaml')
const CHAPTER_REL = path.join('books', 'k', 'r', 'f', 'chapter.yaml')

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'yp-ref-edit-'))
  const dir = path.join(root, 'books', 'k', 'r', 'f')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(root, 'books', 'episodes.yaml'), '- k\n')
  writeFileSync(path.join(root, 'books', 'k', 'book.yaml'), 'type: book\nname: k\nlocale: xx\ntitle: K\nparts:\n  - r\n')
  writeFileSync(path.join(root, 'books', 'k', 'r', 'part.yaml'), 'type: part\nname: r\nlocale: xx\ntitle: R\nchapters:\n  - fejezet\n')
  writeFileSync(path.join(root, CHAPTER_REL), CHAPTER)
  writeFileSync(path.join(root, SECTION_REL), SECTION)
  mkdirSync(path.join(root, 'display-templates'))
  writeFileSync(path.join(root, 'display-templates', 'display-templates.xx.yaml'), TEMPLATES)
  const templates = readDisplayTemplates(root, 'xx', REGISTRY, ['xx'])
  assert.deepEqual(templates.errors, [])
  const content = loadContent(root, 'xx', 'xx', templates.collection)
  const objectAt = (rel) => content.idToObject.get(content.filePathToId.get(path.join(root, rel)))
  return { root, content, templates: templates.collection, section: objectAt(SECTION_REL), chapter: objectAt(CHAPTER_REL) }
}

/** What the panel sends for `field` of `obj` after `edit` changes it, applied to the model as a save applies it. */
function editThroughPanel(fx, obj, field, edit) {
  const wire = serializeBlocks(obj[field])
  edit(wire)
  obj[field] = updateModelBlocks(wire, obj, fx.content.idToObject)
}

function save(fx, obj) {
  const problems = saveFromModel(obj.id, fx.content, fx.templates)
  const text = readFileSync(obj.filePath, 'utf8')
  const checked = checker.readFileReferences(yaml.load(text), { xx: fx.templates })
  assert.deepEqual(checked.errors, [], 'the build accepts the saved references')
  assert.deepEqual(problems, [])
  return { text, doc: yaml.load(text), checked }
}

const ITEMS = yaml.load(SECTION).references
const indexes = (texts) => texts.flatMap((text) => [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))
const savedTokens = (saved) => indexes(checker.readFileReferences(saved.doc, {}).texts.map((t) => t.replace(/\$[^$]+\$/g, '')))

const tokenOf = (text) => {
  const [token] = findReferenceTokens(text)
  return text.slice(token.from, token.to)
}

test('an unedited file saves its list and its tokens unchanged', () => {
  const fx = fixture()
  editThroughPanel(fx, fx.section, 'body', () => {})
  const saved = save(fx, fx.section)
  assert.equal(referencesSection(saved.text), referencesSection(SECTION))
  assert.deepEqual(saved.doc.body, yaml.load(SECTION).body)
})

test('deleting a token removes its reference, and the tokens after it are renumbered', () => {
  const fx = fixture()
  editThroughPanel(fx, fx.section, 'body', (wire) => {
    const text = wire[0].content
    wire[0].content = text.replace(` és ${tokenOf(text.slice(text.indexOf(' és ')))}`, '')
  })
  const saved = save(fx, fx.section)
  const [a, , c, d, e, f] = ITEMS
  assert.deepEqual(saved.doc.references, [a, c, d, e, f])
  assert.equal(saved.doc.body[0].content, 'Első [0].')
  assert.equal(saved.doc.body[1]['lead-in'], 'Képlet [1]:')
  assert.deepEqual(savedTokens(saved), [0, 1, 2, 3, 4])
})

test('moving a block with references reorders the list on save', () => {
  const fx = fixture()
  editThroughPanel(fx, fx.section, 'body', (wire) => {
    const [narrative, formula, subsection] = wire.splice(0, 3)
    wire.push(subsection, formula, narrative)
  })
  const saved = save(fx, fx.section)
  const [a, b, c, d, e, f] = ITEMS
  assert.deepEqual(saved.doc.references, [d, e, f, c, a, b])
  assert.equal(saved.doc.body[0].blocks[0].content, 'Benne [0].')
  assert.equal(saved.doc.body[2].content, 'Első [4] és [5].')
  assert.deepEqual(savedTokens(saved), [0, 1, 2, 3, 4, 5])
})

test('removing a nested block or a list item removes the references in it', () => {
  const fx = fixture()
  editThroughPanel(fx, fx.section, 'body', (wire) => {
    wire[2].blocks.splice(0, 1)
    wire[2].blocks[0].items.splice(1, 1)
  })
  let saved = save(fx, fx.section)
  const [a, b, c, , e] = ITEMS
  assert.deepEqual(saved.doc.references, [a, b, c, e])
  assert.deepEqual(saved.doc.body[2].blocks[0].items, ['egy [3]'])

  editThroughPanel(fx, fx.section, 'body', (wire) => { wire.splice(2, 1) })
  saved = save(fx, fx.section)
  assert.deepEqual(saved.doc.references, [a, b, c], 'the whole subsection, with the list inside it')
})

test('a pasted copy of a reference is a reference of its own, within a file and across files', () => {
  const fx = fixture()
  const copied = tokenOf(fx.section.body[0].content)
  editThroughPanel(fx, fx.section, 'body', (wire) => { wire[1].leadIn = `${copied} ${wire[1].leadIn}` })
  editThroughPanel(fx, fx.chapter, 'prologue', (wire) => { wire[0].content = `${wire[0].content} Lásd ${copied}.` })
  const [a, b, c, d, e, f] = ITEMS
  const section = save(fx, fx.section)
  assert.deepEqual(section.doc.references, [a, b, a, c, d, e, f])
  assert.equal(section.doc.body[1]['lead-in'], '[2] Képlet [3]:')
  const chapter = save(fx, fx.chapter)
  assert.deepEqual(chapter.doc.references, [yaml.load(CHAPTER).references[0], a])
  assert.equal(chapter.doc.prologue[0].content, 'Előszó [0]. Lásd [1].')

  editThroughPanel(fx, fx.section, 'body', (wire) => { wire[0].content = wire[0].content.replace(copied, '') })
  assert.deepEqual(save(fx, fx.section).doc.references, [b, a, c, d, e, f], 'deleting the original leaves the copy')
})

test('text inserted before a token changes neither the list nor the tokens', () => {
  const fx = fixture()
  editThroughPanel(fx, fx.section, 'body', (wire) => { wire[0].content = `Egészen elöl, ${wire[0].content}` })
  const saved = save(fx, fx.section)
  assert.equal(referencesSection(saved.text), referencesSection(SECTION))
  assert.equal(saved.doc.body[0].content, 'Egészen elöl, Első [0] és [1].')
})

test('a new reference is written in the style of the list, and deleting the last one removes the list', () => {
  const fx = fixture()
  const token = encodeReferenceToken({ text: 'új [hivatkozás]', target: 'https://example.org/új' })
  editThroughPanel(fx, fx.chapter, 'prologue', (wire) => { wire[0].content = `${token} ${wire[0].content}` })
  let saved = save(fx, fx.chapter)
  assert.equal(referencesSection(saved.text),
    "references:\n  - { text: 'új [hivatkozás]', target: 'https://example.org/új' }\n  - { text: '[fejezet-ref]', target: definitions.f }\n")

  editThroughPanel(fx, fx.chapter, 'prologue', (wire) => { wire[0].content = 'Nincs hivatkozás.' })
  saved = save(fx, fx.chapter)
  assert.equal(referencesSection(saved.text), null)
  assert.equal(saved.doc.references, undefined)
})

test('saving twice writes the same file, and the model keeps holding the references', () => {
  const fx = fixture()
  editThroughPanel(fx, fx.section, 'body', (wire) => { wire.reverse() })
  const first = save(fx, fx.section).text
  assert.equal(heldReferences(fx.section).length, 6)
  editThroughPanel(fx, fx.section, 'body', () => {})
  assert.equal(save(fx, fx.section).text, first)
})

for (const [what, edit, message] of [
  ['a reference in a field the site does not read references from',
    (wire, token) => { wire[1].content = `x^2 ${token}` }, /a field the site doesn't read references from/],
  ['a reference inside $...$', (wire, token) => { wire[0].content = `$a ${token}$ ${wire[0].content}` }, /inside \$\.\.\.\$/],
  ['an index written as text', (wire) => { wire[0].content = `${wire[0].content} [9]` }, /\[9\], an index written as text/],
  ['a damaged token', (wire) => { wire[0].content = `${wire[0].content} [@AAAA]` }, /damaged/],
]) {
  test(`${what} stops the save, and the file is left as it was`, () => {
    const fx = fixture()
    const before = readFileSync(fx.section.filePath, 'utf8')
    const token = tokenOf(fx.section.body[0].content)
    editThroughPanel(fx, fx.section, 'body', (wire) => edit(wire, token))
    assert.throws(() => saveFromModel(fx.section.id, fx.content, fx.templates), message)
    assert.equal(readFileSync(fx.section.filePath, 'utf8'), before)
  })
}

test('a saved file is checked against the display templates, and what the build would reject is returned', () => {
  const fx = fixture()
  const token = encodeReferenceToken({ display: 'no-such-template', target: 'definitions.a' })
  editThroughPanel(fx, fx.section, 'body', (wire) => { wire[0].content = `${token} ${wire[0].content}` })
  const problems = saveFromModel(fx.section.id, fx.content, fx.templates)
  assert.deepEqual(problems, ["reference [0]: 'no-such-template' is not a display template in 'xx'"])
})

test('reference problems in a loaded file are read with the templates', () => {
  const root = fixture().root
  const file = path.join(root, SECTION_REL)
  writeFileSync(file, readFileSync(file, 'utf8').replace('Első [0] és [1].', 'Első [1] és [0].'))
  const templates = readDisplayTemplates(root, 'xx', REGISTRY, ['xx'])
  const content = loadContent(root, 'xx', 'xx', templates.collection)
  const section = content.idToObject.get(content.filePathToId.get(file))
  assert.equal(section.references.problems.length, 1)
  assert.match(section.references.problems[0], /not in the order the text uses it/)
  const unchecked = loadContent(root, 'xx')
  assert.deepEqual(unchecked.idToObject.get(unchecked.filePathToId.get(file)).references.problems, [], 'without templates nothing is checked')
})

test('the content tree has no items for the references the text holds', () => {
  const fx = fixture()
  const chapter = buildContentTree(fx.content).books[0].children[0].children[0]
  assert.equal(chapter.id, fx.chapter.id)
  assert.deepEqual(chapter.children, [
    { id: fx.section.id, type: 'section', label: 'Szakasz', isFileBacked: true, children: [] },
  ])
})
