import { linkSegments, resolveTemplate, type TemplateContext } from '@youproof.org/display-templates';
import type { ContentBlock, LoadedContent } from './model';
import type { ReferenceTokenDisplay } from '../protocol/contentTypes';

/**
 * The number the site gives a figure, `{chapter}.{n}.`: its place among the
 * figures of the first chapter that shows it, in the order the site walks a
 * chapter (the prologue, each section, the epilogue, into subsections, details
 * and embedded entities), as `walkFigureBlocks` in the website does. Undefined
 * for a figure no chapter shows.
 */
export function figureIndex(content: LoadedContent, blockId: string): string | undefined {
  for (const book of content.books) {
    const chapters = book.parts.flatMap((part) => part.chapters);
    for (const [at, chapter] of chapters.entries()) {
      let count = 0;
      let found: string | undefined;
      const walk = (blocks: readonly ContentBlock[] | undefined): void => {
        for (const block of blocks ?? []) {
          if (found) return;
          if (block.blockType === 'figure') {
            count++;
            if (block.id === blockId) found = `${at + 1}.${count}.`;
          } else if (block.blockType === 'embed') {
            walk((content.idToObject.get(block.target.target) as { body?: ContentBlock[] } | undefined)?.body);
          } else if (block.blockType === 'subsection' || block.blockType === 'details') {
            walk(block.blocks);
          }
        }
      };
      walk(chapter.prologue);
      for (const section of chapter.sections) walk(section.body);
      walk(chapter.epilogue);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * What a figure's `[*]` shows on the site: its self-reference display, its
 * `{...}` filled in with the figure's number where a chapter shows the figure,
 * or the reason the site shows `[*]` as an error.
 */
export function resolveSelfReference(content: LoadedContent, blockId: string, display: string): ReferenceTokenDisplay {
  if (!content.idToObject.has(blockId)) return { error: 'The editor numbers this new figure once the file is saved.' };
  if (display === '') return { error: 'This figure has no self-reference display, so the site shows [*] as an error. Set one in Self-reference.' };
  const index = figureIndex(content, blockId);
  const text = index !== undefined ? resolveTemplate(display, { target: { index } } as unknown as TemplateContext).trim() : display;
  const segments = linkSegments(text, '');
  if (segments.length === 0) return { error: 'This self-reference display renders nothing.' };
  return { segments: segments.map((segment) => (segment.kind === 'link' ? { kind: 'link', text: segment.text, target: '' } : { kind: 'text', text: segment.text })) };
}
