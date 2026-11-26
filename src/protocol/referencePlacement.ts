import { atSentenceStart, decodeInlineEntities, inlineTokens } from '@youproof.org/display-templates';
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
 * site renders the text once the tokens are numbered: with its entities decoded, at
 * the top level and inside bold, where a reference inside bold starts a sentence
 * when it starts the bold.
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
  const scan = (part: string): void => {
    for (const { token, start } of inlineTokens(part)) {
      if (token.kind === 'ref' && token.index >= base && token.index - base < held.length) {
        placements[token.index - base] = { read: true, sentenceStart: atSentenceStart(part, start) };
      } else if (token.kind === 'bold' || token.kind === 'bold-italic') {
        scan(token.inner);
      }
    }
  };
  scan(decodeInlineEntities(numbered));
  return placements;
}
