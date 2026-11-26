import yaml from 'js-yaml';
import { isDeepStrictEqual } from 'util';
import {
  fileReferenceTexts, inlineTokens, readReferences, REFERENCE_TEXT_FIELDS, referenceTokens,
  type ReferenceFileKind, type ReferenceItem,
} from '@youproof.org/display-templates';
import {
  encodeReferenceToken, findReferenceTokens, REFERENCE_TOKEN_RE, referenceTokenLabel, type ReferenceTokenMatch,
} from '../protocol/referenceToken';

/**
 * The `references` section of a content file's YAML source: the `references:` line
 * and every line under it, up to the next top-level key. Null when the file has no
 * `references` key. Trailing blank lines belong to no key and are left out.
 */
export function referencesSection(source: string): string | null {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => /^references\s*:/.test(line));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^[^\s#-]/.test(lines[end])) end++;
  while (end > start + 1 && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end).join('\n') + '\n';
}

export function referenceFileKind(type: string): ReferenceFileKind {
  return type === 'chapter' || type === 'section' ? type : 'entity';
}

type Holder = Record<string | number, unknown>;

export interface ReferenceTextSlot {
  get(): string;
  set(text: string): void;
}

/**
 * The text fields of a parsed content file that hold reference tokens, in the order
 * the site renders them, as places that can be read and rewritten. Which fields they
 * are and their order come from the site's own `fileReferenceTexts`: every string
 * under the file's text fields is tagged with its place, the reader is run, and the
 * tags on what it returns name the places. A block's `type` is left untagged, since
 * the reader switches on it.
 */
export function referenceTextSlots(file: Holder, kind: ReferenceFileKind): ReferenceTextSlot[] {
  const places: { holder: Holder; key: string | number; text: string }[] = [];
  const tag = (holder: Holder, key: string | number): void => {
    const value = holder[key];
    if (typeof value === 'string') {
      if (key === 'type') return;
      places.push({ holder, key, text: value });
      holder[key] = `${value}\u0000${places.length - 1}`;
    } else if (Array.isArray(value)) {
      value.forEach((_, i) => tag(value as unknown as Holder, i));
    } else if (value !== null && typeof value === 'object') {
      for (const k of Object.keys(value)) tag(value as Holder, k);
    }
  };
  const untagged = fileReferenceTexts(file, kind);
  for (const field of REFERENCE_TEXT_FIELDS[kind]) tag(file, field);
  let tagged: string[];
  try {
    tagged = fileReferenceTexts(file, kind);
  } finally {
    for (const { holder, key, text } of places) holder[key] = text;
  }
  const slots = tagged.map((text) => places[Number(text.slice(text.lastIndexOf('\u0000') + 1))]);
  if (slots.length !== untagged.length || slots.some((place, i) => place?.text !== untagged[i])) {
    throw new Error('The editor could not tell which text fields hold references, so nothing was changed.');
  }
  return slots.map((place) => ({
    get: () => place.holder[place.key] as string,
    set: (text) => { place.holder[place.key] = text; },
  }));
}

interface IndexMatch { from: number; to: number; index: number; }

/** The `[i]` tokens the site reads in `text`, with where each sits: the top level and inside bold, as `referenceTokens` reads them. */
export function referenceIndexMatches(text: string): IndexMatch[] {
  const found: IndexMatch[] = [];
  const scan = (part: string, offset: number): void => {
    for (const { token, start, source } of inlineTokens(part)) {
      if (token.kind === 'ref') found.push({ from: offset + start, to: offset + start + source.length, index: token.index });
      else if (token.kind === 'bold' || token.kind === 'bold-italic') {
        scan(token.inner, offset + start + (source.length - token.inner.length) / 2);
      }
    }
  };
  scan(text, 0);
  const expected = [...referenceTokens(text)].flatMap((token) => (token.kind === 'ref' ? [token.index] : []));
  if (!isDeepStrictEqual(found.map((match) => match.index), expected)) {
    throw new Error('The editor read the reference tokens of a text differently from the site, so nothing was changed.');
  }
  return found;
}

/**
 * Put each item of a loaded `references` list into the tokens that cite it, so the
 * text holds the references and not their indexes. A token whose index has no item
 * is left as it is, for the save to refuse.
 */
