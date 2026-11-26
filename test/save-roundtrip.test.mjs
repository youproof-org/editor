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

// The host bundle requires 'vscode', which only resolves inside the extension host.
// Nothing under test touches it, so a bare stub is enough.
const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'vscode') return {}
  return realLoad.call(this, request, ...rest)
}

const {
  saveFromModel,
  serializeTerms, updateModelTerms,
  serializeBlocks, updateModelBlocks,
  loadContent,
  referencesSection,
  heldReferences, heldReferenceItems, findReferenceTokens,
} = await import('../out/test/host.js')

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
  - { text: '[definíció]', target: definitions.proba-definicio }
  - { text: '[állítás]', target: definitions.proba-definicio.claims.top-level-claim }
  - { text: '[bizonyítás]', target: theorems.proba-tetel.proofs.proba-bizonyitas }
  - { text: '[megjegyzés]', target: definitions.proba-definicio.remarks.proba-megjegyzes }
  - { text: '[megjegyzés-fogalom]', target: definitions.proba-definicio.remarks.proba-megjegyzes.terms.remark-term }
  - { text: '[Impresszum]', target: pages.impresszum }
  - { text: '[Könyv]', target: books.konyv }
  - { text: '[Link]', target: "https://example.org/x" }
  - { text: '[Mail]', target: "mailto:hello@youproof.org" }
prologue:
  - type: narrative
    content: >-
      Lásd [0], [1], [2], [3], [4],
      [5], [6], [7], [8].
  - type: embed
    target: definitions.proba-definicio
  - type: embed
    target: theorems.proba-tetel.proofs.proba-bizonyitas
  - type: embed
    target: definitions.proba-definicio.remarks.proba-megjegyzes
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
references: []
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
label: lemma
proofs:
  - proba-bizonyitas
remarks: []
references: []
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
references: []
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
references: []
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
 * The same, but through the FULL webview round trip that Ctrl+S goes through:
 * every block and term is serialized out to the panel and fed straight
 * back, untouched. Saving an unedited node this way must be a no-op.
 *
 * Whole-object, not references alone, because the wire is a WHITELIST in both
 * directions — serializeBlock / serializeTerms choose what the panel sees, and
 * applyWireToBlock / updateModelTerms choose what comes back. A field missing
 * from either list vanishes silently on the way through, and saveFromModel is
 * perfectly happy to write the result. That is invisible to a test that only
 * exercises the model.
 */
