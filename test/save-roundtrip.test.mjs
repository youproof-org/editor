// Round-trip guard for the editor's YAML writer.
//
// The knowledge base carries public per-node URLs, so a definition, a theorem and
// every `claim` and `terms` entry has a `slug` that the editor does NOT model. A
// proof and a remark have none — each is addressed by its position in the list of
// the node that owns it. Claims and terms are reconstructed field by field on
// save, so without explicit carry-over the first save in the editor silently
// deletes their slug — that is the regression this file exists to catch. It also
// pins two neighbouring invariants: a proof's `terms` block survives (the model
// has no `Proof.terms`, so an empty model must not be read as "delete"), and
// saving is idempotent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Module from 'node:module'
import yaml from 'js-yaml'

// handlers.js requires 'vscode', which only resolves inside the extension host.
// Nothing under test touches it, so a bare stub is enough.
const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'vscode') return {}
  return realLoad.call(this, request, ...rest)
}

const { saveFromModel } = await import('../out/handlers.js')
const { loadContent } = await import('../out/content/loader.js')

const NS = 'namespace.yaml'

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'yp-editor-'))
  const ns = path.join(root, 'knowledge-base', 'proba')
  for (const d of ['definitions', 'theorems', 'proofs', 'remarks']) {
    mkdirSync(path.join(ns, d), { recursive: true })
  }
  const w = (rel, body) => writeFileSync(path.join(ns, rel), body)

  writeFileSync(path.join(ns, NS), 'type: namespace\nname: proba\nlocale: hu\ntitle: Próba\n')

  // A book, so there is something for a chapter/section target to resolve against
  // and something for the `part` key order to be checked on.
  const books = path.join(root, 'books', 'konyv', 'resz', 'fejezet')
  mkdirSync(books, { recursive: true })
  writeFileSync(path.join(root, 'books', 'episodes.yaml'), '- konyv\n')
  writeFileSync(path.join(root, 'books', 'konyv', 'book.yaml'),
    'type: book\nname: konyv\nslug: konyv\nlocale: hu\ntitle: Könyv\nparts:\n  - resz\n')
  writeFileSync(path.join(root, 'books', 'konyv', 'resz', 'part.yaml'),
    'type: part\nname: resz\nslug: resz\nlocale: hu\ntitle: Rész\nchapters:\n  - fejezet\n')
  writeFileSync(path.join(books, 'chapter.yaml'), `type: chapter
name: fejezet
slug: fejezet
locale: hu
title: Fejezet
references:
  a-definition:
    display: "[definíció]"
    target: definitions.proba-definicio
  a-claim:
    display: "[állítás]"
    target: definitions.proba-definicio.claims.top-level-claim
  a-proof:
    display: "[bizonyítás]"
    target: theorems.proba-tetel.proofs.proba-bizonyitas
  a-page:
    display: "[Impresszum]"
    target: pages.impresszum
  a-book:
    display: "[Könyv]"
    target: books.konyv
  a-url:
    display: "Link"
    target: https://example.org/x
  a-mail:
    display: "Mail"
    target: mailto:hello@youproof.org
prologue:
  - type: narrative
    content: Lásd [a-definition], [a-claim], [a-proof], [a-page], [a-book], [a-url], [a-mail].
sections: []
`)

  // definition: entity slug + two term slugs + two claim slugs, one claim nested
  // inside a subsection (claims are collected recursively).
  w('definitions/proba-definicio.yaml', `type: definition
name: proba-definicio
slug: proba-definicio
locale: hu
title: Próba definíció
remarks:
  - proba-megjegyzes
terms:
  first-term:
    slug: elso-fogalom
    display: "[első fogalom]"
    canonical: első fogalom
  second-term:
    slug: masodik-fogalom
    display: "[második fogalom]"
    canonical: második fogalom
references: {}
body:
  - type: narrative
    content: Bevezető [[first-term]] szöveg.
  - type: claim
    name: top-level-claim
    slug: legfelso-allitas
    content: Egy állítás.
  - type: subsection
    title: Alszakasz
    blocks:
      - type: narrative
        content: Beágyazott [[second-term]] szöveg.
      - type: claim
        name: nested-claim
        slug: beagyazott-allitas
        content: Beágyazott állítás.
`)

  w('theorems/proba-tetel.yaml', `type: theorem
name: proba-tetel
slug: proba-tetel
locale: hu
title: Próba tétel
proofs:
  - proba-bizonyitas
remarks: []
references: {}
body:
  - type: narrative
    content: Tétel szöveg.
`)

  // proof: terms + a claim, neither of which the model represents for a proof
  w('proofs/proba-bizonyitas.yaml', `type: proof
name: proba-bizonyitas
locale: hu
remarks: []
terms:
  proof-term:
    slug: bizonyitas-fogalom
    display: "[bizonyítás-fogalom]"
    canonical: bizonyítás-fogalom
references: {}
body:
  - type: narrative
    content: Bizonyítás szöveg.
  - type: claim
    name: proof-claim
    slug: bizonyitas-allitas
    content: Bizonyításbeli állítás.
`)

  w('remarks/proba-megjegyzes.yaml', `type: remark
name: proba-megjegyzes
locale: hu
terms:
  remark-term:
    slug: megjegyzes-fogalom
    display: "[megjegyzés-fogalom]"
    canonical: megjegyzés-fogalom
references: {}
body:
  - type: narrative
    content: Megjegyzés szöveg.
`)
  return root
}

