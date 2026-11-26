import { refTargetKey } from '@youproof.org/content-model';
import { readReferences, type ReferenceDisplay } from '@youproof.org/display-templates';
import { decodeReferencePayload } from '../protocol/referenceToken';
import type { ReferenceTokenDisplay } from '../protocol/contentTypes';
import { resolveEditorReference, type ReferenceResolution } from './numbering';

function wireDisplay(display: ReferenceDisplay): ReferenceTokenDisplay {
  if (display.error !== undefined) return { error: display.error };
  return {
    segments: display.segments.map((segment) => (segment.kind === 'link'
      ? { kind: 'link', text: segment.text, target: refTargetKey(segment.target) }
      : { kind: 'text', text: segment.text })),
  };
}

/**
 * One held reference rendered as the site renders it in a file of `locale`, or the
 * reason it can't be: whatever the site build's reader rejects in the item, then
 * whatever resolving it through the templates and the editor's numbering finds.
 */
export function resolveReferenceToken(payload: string, locale: string, resolution: ReferenceResolution): ReferenceTokenDisplay {
  let raw: unknown;
  try {
    raw = decodeReferencePayload(payload);
  } catch {
    return { error: 'This reference is damaged and can\'t be read.' };
  }
  const { references: [item], errors } = readReferences([raw], {
    locale, templates: { [locale]: resolution.templates ?? {} }, texts: ['[0]'],
  });
  if (errors.length > 0 || !item) {
    return { error: errors.map((error) => error.replace(/^reference \[0\]: /, '')).join('; ') };
  }
  return wireDisplay(resolveEditorReference(item, locale, resolution));
}

export function resolveReferenceTokens(
  payloads: readonly string[], locale: string, resolution: ReferenceResolution,
): Record<string, ReferenceTokenDisplay> {
  return Object.fromEntries(payloads.map((payload) => [payload, resolveReferenceToken(payload, locale, resolution)]));
}
