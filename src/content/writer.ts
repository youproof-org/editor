import * as yaml from 'js-yaml';
import { isDeepStrictEqual } from 'util';
import { normalizeStrings } from './normalize';
import { referencesSection } from './references';

/**
 * How a save writes a content file: the keys in their type's order, the strings
 * normalized, the YAML dumped at 120 columns, and the `references` section put in as
 * given. Shared by saveFromModel and rewrapContentFile, so a file rewrapped from the
 * content repo is folded exactly as a save folds it.
 */
export function contentFileText(yamlDoc: Record<string, unknown>, type: string, referencesSource: string | null): string {
  const doc = { ...yamlDoc };
  if (referencesSource) doc['references'] = REFERENCES_PLACEHOLDER;
  else delete doc['references'];
  const dumped = yaml.dump(
    normalizeStrings(reorderYamlKeys(doc, type)) as Record<string, unknown>,
    { lineWidth: 120, noCompatMode: true },
  );
  return referencesSource ? withReferencesSection(dumped, referencesSource) : dumped;
}

/** The types whose files the editor saves. */
export const SAVED_TYPES = ['chapter', 'section', 'definition', 'theorem', 'proof', 'remark'];

/**
 * The text a save writes for this file when its data is unchanged, as an edit
 * elsewhere in the file would write it, or null for a file of a type the editor
 * doesn't save. Throws when that text wouldn't read back as the file's data.
 */
export function rewrapContentFile(source: string): string | null {
  const doc = yaml.load(source, { schema: yaml.CORE_SCHEMA }) as Record<string, unknown> | null;
  if (!doc || typeof doc !== 'object' || !SAVED_TYPES.includes(doc['type'] as string)) return null;
  const text = contentFileText(doc, doc['type'] as string, referencesSection(source));
  if (!isDeepStrictEqual(yaml.load(text, { schema: yaml.CORE_SCHEMA }), doc)) {
    throw new Error('A save would change its data, so it is not rewrapped.');
  }
  return text;
}

// js-yaml would rewrite the list's one-item-per-line flow style, so the section is
// put in after the dump, in place of a placeholder that keeps the key's position.
const REFERENCES_PLACEHOLDER = 'yp-editor-references';

function withReferencesSection(dumped: string, section: string): string {
  const lines = dumped.split('\n');
  const placeholder = `references: ${REFERENCES_PLACEHOLDER}`;
  const at = lines.indexOf(placeholder);
  if (at === -1 || lines.indexOf(placeholder, at + 1) !== -1) {
    throw new Error('The references list could not be put in its place in the file, so nothing was saved.');
  }
  lines.splice(at, 1, section.replace(/\n$/, ''));
  return lines.join('\n');
}

// Key order per type — keeps saved YAML stable instead of appending keys. The
// localization fields (`slug`, `locale`), the chapter migration/listing fields
// (`excerpt`, `published-at`, `legacy-path`) and the crawler-metadata block
// (`meta`) are included so they stay in place on save (read from / written back
// verbatim, not modelled). `slug` follows `name` and `locale` follows `slug`, on
// every type that carries one — a proof and a remark carry none, since each is
// addressed by its position in the list of the node that owns it rather than by
// an identifier of its own. Keys not listed are still preserved —
// appended after these — but list everything the content emits so nothing moves.
// Types with NO entry here (book, article, newsletter, page, landing) are left
// untouched by reorderYamlKeys, so their `meta`/`excerpt` keep their authored
// position; add an entry when the editor gains a UI for those types.
const CANONICAL_ORDER: Record<string, string[]> = {
  definition: ['type', 'name', 'slug', 'locale', 'title', 'label', 'remarks', 'terms', 'references', 'body'],
  theorem:    ['type', 'name', 'slug', 'locale', 'title', 'label', 'proofs', 'remarks', 'terms', 'references', 'body'],
  proof:      ['type', 'name', 'locale', 'title', 'label', 'remarks', 'terms', 'references', 'body'],
  remark:     ['type', 'name', 'locale', 'title', 'label', 'terms', 'references', 'body'],
  section:    ['type', 'name', 'slug', 'locale', 'title', 'references', 'body'],
  part:       ['type', 'name', 'slug', 'locale', 'title', 'chapters'],
  chapter:    ['type', 'name', 'slug', 'locale', 'title', 'excerpt', 'published-at', 'legacy-path',
               'meta', 'thumbnail', 'references',
               'abstract', 'prerequisite-warning', 'prologue', 'sections', 'epilogue'],
};

function reorderYamlKeys(yamlDoc: Record<string, unknown>, type: string): Record<string, unknown> {
  const order = CANONICAL_ORDER[type];
  if (!order) return yamlDoc;
  const result: Record<string, unknown> = {};
  for (const key of order) {
    if (key in yamlDoc) result[key] = yamlDoc[key];
  }
  for (const key of Object.keys(yamlDoc)) {
    if (!(key in result)) result[key] = yamlDoc[key];
  }
  return result;
}