/** Save every file-backed knowledge-base object, then return path -> text. */
function saveAll(root) {
  const content = loadContent(root, 'hu')
  const files = {}
  for (const [id, fp] of content.idToFilePath) {
    if (path.basename(fp) === NS) continue
    if (path.basename(fp) === 'episodes.yaml') continue
    saveFromModel(id, content)
    files[path.relative(root, fp)] = readFileSync(fp, 'utf8')
  }
  return files
}

const doc = (text) => yaml.load(text)
const claims = (blocks) =>
  (blocks ?? []).flatMap((b) => (b?.type === 'claim' ? [b] : claims(b?.blocks)))

test('entity, claim and term slugs survive a save', () => {
  const root = fixture()
  const files = saveAll(root)

  const def = doc(files[path.join('knowledge-base', 'proba', 'definitions', 'proba-definicio.yaml')])
  assert.equal(def.slug, 'proba-definicio', 'entity slug')
  assert.equal(def.terms['first-term'].slug, 'elso-fogalom')
  assert.equal(def.terms['second-term'].slug, 'masodik-fogalom')
  const defClaims = Object.fromEntries(claims(def.body).map((c) => [c.name, c.slug]))
  assert.deepEqual(defClaims, {
    'top-level-claim': 'legfelso-allitas',
    'nested-claim': 'beagyazott-allitas',
  }, 'claim slugs, including one nested in a subsection')

  const rem = doc(files[path.join('knowledge-base', 'proba', 'remarks', 'proba-megjegyzes.yaml')])
  assert.ok(!('slug' in rem), 'a remark has no slug, and a save must not invent one')
  assert.equal(rem.terms['remark-term'].slug, 'megjegyzes-fogalom')

  const thm = doc(files[path.join('knowledge-base', 'proba', 'theorems', 'proba-tetel.yaml')])
  assert.equal(thm.slug, 'proba-tetel')
})

test('a proof keeps its terms block, which the model does not represent', () => {
  const root = fixture()
  const files = saveAll(root)
  const proof = doc(files[path.join('knowledge-base', 'proba', 'proofs', 'proba-bizonyitas.yaml')])

  assert.ok(proof.terms, 'terms block must not be deleted')
  assert.equal(proof.terms['proof-term'].slug, 'bizonyitas-fogalom')
  assert.equal(proof.terms['proof-term'].canonical, 'bizonyítás-fogalom')
  assert.ok(!('slug' in proof), 'a proof has no slug, and a save must not invent one')
  assert.equal(claims(proof.body)[0].slug, 'bizonyitas-allitas')
})

