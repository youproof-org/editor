// The editor numbers its loaded content with the site's shared numbering and
// resolves references through it. Where it is missing content the site would have,
// it reports that and withholds the numbers the gap could change, so it never shows
// a number the site wouldn't.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Module from 'node:module'

const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'vscode') return {}
  return realLoad.call(this, request, ...rest)
}

const {
  loadContent, numberContent, resolveFileReferences, describeNumberingProblems, readDisplayTemplates,
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

section-index:
  targets: [section]
  template: '[{target.index} szakasz]'

claim-index:
  targets: [claim]
  template: '[{target.parent.index} {target.index} pont]'

chapters:
  targets: [chapter]
  list:
    count: 2
    item:
      first: '[{target.index}]'
      separator: ' és '
`

const yamlFile = (dir, name, text) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, name), text)
}
const embeds = (...targets) => targets.map((t) => `  - type: embed\n    target: ${t}\n`).join('')

/**
 * One book in two parts: chapter 1 (egy) with two sections, chapter 2 (ketto)
 * with one. Section s1 embeds a theorem, its proof, an owned remark and, inside a
 * subsection, a definition that is therefore not numbered.
 */
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'yp-numbering-'))
  const books = path.join(root, 'books')
  yamlFile(books, 'episodes.yaml', '- konyv\n')
  const book = path.join(books, 'konyv')
  yamlFile(book, 'book.yaml', 'type: book\nname: konyv\nlocale: xx\ntitle: Könyv\nparts:\n  - elso\n  - masodik\n')
  yamlFile(path.join(book, '01-elso'), 'part.yaml', 'type: part\nname: elso\nlocale: xx\ntitle: Első\nchapters:\n  - egy\n')
  yamlFile(path.join(book, '02-masodik'), 'part.yaml', 'type: part\nname: masodik\nlocale: xx\ntitle: Második\nchapters:\n  - ketto\n')
  const egy = path.join(book, '01-elso', '01-egy')
  yamlFile(egy, 'chapter.yaml', `type: chapter\nname: egy\nlocale: xx\ntitle: Egy\nprologue:\n${embeds('definitions.a')}sections:\n  - s1\n  - s2\n`)
  yamlFile(egy, '01-s1.yaml', `type: section\nname: s1\nlocale: xx\ntitle: S1\nbody:\n${embeds('theorems.t', 'theorems.t.proofs.p', 'definitions.a.remarks.r')}` +
    `  - type: subsection\n    title: Al\n    blocks:\n      - type: embed\n        target: definitions.nested\n`)
  yamlFile(egy, '02-s2.yaml', `type: section
name: s2
locale: xx
title: S2
references:
  - { display: index-label, target: definitions.b }
  - { display: index-label, target: theorems.u }
  - { display: chapter-index, target: books.konyv.chapters.ketto }
  - { display: section-index, target: books.konyv.chapters.egy.sections.s2 }
  - { display: chapters, targets: [books.konyv.chapters.ketto, books.konyv.chapters.egy] }
  - { display: claim-index, target: definitions.b.claims.masodik }
  - { text: '[szó szerint]', target: definitions.a }
body:
${embeds('definitions.b')}  - type: narrative
    content: '[0], [1], [2], [3], [4], [5], [6].'
`)
  const ketto = path.join(book, '02-masodik', '01-ketto')
  yamlFile(ketto, 'chapter.yaml', 'type: chapter\nname: ketto\nlocale: xx\ntitle: Kettő\nsections:\n  - s3\n')
  yamlFile(ketto, '01-s3.yaml', `type: section\nname: s3\nlocale: xx\ntitle: S3\nbody:\n${embeds('definitions.a', 'theorems.u')}`)

  const ns = path.join(root, 'knowledge-base', 'proba')
  yamlFile(ns, 'namespace.yaml', 'type: namespace\nname: proba\nlocale: xx\ntitle: Próba\n')
  const entity = (folder, name, extra = '') =>
    yamlFile(path.join(ns, folder), `${name}.yaml`, `type: ${folder.slice(0, -1)}\nname: ${name}\nlocale: xx\n${extra}body:\n  - type: narrative\n    content: Szöveg.\n`)
  entity('definitions', 'a', 'title: A\nremarks:\n  - r\n')
  yamlFile(path.join(ns, 'definitions'), 'b.yaml', 'type: definition\nname: b\nlocale: xx\ntitle: B\nlabel: axiom\nbody:\n' +
    '  - type: claim\n    name: elso\n    content: Első.\n  - type: claim\n    name: masodik\n    content: Második.\n')
  entity('definitions', 'nested', 'title: Beágyazott\n')
  entity('theorems', 't', 'title: T\nproofs:\n  - p\n')
  entity('theorems', 'u', 'title: U\n')
  entity('proofs', 'p')
  entity('remarks', 'r')

  yamlFile(path.join(root, 'display-templates'), 'display-templates.xx.yaml', TEMPLATES)
  return root
}

const S2 = path.join('books', 'konyv', '01-elso', '01-egy', '02-s2.yaml')

function resolveS2(root) {
  const content = loadContent(root, 'xx')
  const numbering = numberContent(content)
  const templates = readDisplayTemplates(root, 'xx', REGISTRY, ['xx'])
  assert.deepEqual(templates.errors, [])
  const section = content.idToObject.get(content.filePathToId.get(path.join(root, S2)))
  const displays = resolveFileReferences(section.references, 'xx', { numbering, templates: templates.collection, labels: REGISTRY })
  const shown = displays.map((d) => d.error ?? d.segments.map((s) => (s.kind === 'link' ? `[${s.text}]` : s.text)).join(''))
  return { numbering, shown }
}

test('chapters, sections and entities are numbered as the site numbers them', () => {
  const { index, problems } = numberContent(loadContent(fixture(), 'xx'))
  assert.deepEqual(problems, [])
  assert.deepEqual([...index.chapters].map(([fqn, c]) => [fqn, c.index]), [
    ['books.konyv.chapters.egy', '1.'],
    ['books.konyv.chapters.ketto', '2.'],
  ], 'chapters count across the parts')
  assert.deepEqual([...index.sections].map(([fqn, s]) => [fqn.split('.').at(-1), s.index]), [['s1', '1.1.'], ['s2', '1.2.'], ['s3', '2.1.']])
  const number = (fqn) => index.embedding.get(fqn)?.index
  assert.equal(number('definitions.a'), '1.1.', 'a prologue embed is numbered')
  assert.equal(number('theorems.t'), '1.2.')
  assert.equal(number('definitions.b'), '1.3.')
  assert.equal(number('theorems.u'), '2.1.')
  assert.equal(number('definitions.nested'), undefined, 'an embed inside a subsection is not numbered')
  assert.equal(index.embedding.get('definitions.nested')?.chapter, 'books.konyv.chapters.egy', 'but it is embedded')
  assert.equal(number('theorems.t.proofs.p'), undefined, 'a proof is not numbered')
  assert.equal(number('definitions.a.remarks.r'), undefined, 'a remark its definition lists is not numbered')
  assert.equal(index.embedding.get('definitions.a')?.section, undefined, 'embedded again in chapter 2, it keeps its first place')
})

test('references resolve through the editor numbering, labels and templates', () => {
  const { shown } = resolveS2(fixture())
  assert.deepEqual(shown, [
    '[1.3. axióma]',
    '[2.1. tétel]',
    '[2. fejezet]',
    '[1.2. szakasz]',
    '[1.] és [2.]',
    '[1.3. 2. pont]',
    '[szó szerint]',
  ])
})

test('the numbering follows the model as a save changes it', () => {
  const root = fixture()
  const content = loadContent(root, 'xx')
  const s1 = content.idToObject.get(content.filePathToId.get(path.join(root, 'books', 'konyv', '01-elso', '01-egy', '01-s1.yaml')))
  s1.body = s1.body.filter((b) => b.blockType !== 'embed' || b.target.fqn !== 'theorems.t')
  assert.equal(numberContent(content).index.embedding.get('definitions.b').index, '1.2.', 'a removed embed renumbers what follows')
})

test('a section the editor cannot find is reported, and the numbers it could change are withheld', () => {
  const root = fixture()
  const chapter = path.join(root, 'books', 'konyv', '01-elso', '01-egy', 'chapter.yaml')
  writeFileSync(chapter, readFileSync(chapter, 'utf8').replace('  - s1\n', '  - s0\n  - s1\n'))
  const { numbering, shown } = resolveS2(root)
  assert.equal(numbering.problems.length, 1)
  assert.match(numbering.problems[0].message, /lists section 's0', but no section file/)
  assert.match(describeNumberingProblems(numbering.problems), /lists section 's0'/)
  assert.match(shown[0], /'definitions\.b' can't be numbered .* lists section 's0'/, 'an entity of that chapter')
  assert.match(shown[1], /'theorems\.u' can't be numbered/, 'a later chapter could be where the missing section embeds it')
  assert.equal(shown[2], '[2. fejezet]', 'chapter numbers do not depend on sections')
  assert.match(shown[3], /'books\.konyv\.chapters\.egy\.sections\.s2' can't be numbered/)
  assert.equal(shown[6], '[szó szerint]', 'a text item has no number to withhold')
})

test('a chapter the editor cannot find withholds the chapter numbers of its book', () => {
  const root = fixture()
  const part = path.join(root, 'books', 'konyv', '01-elso', 'part.yaml')
  writeFileSync(part, readFileSync(part, 'utf8').replace('  - egy\n', '  - nulla\n  - egy\n'))
  const { numbering, shown } = resolveS2(root)
  assert.match(numbering.problems[0].message, /lists chapter 'nulla', but no chapter\.yaml/)
  assert.match(shown[2], /'books\.konyv\.chapters\.ketto' can't be numbered/)
  assert.match(shown[4], /can't be numbered/)
})

test('an embedded entity the editor did not load is reported, and its chapter is not numbered', () => {
  const root = fixture()
  rmSync(path.join(root, 'knowledge-base', 'proba', 'theorems', 't.yaml'))
  const { numbering, shown } = resolveS2(root)
  const messages = numbering.problems.map((p) => p.message)
  assert.ok(messages.some((m) => /embeds 'theorems\.t', which the editor has not loaded/.test(m)), messages.join('\n'))
  assert.match(shown[0], /'definitions\.b' can't be numbered .*embeds 'theorems\.t'/)
  assert.equal(shown[2], '[2. fejezet]')
})

test('an entity file that cannot be read is reported', () => {
  const root = fixture()
  writeFileSync(path.join(root, 'knowledge-base', 'proba', 'theorems', 'u.yaml'), 'type: theorem\nname: u\n  bad: [indent\n')
  const { problems } = numberContent(loadContent(root, 'xx'))
  assert.ok(problems.some((p) => /u\.yaml could not be loaded/.test(p.message)), problems.map((p) => p.message).join('\n'))
})

test('an owner that lists a remark its namespace does not have is reported', () => {
  const root = fixture()
  const a = path.join(root, 'knowledge-base', 'proba', 'definitions', 'a.yaml')
  writeFileSync(a, readFileSync(a, 'utf8').replace('  - r\n', '  - r\n  - masik\n'))
  const { problems } = numberContent(loadContent(root, 'xx'))
  assert.ok(problems.some((p) => /lists 'masik' in remarks, but its namespace has no remark of that name/.test(p.message)))
})
