/**
 * How a reference is held in the text while it is edited. The file cites a
 * `references` item by its index, `[i]`; the editor's text instead holds the item
 * itself, encoded in the token as `[@<base64url of the item's JSON>]`. So the token
 * is the reference: deleting, moving, copying, pasting, undoing and redoing text
 * carry the item with it, a pasted copy is a reference of its own, and a save
 * numbers whatever tokens the text then holds.
 *
 * The payload is base64url so it holds none of the characters the inline grammar
 * reads (`$`, `*`, `^`, `[`, `]`), and `[@` starts no token of that grammar.
 */

export const REFERENCE_TOKEN_RE = /\[@([A-Za-z0-9_-]+)\]/g;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

/** The token that holds `item`, a `references` list item as YAML parses it. */
export function encodeReferenceToken(item: unknown): string {
  return `[@${toBase64Url(new TextEncoder().encode(JSON.stringify(item)))}]`;
}

/** The item a token's payload holds. Throws when the payload is not one `encodeReferenceToken` wrote. */
export function decodeReferencePayload(payload: string): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(payload)));
}

export interface ReferenceTokenMatch {
  from: number;
  to: number;
  /** The item, or undefined when the payload can't be decoded. */
  item: unknown;
}

/** Every reference token in `text`, in order. */
export function findReferenceTokens(text: string): ReferenceTokenMatch[] {
  const found: ReferenceTokenMatch[] = [];
  for (const match of text.matchAll(REFERENCE_TOKEN_RE)) {
    let item: unknown;
    try {
      item = decodeReferencePayload(match[1]);
    } catch {
      item = undefined;
    }
    found.push({ from: match.index!, to: match.index! + match[0].length, item });
  }
  return found;
}

/** A short name for a token until references render inline: its literal text, or its template's name. */
export function referenceTokenLabel(item: unknown): string {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const { text, display } = item as Record<string, unknown>;
    if (typeof text === 'string' && text) return text;
    if (typeof display === 'string' && display) return display;
  }
  return 'reference';
}