const SLUGLESS_TYPES = ['proof', 'remark']

test('slug keeps its position: immediately after name, on every type that has one', () => {
  const root = fixture()
  const files = saveAll(root)
  for (const [rel, text] of Object.entries(files)) {
    const d = doc(text)
    const head = SLUGLESS_TYPES.includes(d.type)
      ? ['type', 'name', 'locale']
      : ['type', 'name', 'slug', 'locale']
    assert.deepEqual(Object.keys(d).slice(0, head.length), head, rel)
  }
})

test('saving is idempotent', () => {
  const root = fixture()
  const first = saveAll(root)
  const second = saveAll(root)
  assert.deepEqual(second, first, 'a second save must not change any byte')
})

// ---------------------------------------------------------------------------
// Reference targets
// ---------------------------------------------------------------------------

const chapterDoc = (files) =>
  doc(files[path.join('books', 'konyv', 'resz', 'fejezet', 'chapter.yaml')])

test('a resolvable target is rewritten as the same fully qualified name', () => {
  const root = fixture()
  const refs = chapterDoc(saveAll(root)).references
  // Rebuilt from the object graph, not echoed — which is what lets a path follow a
  // rename. Landing on the identical string is the point.
  assert.equal(refs['a-definition'].target, 'definitions.proba-definicio')
  assert.equal(refs['a-claim'].target, 'definitions.proba-definicio.claims.top-level-claim')
  assert.equal(refs['a-proof'].target, 'theorems.proba-tetel.proofs.proba-bizonyitas')
})

test('an external target survives, including a scheme with no slashes', () => {
  const root = fixture()
  const refs = chapterDoc(saveAll(root)).references
  assert.equal(refs['a-url'].target, 'https://example.org/x')
  // `mailto:` has no `//`, which is why the internal/external test is a scheme test.
  assert.equal(refs['a-mail'].target, 'mailto:hello@youproof.org')
})

test('a target this editor cannot model survives a save', () => {
  // The regression this exists for: the editor loads only books and the knowledge
  // base, so an article/page/landing/book reference has nothing to resolve to. It
  // used to load as an empty external and be written back with NO target at all —
  // silently deleting it. Verified against the real content: 13 such references
  // exist today.
  const root = fixture()
  const refs = chapterDoc(saveAll(root)).references
  assert.equal(refs['a-page'].target, 'pages.impresszum', 'a page reference must not be dropped')
  assert.equal(refs['a-book'].target, 'books.konyv', 'a book reference must not be dropped')
})

test('a reference target is never silently dropped', () => {
  const root = fixture()
  const refs = chapterDoc(saveAll(root)).references
  for (const [key, entry] of Object.entries(refs)) {
    assert.ok(entry.target, `reference '${key}' lost its target`)
  }
})

test('a file with an unmigrated target refuses to save, rather than dropping it', () => {
  // The window this guards: between the editor learning path targets and the
  // content being migrated to them, every target in the content is still a
  // composite object this editor cannot write back. Skipping it would delete it on
  // save -- which is exactly what happened once, and what this refuses to repeat.
  const root = fixture()
  const legacy = path.join(root, 'books', 'konyv', 'resz', 'fejezet', 'chapter.yaml')
  writeFileSync(legacy, `type: chapter
name: fejezet
slug: fejezet
locale: hu
title: Fejezet
references:
  old-shape:
    display: "[definíció]"
    target:
      type: definition
      namespace: /proba
      name: proba-definicio
prologue: []
sections: []
`)
  const content = loadContent(root, 'hu')
  const id = content.filePathToId.get(legacy)
  assert.throws(() => saveFromModel(id, content), /cannot write back|Saving would delete/)
  // And the file on disk is untouched, which is the point.
  assert.match(readFileSync(legacy, 'utf8'), /type: definition/)
})