function saveAllThroughPanel(root) {
  const content = loadContent(root, 'hu')
  const files = {}
  for (const [id, fp] of content.idToFilePath) {
    if (path.basename(fp) === NS) continue
    if (path.basename(fp) === 'episodes.yaml') continue
    const obj = content.idToObject.get(id)
    for (const field of ['body', 'abstract', 'prerequisiteWarning', 'prologue', 'epilogue']) {
      if (Array.isArray(obj[field])) {
        obj[field] = updateModelBlocks(serializeBlocks(obj[field]), obj, content.idToObject)
      }
    }
    if (Array.isArray(obj.terms)) updateModelTerms(obj, serializeTerms(obj.terms), content.idToObject)
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

test('a slug survives the round trip through the panel', () => {
  // The regression this pins: the panel wire is a whitelist, and `slug` was on
  // neither side of it when claims and terms first gained one. A claim's slug was
  // invisible in the editor and an edit to it went nowhere; a term's was worse —
  // it came back `undefined` and the writer then dropped the key, deleting a slug
  // that had only ever been missing from the serializer.
  const root = fixture()
  const before = saveAll(root)
  const after = saveAllThroughPanel(root)
  assert.deepEqual(after, before, 'the panel round trip must change nothing')

  const d = doc(after[DEF_REL])
  assert.equal(d.terms['first-term'].slug, 'elso-fogalom')
  assert.equal(d.terms['second-term'].slug, 'masodik-fogalom')
  assert.deepEqual(
    Object.fromEntries(claims(d.body).map((c) => [c.name, c.slug])),
    { 'top-level-claim': 'legfelso-allitas', 'nested-claim': 'beagyazott-allitas' },
  )
})

test('a slug EDITED in the panel reaches the file', () => {
  const root = fixture()
  const { content, id, obj } = nodeFor(root, DEF_REL)

  const wireBlocks = serializeBlocks(obj.body)
  const wireClaim = wireBlocks.find((b) => b.blockType === 'claim')
  assert.equal(wireClaim.slug, 'legfelso-allitas', 'the panel is sent the current slug')
  wireClaim.slug = 'panelbol-atirt'

  const wireTerms = serializeTerms(obj.terms)
  assert.equal(wireTerms[0].slug, 'elso-fogalom', 'the panel is sent the current term slug')
  wireTerms.find((t) => t.name === 'first-term').slug = 'panelbol-atirt-fogalom'

  obj.body = updateModelBlocks(wireBlocks, obj, content.idToObject)
  updateModelTerms(obj, wireTerms, content.idToObject)
  saveFromModel(id, content)

  const d = readDef(root)
  assert.equal(claims(d.body).find((c) => c.name === 'top-level-claim').slug, 'panelbol-atirt')
  assert.equal(d.terms['first-term'].slug, 'panelbol-atirt-fogalom')
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
// References
//
// The editor reads each file's `references` list with the site build's reader and
// can't edit references yet, so a save writes the list back exactly as it was
// loaded and leaves the `[i]` tokens in the text as they are. A keyed dictionary,
// the format the list replaced, is refused like a `labels` block.
// ---------------------------------------------------------------------------

const CHAPTER_REL = path.join('books', 'konyv', 'resz', 'fejezet', 'chapter.yaml')
const chapterDoc = (files) => doc(files[CHAPTER_REL])
const chapterOf = (content) => [...content.idToObject.values()].find((o) => o.type === 'chapter')

test('the references section is the key and its lines, up to the next top-level key', () => {
  const list = "references:\n  - { text: '[a]', target: definitions.a }\n  - { text: '[b]', target: definitions.b }\n"
  assert.equal(referencesSection(`type: section\n${list}body: []\n`), list)
  assert.equal(referencesSection(`type: section\n${list}\n\nbody: []\n`), list, 'trailing blank lines belong to no key')
  assert.equal(referencesSection(`type: section\n${list.trimEnd()}`), list, 'a list at the end of the file')
  assert.equal(referencesSection('references: []\nbody: []\n'), 'references: []\n')
  assert.equal(referencesSection('references:\n- { text: a, target: definitions.a }\nbody: []\n'),
    'references:\n- { text: a, target: definitions.a }\n', 'items at the indentation of the key')
  assert.equal(referencesSection('type: section\nbody: []\n'), null)
})

test('the references list and its tokens are written back byte for byte', () => {
  const root = fixture()
  const file = path.join(root, CHAPTER_REL)
  const before = readFileSync(file, 'utf8')
  for (const save of [saveAll, saveAllThroughPanel]) {
    const after = save(root)[CHAPTER_REL]
    assert.equal(referencesSection(after), referencesSection(before), save.name)
    assert.equal(doc(after).prologue[0].content, doc(before).prologue[0].content, save.name)
  }
})

test('each token holds the item it cites, and the text holds no index', () => {
  const content = loadContent(fixture(), 'hu')
  const chapter = chapterOf(content)
  const file = doc(readFileSync(chapter.filePath, 'utf8'))
  assert.equal(chapter.references.isDictionary, false)
  assert.deepEqual(chapter.references.saved, file.references)
  assert.deepEqual(heldReferences(chapter), file.references)
  assert.deepEqual(heldReferenceItems(chapter)[0], { text: '[definíció]', targets: [{
    type: 'definition', name: 'proba-definicio', fqn: 'definitions.proba-definicio', parentFqn: '', parentKind: null,
  }] })
  const text = chapter.prologue[0].content
  assert.doesNotMatch(text, /\[\d+\]/)
  assert.deepEqual(findReferenceTokens(text).map((t) => t.item), file.references)
})

test('tokens are read in the order the site renders the text, through a figure caption, a quote and a details title', () => {
  const root = fixture()
  const chapterDir = path.join(root, 'books', 'konyv', 'resz', 'fejezet')
  const chapterFile = path.join(chapterDir, 'chapter.yaml')
  writeFileSync(chapterFile, readFileSync(chapterFile, 'utf8').replace('sections: []\n', 'sections:\n  - szakasz\n'))
  const sectionFile = path.join(chapterDir, '01-szakasz.yaml')
  writeFileSync(sectionFile, `type: section
name: szakasz
slug: szakasz
locale: hu
title: Szakasz
references:
  - { text: '[a]', target: definitions.proba-definicio }
  - { text: '[b]', target: definitions.proba-definicio }
  - { text: '[c]', target: definitions.proba-definicio }
  - { text: '[d]', target: definitions.proba-definicio }
  - { text: '[e]', target: definitions.proba-definicio }
  - { text: '[f]', target: definitions.proba-definicio }
body:
  - type: narrative
    content: Előbb [0], és $[0]_3$ nem hivatkozás.
  - type: figure
    src: abra.png
    caption: Ábra [1] felirata.
  - type: quote
    lead-in: Idézet előtt [2].
    quote: Az idézet [3].
  - type: details
    title: Részletek [4]
    blocks:
      - type: narrative
        content: Benne **[5]**.
`)
  const before = readFileSync(sectionFile, 'utf8')
  const content = loadContent(root, 'hu')
  const id = content.filePathToId.get(sectionFile)
  const section = content.idToObject.get(id)
  assert.deepEqual(heldReferences(section), doc(before).references)
  assert.match(section.body[0].content, /\$\[0\]_3\$/, 'an index inside $...$ stays as it is')
  saveFromModel(id, content)
  const after = readFileSync(sectionFile, 'utf8')
  assert.equal(referencesSection(after), referencesSection(before))
  assert.deepEqual(doc(after).body, doc(before).body)
})

test('an item the reader cannot read is kept in the list, and saving keeps it', () => {
  const root = fixture()
  const file = path.join(root, CHAPTER_REL)
  writeFileSync(file, readFileSync(file, 'utf8')
    .replace('prologue:\n', '  - { target: theorems.proba-tetel.proofs.proba-bizonyitas.claims.proof-claim }\nprologue:\n')
    .replace('[8].', '[8], [9].'))
  const before = readFileSync(file, 'utf8')
  const content = loadContent(root, 'hu')
  const chapter = chapterOf(content)
  assert.equal(heldReferences(chapter).length, 10)
  assert.equal(heldReferenceItems(chapter)[9], undefined, 'neither display nor text')
  saveFromModel(chapter.id, content)
  assert.equal(referencesSection(readFileSync(file, 'utf8')), referencesSection(before))
})

test('a file with a references dictionary refuses to save, and the file is left untouched', () => {
  const root = fixture()
  const file = path.join(root, CHAPTER_REL)
  writeFileSync(file, `type: chapter
name: fejezet
slug: fejezet
locale: hu
title: Fejezet
references:
  a-definition:
    display: "[definíció]"
    target: definitions.proba-definicio
prologue:
  - type: narrative
    content: Lásd [a-definition].
sections: []
`)
  const before = readFileSync(file, 'utf8')
  const content = loadContent(root, 'hu')
  const chapter = chapterOf(content)
  assert.equal(chapter.references.isDictionary, true)
  assert.deepEqual(heldReferences(chapter), [])
  assert.equal(chapter.prologue[0].content, 'Lásd [a-definition].', 'a token of the dictionary stays as it is')
  assert.throws(() => saveFromModel(chapter.id, content), /still has a 'references' dictionary/)
  assert.equal(readFileSync(file, 'utf8'), before, 'nothing was written')
})

// ---------------------------------------------------------------------------
// Embed targets
// ---------------------------------------------------------------------------

const embedTargets = (files) =>
  chapterDoc(files).prologue.filter((b) => b.type === 'embed').map((b) => b.target)

test('an embed target is rewritten as the same fully qualified name, saving through the panel', () => {
  // On the wire an embed target is only an ID, so the path is rebuilt by walking
  // the object graph. The owner search behind a remark has to skip the NAMESPACE,
  // which also lists every remark in its folder: picking the namespace ends the
  // walk on a segment the grammar has no name for, and the target is then written
  // back as no target at all.
  const authored = [
    'definitions.proba-definicio',
    'theorems.proba-tetel.proofs.proba-bizonyitas',
    'definitions.proba-definicio.remarks.proba-megjegyzes',
  ]
  assert.deepEqual(embedTargets(saveAll(fixture())), authored)
  assert.deepEqual(embedTargets(saveAllThroughPanel(fixture())), authored)
})

const UNRESOLVED = [
  'definitions.nincs-ilyen',
  'theorems.proba-tetel.proofs.nincs-ilyen',
  'theorems.proba-tetel.proofs.proba-bizonyitas.claims.proof-claim',
]

/** The fixture chapter with embeds the editor can't resolve, at the top level and nested in a subsection and a details block. */
function unresolvedEmbedFixture() {
  const root = fixture()
  const file = path.join(root, CHAPTER_REL)
  writeFileSync(file, `type: chapter
name: fejezet
slug: fejezet
locale: hu
title: Fejezet
prologue:
  - type: embed
    target: ${UNRESOLVED[0]}
  - type: subsection
    title: Al
    blocks:
      - type: embed
        target: ${UNRESOLVED[1]}
  - type: details
    title: Részletek
    blocks:
      - type: embed
        target: ${UNRESOLVED[2]}
sections: []
`)
  return root
}

const allEmbedTargets = (blocks) =>
  (blocks ?? []).flatMap((b) => (b.type === 'embed' ? [b.target] : allEmbedTargets(b.blocks)))

test('an embed target the editor cannot resolve is saved as authored, through the panel too', () => {
  for (const save of [saveAll, saveAllThroughPanel]) {
    const saved = chapterDoc(save(unresolvedEmbedFixture()))
    assert.deepEqual(allEmbedTargets(saved.prologue), UNRESOLVED, save.name)
  }
})

test('an unresolved embed target survives a second save through the panel', () => {
  const root = unresolvedEmbedFixture()
  const content = loadContent(root, 'hu')
  const chapter = [...content.idToObject.values()].find((o) => o.type === 'chapter')
  for (let i = 0; i < 2; i++) {
    chapter.prologue = updateModelBlocks(serializeBlocks(chapter.prologue), chapter, content.idToObject)
    saveFromModel(chapter.id, content)
  }
  assert.deepEqual(allEmbedTargets(doc(readFileSync(path.join(root, CHAPTER_REL), 'utf8')).prologue), UNRESOLVED)
})

test('an embed target picked or cleared in the panel replaces the authored one', () => {
  const root = unresolvedEmbedFixture()
  const content = loadContent(root, 'hu')
  const chapter = [...content.idToObject.values()].find((o) => o.type === 'chapter')
  const definition = [...content.idToObject.values()].find((o) => o.type === 'definition' && o.name === 'proba-definicio')
  const wire = serializeBlocks(chapter.prologue)
  Object.assign(wire[0], { targetType: 'definition', targetId: definition.id })
  Object.assign(wire[1].blocks[0], { targetType: '', targetId: '' })
  chapter.prologue = updateModelBlocks(wire, chapter, content.idToObject)
  saveFromModel(chapter.id, content)
  const saved = doc(readFileSync(path.join(root, CHAPTER_REL), 'utf8')).prologue
  assert.equal(saved[0].target, 'definitions.proba-definicio', 'a picked target is written as its own path')
  assert.equal(saved[1].blocks[0].target, undefined, 'a cleared target is removed')
  assert.equal(saved[2].blocks[0].target, UNRESOLVED[2], 'an untouched one is kept')
})

test('a file with an unmigrated embed target refuses to save, rather than dropping it', () => {
  const root = fixture()
  const file = path.join(root, CHAPTER_REL)
  writeFileSync(file, `type: chapter
name: fejezet
slug: fejezet
locale: hu
title: Fejezet
prologue:
  - type: embed
    target:
      type: definition
      namespace: /proba
      name: proba-definicio
sections: []
`)
  const content = loadContent(root, 'hu')
  assert.throws(() => saveFromModel(chapterOf(content).id, content), /cannot write back|Saving would delete/)
  assert.match(readFileSync(file, 'utf8'), /type: definition/)
})

// ---------------------------------------------------------------------------
// Entity label variants
//
// An entity names its label variant with `label`, absent for the type's default.
// The per-entity `labels` block it replaced is rejected by the site build, so a
// file that still has one must not be saved, neither dropped nor kept.
// ---------------------------------------------------------------------------

const THM_REL = path.join('knowledge-base', 'proba', 'theorems', 'proba-tetel.yaml')

test('a label variant survives a save, right after title', () => {
  const thm = doc(saveAll(fixture())[THM_REL])
  assert.equal(thm.label, 'lemma')
  const keys = Object.keys(thm)
  assert.equal(keys[keys.indexOf('title') + 1], 'label')
})

test('a label variant survives the round trip through the panel', () => {
  assert.equal(doc(saveAllThroughPanel(fixture())[THM_REL]).label, 'lemma')
})

test('choosing the default variant removes label from the file', () => {
  const root = fixture()
  const { content, id, obj } = nodeFor(root, THM_REL)
  delete obj.label
  saveFromModel(id, content)
  assert.ok(!('label' in doc(readFileSync(path.join(root, THM_REL), 'utf8'))))
})

test('a label set on a proof is written to the file', () => {
  const root = fixture()
  const rel = path.join('knowledge-base', 'proba', 'proofs', 'proba-bizonyitas.yaml')
  const { content, id, obj } = nodeFor(root, rel)
  obj.label = 'proof'
  saveFromModel(id, content)
  assert.equal(doc(readFileSync(path.join(root, rel), 'utf8')).label, 'proof')
})

test('a file with a labels block refuses to save, and the file is left untouched', () => {
  const root = fixture()
  const file = path.join(root, THM_REL)
  writeFileSync(file, readFileSync(file, 'utf8').replace('label: lemma\n',
    'labels:\n  canonical: lemma\n  cases:\n    in: { base: lemmá, suffix: ban }\n'))
  const before = readFileSync(file, 'utf8')
  const { content, id, obj } = nodeFor(root, THM_REL)
  assert.equal(obj.hasLabelsBlock, true)
  assert.equal(obj.label, undefined)
  assert.throws(() => saveFromModel(id, content), /still has a 'labels' block/)
  assert.equal(readFileSync(file, 'utf8'), before, 'nothing was written')
})
