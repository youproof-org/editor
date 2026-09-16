# Claim and term slug support in the editor

> **Status: implemented** (YP-173). The content backfill and the CI gate landed
> in the content repo on `fix/yp-173-claim-term-slugs`; the editor half is this
> branch. Kept as the record of what was decided and why.

## Why

The content model gives a `claim` block and a `terms` entry a localized `slug` —
the Hungarian half of the in-page anchor that addresses it
(`…/definiciok/csoport#allitasok.szorzas-asszociativ`,
`…#fogalmak.felcsoport`). See `docs/content-model.md` in the content repo.

The editor does not model that field. It only *rescues* it: `collectClaimSlugs`
in `src/handlers.ts` reads the slugs off the file before the save rewrites it and
copies them back, keyed by claim `name` / term key. Three consequences follow, and
each one is a reason to do this work:

1. **A claim or term created in the editor gets no slug at all.** Nothing on disk
   to copy from. It reaches the repo slug-less and the site build's anchor for it
   falls back to the English `name`.
2. **Renaming a claim silently drops its slug.** The carry-over is keyed by name,
   so the lookup misses. `handlers.ts:772` documents this as intended; with a real
   field it stops being a trade-off.
3. **The value is invisible.** An author cannot see, review or fix a slug without
   opening the YAML by hand.

The 150 claim and 217 term slugs already in the content repo were written by a
one-off script (`scripts/apply-kb-sub-slugs.mjs` there) from reviewed tables. That
is not a repeatable authoring path, and 14 claims and 31 terms have accumulated
without slugs since it ran.

## How the site consumes these slugs

Checked against the `services` repo, because it sets the rules this editor has to
agree with:

- **A missing slug is legal, and falls back to the English id.**
  `claimAnchorId` in `apps/website/lib/content/urls.ts:297` emits
  `{localized-container}.{slug ?? name}`, and `termAnchorId` right below it uses
  `slug ?? termKey`. A slug-less claim therefore renders a working but English
  anchor — `allitasok.subgroup-contains-identity` instead of
  `allitasok.tartalmazza-az-egysegelemet`. That is the whole bug: not a crash, a
  silently wrong-language URL. It is also why an empty slug must only warn here.
- **Shape is checked only when the slug is present.** `graph.ts:1332` calls
  `shape('slug', …)` under `if (block.slug !== undefined)`, against the same
  `IDENTIFIER_RE` this repo mirrors in `src/content/fqn.ts`.
- **Uniqueness is over the *effective* slug, per node, per kind.** The build
  registers `block.slug ?? block.name` for claims and `term.slug ?? termKey` for
  terms, in separate scopes (`claims of {id}`, `term slugs of {id}`). Two
  consequences for the editor's duplicate check: compare the **fallback-resolved**
  value rather than the authored one — a claim with slug `foo` collides with a
  slug-less claim *named* `foo`, and the build rejects that pair — and do **not**
  compare a claim against a term, which the build deliberately allows.

## Scope

In: `claim.slug` and `terms.{key}.slug` become modelled, editable fields, with
validation and an auto-derived default for terms.

Out: the **entity-level** `slug` on a definition, theorem, chapter, section, part
or book. It stays unmodelled and preserved-by-merge, exactly as `model.ts`
describes. Nothing here changes that, and the note in `model.ts` needs rewriting
rather than deleting.

Also out: a `slug` on a proof or a remark. Neither has one — each is addressed by
its position in its owner's list.

## Changes

### 1. Types

| File | Change |
|---|---|
| `src/content/model.ts` | `ClaimBlock` gains `slug: string`; `Term` gains `slug: string`. Rewrite the `slug` NOTE block: the claim/term bullet becomes "modelled and edited", the entity-level bullet stays as is. |
| `src/protocol/contentTypes.ts` | `ContentClaimBlock` gains `slug: string`; `ContentTerm` gains `slug: string`. |
| `media/src/shared/types.ts` | Re-exports the above; confirm nothing needs a manual edit. |
| `docs/extension-messaging.md` | Add `slug` to the `ContentTerm` shape at line 139 and to the claim block description. |

