// Saves every file of a real content checkout, in a temporary copy, and checks that
// the `references` list and the `[i]` tokens come back exactly as they were. The
// editor can't edit references yet, so a save that changed either would leave the
// list out of step with the text.
//
// Opt-in, since the content lives in another repo:
//   YOUPROOF_CONTENT_DIR=../content/content npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Module from 'node:module'
import yaml from 'js-yaml'

const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'vscode') return {}
  return realLoad.call(this, request, ...rest)
}

const { loadContent, saveFromModel, referencesSection, fileReferenceTexts, inlineTokens } = await import('../out/test/host.js')

const contentDir = process.env.YOUPROOF_CONTENT_DIR
const locale = process.env.YOUPROOF_LOCALE || 'hu'

const KIND = { chapter: 'chapter', section: 'section', definition: 'entity', theorem: 'entity', proof: 'entity', remark: 'entity' }

/** Every inline token of the file's reference texts, as written, in the order the site renders them. */
function tokenSources(text, kind) {
  return fileReferenceTexts(yaml.load(text), kind).flatMap((field) => [...inlineTokens(field)].map((match) => match.source))
}

test('saving every real content file keeps its references list and its tokens byte for byte', { skip: !contentDir && 'set YOUPROOF_CONTENT_DIR to a content checkout' }, (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'yp-real-content-'))
  cpSync(path.resolve(contentDir), root, { recursive: true })
  const content = loadContent(root, locale)
  let files = 0
  let withList = 0
  let identical = 0
  const problems = []
  for (const [id, file] of content.idToFilePath) {
    const kind = KIND[content.idToObject.get(id).type]
    if (!kind) continue
    const before = readFileSync(file, 'utf8')
    saveFromModel(id, content)
    const after = readFileSync(file, 'utf8')
    files++
    if (referencesSection(before) !== null) withList++
    if (after === before) identical++
    const rel = path.relative(root, file)
    if (referencesSection(after) !== referencesSection(before)) problems.push(`${rel}: the references section changed`)
    assert.deepEqual(tokenSources(after, kind), tokenSources(before, kind), `${rel}: the tokens changed`)
  }
  t.diagnostic(`${files} files saved, ${withList} with a references list, ${identical} identical byte for byte`)
  assert.deepEqual(problems, [])
  assert.ok(withList > 0, 'the checkout has references lists')
})
