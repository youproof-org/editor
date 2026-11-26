// The editor reads each locale's display template collection from the content
// root with the shared reader, so it fills in the same defaults and reports the
// same problems as the site build. These pin how the file is found, what a broken
// file reports, and that nothing is read without a label registry to check against.
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

const {
  readDisplayTemplates, describeDisplayTemplateErrors, displayTemplatesFile,
} = await import('../out/test/host.js')

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
const LOCALES = ['xx']

const VALID = `index-label-ine:
  targets: [definition, theorem]
  template: '[{target.index} {base(''ine'', target.label)}]{suffix(''ine'', target.label)}'

indexes-chapter:
  targets: [chapter]
  list:
    count: 2
    item:
      first: '[{target.index}]'
      separator: ', '
`

function contentRoot(text) {
  const root = mkdtempSync(path.join(tmpdir(), 'yp-templates-'))
  if (text !== undefined) {
    mkdirSync(path.join(root, 'display-templates'), { recursive: true })
    writeFileSync(displayTemplatesFile(root, 'xx'), text)
  }
  return root
}

test('the collection is read from content/display-templates/display-templates.<locale>.yaml', () => {
  const root = contentRoot(VALID)
  assert.equal(displayTemplatesFile(root, 'xx'), path.join(root, 'display-templates', 'display-templates.xx.yaml'))
  const read = readDisplayTemplates(root, 'xx', REGISTRY, LOCALES)
  assert.deepEqual(read.errors, [])
  assert.equal(read.locale, 'xx')
  assert.deepEqual(Object.keys(read.collection), ['index-label-ine', 'indexes-chapter'])
  assert.equal(describeDisplayTemplateErrors(read), undefined)
})

test('the shared reader fills in the list defaults the resolver relies on', () => {
  const { list } = readDisplayTemplates(contentRoot(VALID), 'xx', REGISTRY, LOCALES).collection['indexes-chapter']
  assert.deepEqual(list.count, { min: 2, max: 2 })
  assert.equal(list.item.middle, list.item.first)
  assert.equal(list.item.last, list.item.first)
  assert.equal(list.item.lastSeparator, ', ')
})

test('a locale with no collection file has no templates and no error', () => {
  const root = contentRoot()
  const read = readDisplayTemplates(root, 'xx', REGISTRY, LOCALES)
  assert.deepEqual(read, { locale: 'xx', file: displayTemplatesFile(root, 'xx'), collection: {}, errors: [] })
})

test('an invalid template is left out and reported by name, and the rest still load', () => {
  const root = contentRoot(`${VALID}
bad-case:
  targets: [theorem]
  template: '{base(''acc'', target.label)}'
`)
  const read = readDisplayTemplates(root, 'xx', REGISTRY, LOCALES)
  assert.deepEqual(Object.keys(read.collection), ['index-label-ine', 'indexes-chapter'])
  assert.equal(read.errors.length, 1)
  assert.match(read.errors[0], /^template 'bad-case': /)
  const message = describeDisplayTemplateErrors(read)
  assert.ok(message.includes(displayTemplatesFile(root, 'xx')), message)
  assert.match(message, /has a problem: template 'bad-case'/)
})

test('a file that is not valid YAML is one error and no templates', () => {
  const read = readDisplayTemplates(contentRoot('a: [unclosed\n'), 'xx', REGISTRY, LOCALES)
  assert.deepEqual(read.collection, {})
  assert.equal(read.errors.length, 1)
})

test('without a label registry the collection is not read, and says why', () => {
  const read = readDisplayTemplates(contentRoot(VALID), 'xx', null, LOCALES)
  assert.deepEqual(read.collection, {})
  assert.match(read.errors[0], /entity label registry/)
})
