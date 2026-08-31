/**
 * Fully qualified names — the reference-target grammar.
 *
 * MIRROR of `lib/content/fqn.ts` in the `services` repo, which is authoritative.
 * There is deliberately no shared schema package (see that repo's
 * docs/i18n-design.md §8), so this is hand-kept in sync; the content model spec is
 * `docs/content-model.md` in the content repo.
 *
 * Deliberately a SUBSET: this parses a path into steps and names the kind at each
 * one, and stops there. The table of which parents each kind may legally have lives
 * only in `services`, where the build enforces it. Duplicating it here would be two
 * copies of a rule that must agree, for the sake of an error the build already
 * gives — and the editor's job is to round-trip a target faithfully, not to
 * adjudicate the content model.
 */

export type FqnKind =
  | 'book' | 'part' | 'chapter' | 'section'
  | 'article' | 'newsletter' | 'page' | 'landing'
  | 'definition' | 'theorem' | 'proof' | 'remark'
  | 'claim' | 'term';

const CONTAINERS: Record<string, FqnKind> = {
  books: 'book',
  parts: 'part',
  chapters: 'chapter',
  sections: 'section',
  articles: 'article',
  newsletters: 'newsletter',
  pages: 'page',
  landings: 'landing',
  definitions: 'definition',
  theorems: 'theorem',
  proofs: 'proof',
  remarks: 'remark',
  claims: 'claim',
  terms: 'term',
};

const SEGMENT: Record<FqnKind, string> = Object.fromEntries(
  Object.entries(CONTAINERS).map(([segment, kind]) => [kind, segment]),
) as Record<FqnKind, string>;

export interface FqnStep {
  kind: FqnKind;
  name: string;
}

/**
 * An external target carries a URI scheme. A scheme test, not a `://` test:
 * `mailto:` targets have no slashes.
 */
export function isExternalTarget(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

/** Parse a path into steps, or return null if it is not a well-formed one. */
export function parseFqn(fqn: string): FqnStep[] | null {
  if (!fqn || isExternalTarget(fqn)) return null;
  const parts = fqn.split('.');
  if (parts.length === 0 || parts.length % 2 !== 0) return null;
  const steps: FqnStep[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const kind = CONTAINERS[parts[i]];
    if (!kind || !parts[i + 1]) return null;
    steps.push({ kind, name: parts[i + 1] });
  }
  return steps;
}

/** Build a path from steps: `[{book,b},{chapter,c}]` → `books.b.chapters.c`. */
export function buildFqn(steps: FqnStep[]): string {
  return steps.map((s) => `${SEGMENT[s.kind]}.${s.name}`).join('.');
}

/**
 * The one identifier an author can type in this editor: a claim's `name`, which is
 * empty on a newly created claim block. Every name and slug in the content model
 * must match this, because both are segments of a dotted grammar — a `.` would
 * split into two segments and a reference to the claim would stop parsing.
 */
export const IDENTIFIER_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
