// Saves every file of a real content checkout, in a temporary copy, through the same
// round trip a save from the panel takes, and checks that the `references` list and
// the `[i]` tokens come back exactly as they were. The editor holds each reference in
// its token and writes the list from the text on save, so an unedited file must
// number its tokens as the file did and write the list back as it was.
//
// Opt-in, since the content lives in another repo:
//   YOUPROOF_CONTENT_DIR=../content/content npm test
// The label registry is read from SERVICES_DIR, or the services folder beside this repo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Module from 'node:module'
import yaml from 'js-yaml'

const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'vscode') return {}
  return realLoad.call(this, request, ...rest)
}

const {
  loadContent, saveFromModel, serializeBlocks, updateModelBlocks, referencesSection, referencesSectionFor,
  fileReferenceTexts, inlineTokens, readServicesData, readDisplayTemplates,
} = await import('../out/test/host.js')

const contentDir = process.env.YOUPROOF_CONTENT_DIR
const servicesDir = process.env.SERVICES_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'services')
const locale = process.env.YOUPROOF_LOCALE || 'hu'
const skip = !contentDir && 'set YOUPROOF_CONTENT_DIR to a content checkout'

const KIND = { chapter: 'chapter', section: 'section', definition: 'entity', theorem: 'entity', proof: 'entity', remark: 'entity' }
const BLOCK_FIELDS = ['body', 'abstract', 'prerequisiteWarning', 'prologue', 'epilogue']

/** Every inline token of the file's reference texts, as written, in the order the site renders them. */
function tokenSources(text, kind) {
  return fileReferenceTexts(yaml.load(text), kind).flatMap((field) => [...inlineTokens(field)].map((match) => match.source))
}

function templatesOf(root) {
  const services = readServicesData(servicesDir)
  const templates = readDisplayTemplates(root, locale, services.entityLabels, services.localeConfig.locales)
  assert.deepEqual(templates.errors, [])
  return templates.collection
}

test('saving every real content file keeps its references list and its tokens byte for byte', { skip }, (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'yp-real-content-'))
  cpSync(path.resolve(contentDir), root, { recursive: true })
  const templates = templatesOf(root)
  const content = loadContent(root, locale, locale, templates)
  let files = 0
  let withList = 0
  let identical = 0
  const problems = []
  for (const [id, file] of content.idToFilePath) {
    const obj = content.idToObject.get(id)
    const kind = KIND[obj.type]
    if (!kind) continue
    const before = readFileSync(file, 'utf8')
    for (const field of BLOCK_FIELDS) {
      if (Array.isArray(obj[field])) obj[field] = updateModelBlocks(serializeBlocks(obj[field]), obj, content.idToObject)
    }
    const saveProblems = saveFromModel(id, content, templates)
    const after = readFileSync(file, 'utf8')
    files++
    if (referencesSection(before) !== null) withList++
    if (after === before) identical++
    const rel = path.relative(root, file)
    if (referencesSection(after) !== referencesSection(before)) problems.push(`${rel}: the references section changed`)
    if (saveProblems.length > 0) problems.push(`${rel}: ${saveProblems.join('; ')}`)
    assert.deepEqual(tokenSources(after, kind), tokenSources(before, kind), `${rel}: the tokens changed`)
  }
  t.diagnostic(`${files} files saved, ${withList} with a references list, ${identical} identical byte for byte`)
  assert.deepEqual(problems, [])
  assert.ok(withList > 0, 'the checkout has references lists')
})

test('every real content file loads without reference problems, and its list is written in the style the file has', { skip }, (t) => {
  const root = path.resolve(contentDir)
  const content = loadContent(root, locale, locale, templatesOf(root))
  let lists = 0
  const problems = []
  for (const [id, file] of content.idToFilePath) {
    const { references } = content.idToObject.get(id)
    if (!references) continue
    const rel = path.relative(root, file)
    for (const problem of references.problems) problems.push(`${rel}: ${problem}`)
    if (references.saved.length === 0) continue
    lists++
    if (referencesSectionFor(references.saved) !== references.source) problems.push(`${rel}: the list is written differently`)
  }
  t.diagnostic(`${lists} lists written as the files have them`)
  assert.deepEqual(problems.slice(0, 20), [])
})