export function holdReferences(file: Holder, kind: ReferenceFileKind, items: readonly unknown[]): void {
  for (const slot of referenceTextSlots(file, kind)) {
    const text = slot.get();
    let held = '';
    let last = 0;
    for (const match of referenceIndexMatches(text)) {
      if (match.index >= items.length) continue;
      held += text.slice(last, match.from) + encodeReferenceToken(items[match.index]);
      last = match.to;
    }
    if (last > 0) slot.set(held + text.slice(last));
  }
}

/** A reason the references in the text can't be written as a list. */
export class ReferenceTokenError extends Error {}

/** `text` as an error message quotes it, with each reference shown by its label. */
function quoted(text: string): string {
  return JSON.stringify(text.replace(new RegExp(REFERENCE_TOKEN_RE.source, 'g'), (token) =>
    `[${referenceTokenLabel(findReferenceTokens(token)[0]?.item)}]`));
}

interface TextReading {
  /** The held tokens and the `[i]` typed as text that the site reads as references, in reading order. */
  read: (ReferenceTokenMatch | { index: number })[];
  /** Held tokens the site would not read as references, inside `$...$` for example. */
  unread: number;
}

function readHeldTokens(text: string): TextReading {
  const held = findReferenceTokens(text);
  let placed = '';
  let last = 0;
  const heldAt = new Map<number, ReferenceTokenMatch>();
  for (const token of held) {
    placed += text.slice(last, token.from);
    heldAt.set(placed.length, token);
    placed += '[0]';
    last = token.to;
  }
  placed += text.slice(last);
  const read = referenceIndexMatches(placed).map((match) => {
    const token = heldAt.get(match.from);
    if (!token) return { index: match.index };
    heldAt.delete(match.from);
    return token;
  });
  return { read, unread: heldAt.size };
}

function forEachString(value: unknown, visit: (text: string) => void): void {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) value.forEach((v) => forEachString(v, visit));
  else if (value !== null && typeof value === 'object') Object.values(value).forEach((v) => forEachString(v, visit));
}

/**
 * Turn the references the text holds into the `references` list, in the order the
 * site reads the text, and rewrite each token as its item's index. Each token is its
 * own item, so a pasted copy becomes a second item. Throws before rewriting anything
 * when a token can't be written as an index the site reads the same way.
 */
export function numberReferences(file: Holder, kind: ReferenceFileKind): unknown[] {
  const items: unknown[] = [];
  const rewrites: { slot: ReferenceTextSlot; text: string; original: string }[] = [];
  for (const slot of referenceTextSlots(file, kind)) {
    const text = slot.get();
    const { read, unread } = readHeldTokens(text);
    if (unread > 0) {
      throw new ReferenceTokenError(
        `A reference sits where the site doesn't read it as one, inside $...$ or ^...^: ${quoted(text)}. Move it out, then save again.`,
      );
    }
    let numbered = '';
    let last = 0;
    for (const token of read) {
      if ('index' in token) {
        throw new ReferenceTokenError(
          `The text has [${token.index}], an index written as text, which the site would read as a reference: ${quoted(text)}. ` +
            'Delete it, then save again.',
        );
      }
      if (token.item === undefined) throw new ReferenceTokenError(`A reference in the text is damaged and can't be read: ${quoted(text)}.`);
      numbered += `${text.slice(last, token.from)}[${items.length}]`;
      items.push(token.item);
      last = token.to;
    }
    if (read.length > 0) rewrites.push({ slot, text: numbered + text.slice(last), original: text });
  }
  for (const { slot, text } of rewrites) slot.set(text);
  try {
    forEachString(file, (text) => {
      if (new RegExp(REFERENCE_TOKEN_RE.source).test(text)) {
        throw new ReferenceTokenError(
          `A reference sits in a field the site doesn't read references from: ${quoted(text)}. Move it to the text, then save again.`,
        );
      }
    });
  } catch (err) {
    for (const { slot, original } of rewrites) slot.set(original);
    throw err;
  }
  return items;
}

// ─── Writing the list ───────────────────────────────────────────────────────────

// The style the content's lists are written in: one flow mapping per line, each
// value plain when YAML reads it back the same and quoted otherwise, as
// scripts/migrate-display-templates.mjs in the content repo writes them.
const PLAIN_SAFE = /^[\p{L}][\p{L}\p{N} .-]*[\p{L}\p{N}.]$|^[\p{L}]$/u;

