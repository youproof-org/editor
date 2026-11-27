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
  numberContent, buildReferenceChoices, parseRefTarget, encodeReferenceToken, resolveReferenceToken,
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

test('saving every real content file unedited keeps it byte for byte, its references list and tokens included', { skip }, (t) => {
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
  assert.equal(identical, files, 'a save that changes nothing keeps every file byte for byte')
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

function choicesOf(root) {
  const services = readServicesData(servicesDir)
  const templates = templatesOf(root)
  const content = loadContent(root, locale, locale, templates)
  const resolution = { numbering: numberContent(content), templates, labels: services.entityLabels }
  return { content, resolution, choices: buildReferenceChoices(content, resolution) }
}

const MODELLED = ['chapter', 'section', 'definition', 'theorem', 'proof', 'remark', 'claim', 'term']

test('the reference popup offers every target the real references use, under the same path, each naming its object', { skip }, (t) => {
  const { content, choices } = choicesOf(path.resolve(contentDir))
  const offered = new Map(choices.targets.map((target) => [target.path, target]))
  const missing = new Set()
  let cited = 0
  for (const obj of content.idToObject.values()) {
    for (const item of obj.references?.saved ?? []) {
      for (const target of item.targets ?? [item.target]) {
        let kind
        try { kind = parseRefTarget(target, 'target').type } catch { continue }
        if (!MODELLED.includes(kind)) continue
        cited++
        if (!offered.has(target)) missing.add(target)
      }
    }
  }
  const kindOf = (obj) => obj.type ?? obj.blockType ?? (Array.isArray(obj.synonyms) ? 'term' : undefined)
  const misnamed = choices.targets.filter((target) => {
    const obj = content.idToObject.get(target.id)
    return !obj || obj.name !== parseRefTarget(target.path, 'target').name || kindOf(obj) !== target.kind
  }).map((target) => target.path)
  t.diagnostic(`${choices.targets.length} targets offered, ${cited} cited targets of the kinds the editor loads`)
  assert.deepEqual([...missing], [])
  assert.deepEqual(misnamed, [])
})

test('every template the popup offers for a single real target renders it', { skip }, (t) => {
  const { resolution, choices } = choicesOf(path.resolve(contentDir))
  const failures = []
  let rendered = 0
  for (const target of choices.targets) {
    if (target.problem) continue
    for (const template of choices.templates) {
      if (!template.targets.includes(target.kind) || template.count.min > 1) continue
      const payload = encodeReferenceToken({ display: template.name, target: target.path }).slice(2, -1)
      const display = resolveReferenceToken(payload, locale, resolution)
      rendered++
      if (display.error) failures.push(`${template.name} on ${target.path}: ${display.error}`)
    }
  }
  t.diagnostic(`${rendered} previews rendered`)
  assert.deepEqual(failures.slice(0, 20), [])
})
