import { decodeInlineEntities, renderedReferences } from '@youproof.org/display-templates';
import { findReferenceTokens } from './referenceToken';

/** Where the site puts a reference token of a text when it renders the text. */
export interface ReferencePlacement {
  /** Whether the site reads the token as a reference; one inside `$...$` or `^...^` it doesn't. */
  read: boolean;
  /** Whether the site capitalizes the reference, as the start of a sentence. */
  sentenceStart: boolean;
}

/**
 * One placement per reference token of `text`, in order, worked out the way the
 * site renders the text once the tokens are numbered, by the site's own
 * `renderedReferences`: with its entities decoded, at the top level and inside bold.
 */
export function referencePlacements(text: string): ReferencePlacement[] {
  const held = findReferenceTokens(text);
  const placements: ReferencePlacement[] = held.map(() => ({ read: false, sentenceStart: false }));
  if (held.length === 0) return placements;
  const base = 10 ** 9;
  let numbered = '';
  let last = 0;
  held.forEach((token, i) => {
    numbered += `${text.slice(last, token.from)}[${base + i}]`;
    last = token.to;
  });
  numbered += text.slice(last);
  for (const { token, sentenceStart } of renderedReferences(decodeInlineEntities(numbered))) {
    if (token.kind === 'ref' && token.index >= base && token.index - base < held.length) {
      placements[token.index - base] = { read: true, sentenceStart };
    }
  }
  return placements;
}

/** A figure's `[*]` where the site reads it in a text. */
export interface SelfReferencePlacement {
  from: number;
  to: number;
  /** Whether the site capitalizes it, as the start of a sentence. */
  sentenceStart: boolean;
}

/**
 * Every `[*]` of `text` the site reads as a self-reference, in order: at the top
 * level and inside bold, not inside `$...$` or `^...^`. Decoding the entities
 * changes no token, only offsets and sentence starts, so the two walks find the
 * same tokens in the same order.
 */
export function selfReferencePlacements(text: string): SelfReferencePlacement[] {
  const self = <T extends { token: { kind: string } }>(found: Iterable<T>) => [...found].filter(({ token }) => token.kind === 'self-ref');
  const decoded = self(renderedReferences(decodeInlineEntities(text)));
  return self(renderedReferences(text)).map(({ start, source }, i) => ({ from: start, to: start + source.length, sentenceStart: decoded[i].sentenceStart }));
}