function flowScalar(value: string): string {
  const candidates: string[] = [];
  if (PLAIN_SAFE.test(value)) candidates.push(value);
  if (!/[\n\r\t]/.test(value)) candidates.push(`'${value.replace(/'/g, "''")}'`);
  for (const candidate of candidates) {
    try {
      if ((yaml.load(`- { v: ${candidate} }`) as { v: unknown }[])?.[0]?.v === value) return candidate;
    } catch {
      continue;
    }
  }
  return JSON.stringify(value);
}

function flowValue(value: unknown): string {
  if (typeof value === 'string') return flowScalar(value);
  if (Array.isArray(value)) return `[${value.map(flowValue).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length === 0 ? '{}' : `{ ${entries.map(([k, v]) => `${flowScalar(k)}: ${flowValue(v)}`).join(', ')} }`;
  }
  return yaml.dump(value, { flowLevel: 0, lineWidth: -1 }).trimEnd();
}

/** The `references` section for `items`, one flow-style item per line. Throws if it wouldn't read back as `items`. */
export function referencesSectionFor(items: readonly unknown[]): string {
  const section = `references:\n${items.map((item) => `  - ${flowValue(item)}\n`).join('')}`;
  const readBack = (yaml.load(section) as { references: unknown[] | null }).references ?? [];
  if (!isDeepStrictEqual(readBack, items)) {
    throw new ReferenceTokenError('The references list could not be written so that it reads back the same, so nothing was saved.');
  }
  return section;
}

// ─── Reading the model ──────────────────────────────────────────────────────────

const MODEL_FIELDS: Record<string, string> = {
  abstract: 'abstract', 'prerequisite-warning': 'prerequisiteWarning', prologue: 'prologue', epilogue: 'epilogue', body: 'body',
};

function asYamlBlocks(blocks: unknown): unknown[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.map((block) => {
    const b = block as Record<string, unknown>;
    return {
      type: b['blockType'], content: b['content'], 'lead-in': b['leadIn'], 'lead-out': b['leadOut'],
      caption: b['caption'], items: b['items'], quote: b['quote'], title: b['title'],
      blocks: asYamlBlocks(b['blocks']),
    };
  });
}

/**
 * The references a content object's text holds now, in the order the site reads
 * them, each as its list item: the list a save would write. Tokens a save would
 * refuse are left out.
 */
export function heldReferences(obj: Record<string, unknown>): unknown[] {
  const kind = referenceFileKind(String(obj['type']));
  const file = Object.fromEntries(REFERENCE_TEXT_FIELDS[kind].map((field) => [field, asYamlBlocks(obj[MODEL_FIELDS[field]])]));
  return fileReferenceTexts(file, kind).flatMap((text) =>
    readHeldTokens(text).read.flatMap((token) => ('item' in token && token.item !== undefined ? [token.item] : [])));
}

/** The references a content object's text holds now, read as the site reads list items; undefined for one it can't read. */
export function heldReferenceItems(obj: Record<string, unknown>): (ReferenceItem | undefined)[] {
  return readReferences(heldReferences(obj), { locale: String(obj['locale'] ?? ''), templates: {}, texts: [] }).references;
}

// ─── Reporting ──────────────────────────────────────────────────────────────────

const SHOWN_PROBLEMS = 5;

const listed = (problems: readonly string[]): string => {
  const more = problems.length > SHOWN_PROBLEMS ? ` (and ${problems.length - SHOWN_PROBLEMS} more)` : '';
  return problems.slice(0, SHOWN_PROBLEMS).join('; ') + more;
};

/** The problems the site build's reader finds in the references of the loaded files, each naming its file. */
export function describeLoadedReferenceProblems(files: readonly { filePath: string; problems: readonly string[] }[]): string | undefined {
  const problems = files.flatMap(({ filePath, problems }) => problems.map((problem) => `${filePath}: ${problem}`));
  if (problems.length === 0) return undefined;
  return `The site build would reject the references of ${files.filter((f) => f.problems.length > 0).length === 1 ? 'a file' : 'some files'}: ` +
    `${listed(problems)}. Saving such a file here writes the list from the text, so an item the text doesn't cite is dropped.`;
}

export function describeSavedReferenceProblems(file: string, problems: readonly string[]): string | undefined {
  if (problems.length === 0) return undefined;
  return `${file} was saved, but the site build would reject its references: ${listed(problems)}.`;
}