Empty string, not `undefined`, for "no slug" — it matches `ClaimBlock.name` and
`Term.canonical`, and keeps the React inputs controlled.

### 2. Loader — `src/content/loader.ts`

- Claim block (~line 280): read `slug: str(b, 'slug', '')`.
- `loadTerms` (~line 171): read `slug: str(obj, 'slug', '')`.

### 3. Writer — `src/handlers.ts`

- **Delete `collectClaimSlugs`** and the `claimSlugs` parameter threaded through
  `saveFromModel` → `mergeBlocks` → `blockToYaml`. The slug now arrives on the
  wire block. Delete the `origTerms` lookup in the terms writer for the same
  reason.
- `blockToYaml`, `case 'claim'`: write `r['slug']` immediately after `r['name']`,
  and only when non-empty. The position is load-bearing — the round-trip test
  pins it.
- Terms writer: `if (t['slug']) entry['slug'] = t['slug']` as the entry's first
  key, where the carried-over value used to go.
- `updateModelTerms`: copy `slug` on both the update branch and the create
  branch. Missing it here means the field never reaches the model.

### 4. Validation

Decided behaviour: **an invalid or colliding slug blocks the save; a missing slug
only warns.** A `throw` from `saveFromModel` already surfaces correctly — 
`messageServer.ts:55` turns it into a response error and `useSaveOnCtrlS.ts:47`
shows it in the panel, leaving the node dirty. The claim-`name` check at
`handlers.ts:836` is the model to copy.

Blocks the save:

- A non-empty slug that fails `IDENTIFIER_RE` (`src/content/fqn.ts:82`). A slug is
  a segment of the same dotted grammar a name is, so a `.`, a space or a capital
  makes the anchor unparseable.
- Two claims on one node with the same **effective** slug (`slug || name`), or two
  terms with the same `slug || key`. Resolving the fallback first is what makes the
  check agree with `graph.ts:1332`; comparing only authored slugs would let through
  a pair the site build rejects. Scoped **per kind**: the content model explicitly
  permits a claim and a term on the same node to share one, since they sit under
  different `allitasok.` / `fogalmak.` segments. Claims nest inside `subsection`
  and `details`, so the collection has to walk the whole body, the way
  `collectClaimSlugs` did.

Warns only, in the webview:

- An empty slug — an amber field plus a count in the panel. Saving proceeds and
  the writer omits the key, so a half-written node is still saveable and the site
  build stays the hard gate.
- A term slug that differs from what `canonical` would derive. Informational; a
  deliberate override is normal (`complement-in-a` → `relativ-komplementer-halmaz`
  in the existing content).

### 5. UI

**Claim block** — `media/src/editor/blocks/ClaimBlock.tsx`. A `Slug` field between
`Name` and `Content`, a plain `field-input` like `Name`. Invalid input gets the
error styling; empty gets the warning styling.

**Terms panel** — `media/src/editor/TermsPanel.tsx`. A `Slug` column after `Name`.
The component hardcodes three resizable columns (`colWidths` is length 3 and the
resize state is typed `col: 0 | 1 | 2`); widen both to four and shift the
`nth-child` rules in `media/editor.css:401`. Reuse `ref-input--dup` for a
collision; add `ref-input--warn` for an empty value.

### 6. Auto-derived defaults

**Terms — derive from `canonical`.** A new `slugify()` in `media/src/shared/`:
lowercase, fold Hungarian accents (`á é í ó ö ő ú ü ű` → `a e i o o o u u u`),
strip `$…$` math to its bare letters, collapse everything else to single hyphens.
This reproduces how the existing 217 term slugs were generated. It fills the field
while the author has not touched it, and stops the moment they type — track an
"edited" flag per term id in component state, so re-editing `canonical` afterwards
never overwrites a deliberate slug.

