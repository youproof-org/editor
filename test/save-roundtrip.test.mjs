// Round-trip guard for the editor's YAML writer.
//
// The knowledge base carries public per-node URLs, so a definition, a theorem and
// every `claim` and `terms` entry has a `slug`. A proof and a remark have none —
// each is addressed by its position in the list of the node that owns it.
//
// The ENTITY-level slug is still unmodelled: it survives because saveFromModel
// merges into the loaded YAML rather than rebuilding it. Claim and term slugs ARE
// modelled since YP-173, and are reconstructed field by field on save, so a
// writer that forgets one deletes it — that is the regression this file exists to
// catch. It also pins what modelling them bought: a renamed claim keeps its slug,
// where the old name-keyed carry-over dropped it.
//
// Alongside that it pins three neighbouring invariants: a proof's `terms` block
// survives (the model has no `Proof.terms`, so an empty model must not be read as
// "delete"), a slug the site build would reject is refused here rather than
// written, and saving is idempotent.
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

const { saveFromModel, serializeRefs, updateModelRefs, updateModelTerms } = await import('../out/handlers.js')
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
  a-remark:
    display: "[megjegyzés]"
    target: definitions.proba-definicio.remarks.proba-megjegyzes
  a-remark-term:
    display: "[megjegyzés-fogalom]"
    target: definitions.proba-definicio.remarks.proba-megjegyzes.terms.remark-term
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
    content: >-
      Lásd [a-definition], [a-claim], [a-proof], [a-remark], [a-remark-term],
      [a-page], [a-book], [a-url], [a-mail].
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

/**
 * The same, but through the webview round trip Ctrl+S goes through: the panel is
 * sent each reference as an ID and sends that ID back, so the authored path is not
 * on the wire at all and the writer has to rebuild it from the object graph.
 */
