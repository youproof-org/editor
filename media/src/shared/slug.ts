/**
 * Slug helpers for the two slugs the editor owns: a `claim` block's and a `terms`
 * entry's. Both are the localized half of an in-page anchor, so both are Hungarian
 * while their `name` / map key stays English.
 */

/**
 * Mirrors IDENTIFIER_RE in `src/content/fqn.ts` (and the services repo's
 * `lib/content/fqn.ts`, which is authoritative). Duplicated rather than imported
 * because the webview bundle must not reach into the extension host's sources.
 */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

const ACCENTS: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ö: 'o', ő: 'o', ú: 'u', ü: 'u', ű: 'u',
};

/**
 * A term's slug, derived from its `canonical` — the author-written Hungarian base
 * form, which makes it the least surprising source. This reproduces how the 217
 * term slugs already in the content repo were generated: lowercase, fold the
 * Hungarian accents, drop `$…$` math to its bare letters and digits, and collapse
 * everything else to single hyphens.
 *
 * It is a SUGGESTION, not a computed value. Run against the content repo it
 * reproduces 242 of the 248 term slugs there; the other six were editorial calls
 * no rule reaches — four shortenings (`euklidészi függvény monotonitási
 * tulajdonsága` → `monotonitasi-tulajdonsag`) and two readings only a human makes
 * (`$\varphi$` → `fi`). So it fills an untouched field and then gets out of the
 * way — see TermsPanel.
 *
 * A claim's slug has NO equivalent here on purpose. It is the Hungarian
 * translation of an English `name` (`subring-contains-zero` →
 * `tartalmazza-a-nullelemet`), which no mechanical rule produces; the existing
 * ones were translated once, offline (content repo, YP-173), and new ones are
 * typed by the author who just wrote the claim.
 */
export function deriveSlugFromCanonical(canonical: string): string {
  return canonical
    .toLowerCase()
    // `$…$` is inline KaTeX. Keep the letters and digits inside it — `modulo $m$
    // maradékosztály` is `modulo-m-maradekosztaly` in the content today — and drop
    // the delimiters and any backslash commands with them.
    .replace(/\$([^$]*)\$/g, (_, math: string) => ` ${math.replace(/\\[a-z]+/gi, ' ')} `)
    .replace(/[áéíóöőúüű]/g, (c) => ACCENTS[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
