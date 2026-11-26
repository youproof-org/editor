// Resolves every reference of a real content checkout through the editor's own
// numbering and compares it with what the site build resolves, reference by
// reference, then compares what each reference token shows in the editor with
// what the site's pages render for it. The site's side comes from
// test/support/dump-site-references.mts, which runs in a services checkout (see
// its header).
//
// Opt-in, since the content and the site build live in other repos:
//   YOUPROOF_CONTENT_DIR=../content/content YOUPROOF_SITE_REFERENCES=<out.json> npm test
// The label registry is read from SERVICES_DIR, or the services folder beside this repo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Module from 'node:module'

const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'vscode') return {}
  return realLoad.call(this, request, ...rest)
}

const {
  loadContent, readServicesData, readDisplayTemplates, numberContent, editorOutline, resolveFileReferences, heldReferenceItems,
  heldReferenceTexts, resolveReferenceToken, findReferenceTokens, referencePlacements,
} = await import('../out/test/host.js')
const { referenceTokenView, referenceTokenText } = await import('../out/test/webview.js')

const contentDir = process.env.YOUPROOF_CONTENT_DIR
const siteReferences = process.env.YOUPROOF_SITE_REFERENCES
const servicesDir = process.env.SERVICES_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'services')
const locale = process.env.YOUPROOF_LOCALE || 'hu'

const marked = (display) => display.error !== undefined
  ? { error: display.error }
  : {
      marked: display.segments.map((s) => (s.kind === 'link' ? `[${s.text}]` : s.text)).join(''),
      links: display.segments.filter((s) => s.kind === 'link').map((s) => (s.target.type === 'external' ? s.target.url : s.target.fqn)),
    }

const skip = !(contentDir && siteReferences) && 'set YOUPROOF_CONTENT_DIR and YOUPROOF_SITE_REFERENCES'

let loaded
function load() {
  if (loaded) return loaded
  const site = JSON.parse(readFileSync(siteReferences, 'utf8'))
  const content = loadContent(path.resolve(contentDir), locale)
  const services = readServicesData(servicesDir)
  const templates = readDisplayTemplates(path.resolve(contentDir), locale, services.entityLabels, services.localeConfig.locales)
  assert.deepEqual(templates.errors, [])
  const numbering = numberContent(content)
  const resolution = { numbering, templates: templates.collection, labels: services.entityLabels }

  const owners = []
  for (const book of content.books) {
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        const fqn = `books.${book.name}.chapters.${chapter.name}`
        owners.push([`chapter:${fqn}`, chapter])
        for (const section of chapter.sections) owners.push([`section:${fqn}.sections.${section.name}`, section])
      }
    }
  }
  for (const [entity, fqn] of editorOutline(content).names) owners.push([`${entity.type}:${fqn}`, entity])
  loaded = { site, numbering, resolution, owners }
  return loaded
}

test('every reference resolves through the editor numbering as the site resolves it', { skip }, (t) => {
  const { site: { references: site }, numbering, resolution, owners } = load()

  let references = 0
  let matched = 0
  const mismatches = []
  for (const [key, owner] of owners) {
    const expected = site[key]
    if (!expected) {
      mismatches.push(`${key}: the site has no such owner`)
      continue
    }
    const actual = resolveFileReferences(heldReferenceItems(owner), owner.locale, resolution).map(marked)
    references += expected.length
    if (actual.length !== expected.length) mismatches.push(`${key}: ${actual.length} references, the site has ${expected.length}`)
    expected.forEach((want, i) => {
      if (JSON.stringify(actual[i]) === JSON.stringify(want)) matched++
      else mismatches.push(`${key} [${i}]: editor ${JSON.stringify(actual[i])}, site ${JSON.stringify(want)}`)
    })
  }
  const missing = Object.keys(site).filter((key) => !owners.some(([k]) => k === key))
  t.diagnostic(`${owners.length} owners, ${references} references, ${matched} match the site; ${numbering.problems.length} numbering problems`)
  assert.deepEqual(numbering.problems, [])
  assert.deepEqual(missing, [], 'owners the site has that the editor did not load')
  assert.deepEqual(mismatches.slice(0, 20), [])
})

test('every reference token shows what the site renders for it, capitalized where the site capitalizes it', { skip }, (t) => {
  const { site: { inline: site }, resolution, owners } = load()
  let tokens = 0
  let matched = 0
  let capitalized = 0
  const mismatches = []
  for (const [key, owner] of owners) {
    const expected = site[key] ?? []
    const shown = []
    for (const text of heldReferenceTexts(owner)) {
      const placements = referencePlacements(text)
      findReferenceTokens(text).forEach((token, i) => {
        if (!placements[i].read) return
        const view = referenceTokenView(token, placements[i], resolveReferenceToken(token.payload, owner.locale, resolution))
        if (placements[i].sentenceStart) capitalized++
        shown.push(view.state === 'rendered'
          ? { marked: referenceTokenText(view), links: view.parts.flatMap((part) => (part.target === undefined ? [] : [part.target])) }
          : { error: view.reason })
      })
    }
    tokens += shown.length
    if (shown.length !== expected.length) mismatches.push(`${key}: ${shown.length} tokens, the site renders ${expected.length}`)
    expected.forEach(({ index, ...want }, i) => {
      if (index !== i) mismatches.push(`${key}: the site renders [${index}] as reference ${i}`)
      if (JSON.stringify(shown[i]) === JSON.stringify(want)) matched++
      else mismatches.push(`${key} [${i}]: editor ${JSON.stringify(shown[i])}, site ${JSON.stringify(want)}`)
    })
  }
  t.diagnostic(`${tokens} tokens shown, ${matched} as the site renders them, ${capitalized} at the start of a sentence`)
  assert.deepEqual(mismatches.slice(0, 20), [])
  assert.equal(matched, tokens)
})