It will not reproduce every existing value: `Euler-féle $\varphi$-függvény` →
`euler-fele-fi-fuggveny` needed a human to read `\varphi` as *fi*. That is fine —
the derived value is a suggestion in an editable field, not a computed one.

**Claims — the editor derives nothing. Decided.** A claim slug is the Hungarian
translation of the English `name` (`subring-contains-zero` →
`tartalmazza-a-nullelemet`), which the extension cannot produce: it runs offline
with no model access. Deriving it mechanically would mean kebab-casing the English
name into a Hungarian anchor, which is the very bug this work exists to fix.

So the translation happens **once**, offline, as the content backfill below — and
from then on the field is authored by hand, by the person who just wrote the
claim. One short phrase per claim. The field warns while empty so a forgotten one
is visible.

To keep the manual path cheap, show the claim's `name` beside the slug field as a
hint, and surface the sibling claims' slugs so the author can match the house
style (`zart-az-osszeadasra`, `tartalmazza-a-nullelemet`, …).

The split is deliberate and worth stating plainly, since the two fields behave
differently: **a term's slug auto-fills from `canonical`** (a real mechanical
transform), **a claim's never auto-fills** (it would need translation).

### 7. Tests — `test/save-roundtrip.test.mjs`

The fixture already carries entity, claim and term slugs, and the existing
assertions still hold — they now pass because the field is modelled rather than
carried, which is worth saying in the header comment. Add:

- Editing a claim's slug in the model writes the new value.
- **Renaming a claim keeps its slug.** This is the behaviour change; today the
  name-keyed carry-over drops it.
- A claim or term with an empty slug writes no `slug` key at all.
- An invalid slug throws, and the message names the field.
- Two claims on one node with the same slug throw; a claim and a term sharing one
  do **not**.
- A claim with slug `foo` and a slug-less claim *named* `foo` throw — the
  fallback-resolved collision the site build catches.

### 8. Release

`npm run test` (it runs `tsc` first), then `npm run build`, bump `package.json` to
`1.2.0`, and rebuild the `.vsix` via `npm run release`. The content repo installs
it with `npm run editor:install`. Node 24.18.0 — `nvm use` first.

## The content side, and the sequencing

Two of the three pieces live in the content repo, and both are already built or
drafted there. The editor change goes last.

**1. Backfill the 45 missing slugs.** 14 claims and 31 terms, proposed in
`docs/plans/generated-kb-missing-slugs.md` and applied by a
`scripts/apply-missing-kb-sub-slugs.mjs` that reads the reviewed table, the way
`apply-kb-sub-slugs.mjs` did for the first 367. This is the one-time
translation — after it, every claim and term in the knowledge base has a
Hungarian slug and nothing needs translating at authoring time again.

**2. The CI gate: `scripts/check-slugs.mjs` + `.github/workflows/slug-check.yml`.**
Blocking, on every pull request and every push to one. It fails on a missing slug,
a malformed slug, a slug on a type that must not have one (proof, remark,
namespace), and an effective-slug collision — the same rules `graph.ts` enforces,
just hours earlier and with a GitHub annotation on the offending line. It is
dependency-free so CI needs no install step, and strict by construction: a
construct it cannot parse is reported, never skipped.

It must land **with or after** the backfill — it reports exactly those 45 failures
against the tree as it stands today, so merging it first would redden every open
PR.

**3. Then ship the editor change.** In this order, the first time an author opens
a node with the new build, the slug fields are already populated, and the
empty-field warning fires only on genuinely new content — which is what it is for.

The gate and the editor cover different halves of the same problem and neither
replaces the other: the editor stops a slug from going missing while a human is
looking at the node, and CI catches everything that reaches a branch some other
way — a hand-edited YAML, a script, a merge.