function saveAllThroughPanel(root) {
  const content = loadContent(root, 'hu')
  const files = {}
  for (const [id, fp] of content.idToFilePath) {
    if (path.basename(fp) === NS) continue
    if (path.basename(fp) === 'episodes.yaml') continue
    const obj = content.idToObject.get(id)
    updateModelRefs(obj, serializeRefs(obj.references ?? []), content.idToObject)
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
// Claim and term slugs as MODELLED fields (YP-173)
//
// Before they were modelled, the writer rescued them off the file and keyed them
// back by name. That made a slug un-editable, gave a newly created claim none at
// all, and silently dropped one on rename. These pin the replacement.
// ---------------------------------------------------------------------------

const DEF_REL = path.join('knowledge-base', 'proba', 'definitions', 'proba-definicio.yaml')

/** The loaded model object for a file, plus the content bundle it belongs to. */
function nodeFor(root, rel) {
  const content = loadContent(root, 'hu')
  for (const [id, fp] of content.idToFilePath) {
    if (path.relative(root, fp) === rel) return { content, id, obj: content.idToObject.get(id) }
  }
  throw new Error(`no loaded node for ${rel}`)
}

/** Every claim in a model object's body, including ones nested in a subsection. */
const modelClaims = (blocks) =>
  (blocks ?? []).flatMap((b) => (b?.blockType === 'claim' ? [b] : modelClaims(b?.blocks)))

const readDef = (root) => doc(readFileSync(path.join(root, DEF_REL), 'utf8'))

test('a claim slug edited in the model is written to the file', () => {
  const root = fixture()
  const { content, id, obj } = nodeFor(root, DEF_REL)
  modelClaims(obj.body).find((c) => c.name === 'top-level-claim').slug = 'atirt-allitas'
  saveFromModel(id, content)

  const written = Object.fromEntries(claims(readDef(root).body).map((c) => [c.name, c.slug]))
  assert.equal(written['top-level-claim'], 'atirt-allitas')
  assert.equal(written['nested-claim'], 'beagyazott-allitas', 'the sibling is untouched')
})

test('renaming a claim KEEPS its slug', () => {
  // The behaviour change. The old carry-over was keyed by name, so a rename made
  // the lookup miss and the slug vanish from the file.
  const root = fixture()
  const { content, id, obj } = nodeFor(root, DEF_REL)
  modelClaims(obj.body).find((c) => c.name === 'top-level-claim').name = 'atnevezett-allitas'
  saveFromModel(id, content)

  const written = Object.fromEntries(claims(readDef(root).body).map((c) => [c.name, c.slug]))
  assert.equal(written['atnevezett-allitas'], 'legfelso-allitas')
  assert.ok(!('top-level-claim' in written), 'the old name is gone')
})

test('an empty slug writes no key at all, on a claim and on a term', () => {
  // Legal content: the site falls back to the English id, so the page still
  // renders. `slug: ''` would NOT be legal — the build rejects the shape.
  const root = fixture()
  const { content, id, obj } = nodeFor(root, DEF_REL)
  modelClaims(obj.body).find((c) => c.name === 'nested-claim').slug = ''
  obj.terms.find((t) => t.name === 'second-term').slug = ''
  saveFromModel(id, content)

  const d = readDef(root)
  const nested = claims(d.body).find((c) => c.name === 'nested-claim')
  assert.ok(!('slug' in nested), 'no empty slug key on the claim')
  assert.ok(!('slug' in d.terms['second-term']), 'no empty slug key on the term')
  assert.equal(claims(d.body).find((c) => c.name === 'top-level-claim').slug, 'legfelso-allitas')
})

test('a term slug survives the webview round trip', () => {
  // updateModelTerms is the webview's half of a term save; a field it forgets to
  // copy never reaches saveFromModel in the first place.
  const root = fixture()
  const { content, id, obj } = nodeFor(root, DEF_REL)
  const incoming = obj.terms.map((t) => ({
    id: t.id, name: t.name, slug: t.slug, display: t.display,
    canonical: t.canonical, synonyms: t.synonyms,
  }))
  incoming.find((t) => t.name === 'first-term').slug = 'atirt-fogalom'
  updateModelTerms(obj, incoming, content.idToObject)
  saveFromModel(id, content)

  const d = readDef(root)
  assert.equal(d.terms['first-term'].slug, 'atirt-fogalom')
  assert.equal(d.terms['second-term'].slug, 'masodik-fogalom')
})

// ── Refusals. Each mirrors a rule the services repo's graph.ts enforces, so the
// editor cannot write something CI or the site build then fails on. ──

const saveShouldThrow = (root, id, content, re) =>
  assert.throws(() => saveFromModel(id, content), re)

test('a malformed slug is refused, and the file is left untouched', () => {
  const root = fixture()
  const before = readFileSync(path.join(root, DEF_REL), 'utf8')
  const { content, id, obj } = nodeFor(root, DEF_REL)
  modelClaims(obj.body).find((c) => c.name === 'top-level-claim').slug = 'Nem Kebab.Case'
  saveShouldThrow(root, id, content, /not a valid identifier/)
  assert.equal(readFileSync(path.join(root, DEF_REL), 'utf8'), before, 'nothing was written')
})

test('a malformed TERM slug is refused too', () => {
  const root = fixture()
  const { content, id, obj } = nodeFor(root, DEF_REL)
  obj.terms.find((t) => t.name === 'first-term').slug = 'Rossz_Alak'
  saveShouldThrow(root, id, content, /not a valid identifier/)
})

test('two claims on one node cannot share an anchor', () => {
  const root = fixture()
  const { content, id, obj } = nodeFor(root, DEF_REL)
  modelClaims(obj.body).find((c) => c.name === 'nested-claim').slug = 'legfelso-allitas'
  saveShouldThrow(root, id, content, /both anchor at "legfelso-allitas"/)
})

test('a slug-less claim collides on its NAME, which is what it anchors at', () => {
  // The fallback rule: `slug ?? name`. Comparing authored slugs alone would let
  // this pair through, and the site build would then reject it.
  const root = fixture()
  const { content, id, obj } = nodeFor(root, DEF_REL)
  const cs = modelClaims(obj.body)
  cs.find((c) => c.name === 'nested-claim').slug = ''
  cs.find((c) => c.name === 'top-level-claim').slug = 'nested-claim'
  saveShouldThrow(root, id, content, /both anchor at "nested-claim"/)
})

test('a claim and a term on one node MAY share a slug', () => {
  // Deliberate: they sit under distinct `allitasok.` / `fogalmak.` segments, so
  // the anchors differ. The check must be scoped per kind, not across.
  const root = fixture()
  const { content, id, obj } = nodeFor(root, DEF_REL)
  modelClaims(obj.body).find((c) => c.name === 'top-level-claim').slug = 'kozos'
  obj.terms.find((t) => t.name === 'first-term').slug = 'kozos'
  saveFromModel(id, content)

  const d = readDef(root)
  assert.equal(claims(d.body).find((c) => c.name === 'top-level-claim').slug, 'kozos')
  assert.equal(d.terms['first-term'].slug, 'kozos')
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
  // A remark, and a term inside one. The owner search behind these has to skip the
  // NAMESPACE, which also lists every remark in its folder — picking the namespace
  // ends the walk on a segment the grammar has no name for, and the target is then
  // written back as no target at all.
  assert.equal(refs['a-remark'].target, 'definitions.proba-definicio.remarks.proba-megjegyzes')
  assert.equal(refs['a-remark-term'].target,
    'definitions.proba-definicio.remarks.proba-megjegyzes.terms.remark-term')
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

test('a reference target is never silently dropped, saving through the panel', () => {
  // The regression this exists for: on the wire a target is only an ID, so the
  // authored path is gone by the time the file is written and every target has to
  // be rebuilt by walking the object graph. A remark target could not be — the walk
  // found the namespace that lists the remark instead of the definition that owns
  // it — so opening a file and pressing Ctrl+S deleted it. 98 files in the content
  // repo carry such a target.
  const root = fixture()
  for (const [rel, text] of Object.entries(saveAllThroughPanel(root))) {
    for (const [key, entry] of Object.entries(doc(text).references ?? {})) {
      assert.ok(entry.target, `${rel}: reference '${key}' lost its target`)
    }
  }
})

test('saving through the panel writes the same paths as saving from the model', () => {
  const direct = chapterDoc(saveAll(fixture())).references
  const panel  = chapterDoc(saveAllThroughPanel(fixture())).references
  assert.deepEqual(panel, direct)
})
