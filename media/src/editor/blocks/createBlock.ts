import type { ContentBlock } from '../../shared/types';

export type CreatableBlockType =
  | 'narrative' | 'formula' | 'claim'
  | 'ordered-list' | 'unordered-list' | 'typewriter' | 'quote'
  | 'figure' | 'subsection' | 'details' | 'embed';

export const CREATABLE_BLOCK_TYPES: { type: CreatableBlockType; label: string }[] = [
  { type: 'narrative',       label: 'Narrative' },
  { type: 'formula',         label: 'Formula' },
  { type: 'claim',           label: 'Claim' },
  { type: 'ordered-list',    label: 'Ordered list' },
  { type: 'unordered-list',  label: 'Unordered list' },
  { type: 'typewriter',      label: 'Typewriter' },
  { type: 'quote',           label: 'Quote' },
  { type: 'figure',          label: 'Figure' },
  { type: 'subsection',      label: 'Subsection' },
  { type: 'details',         label: 'Details' },
  { type: 'embed',           label: 'Embed' },
];

export function createEmptyBlock(type: CreatableBlockType): ContentBlock {
  const id = crypto.randomUUID();
  switch (type) {
    case 'narrative':       return { id, blockType: 'narrative',       content: '' };
    case 'formula':         return { id, blockType: 'formula',         content: '' };
    case 'claim':           return { id, blockType: 'claim',           name: '',    content: '' };
    case 'ordered-list':    return { id, blockType: 'ordered-list',    items: [''] };
    case 'unordered-list':  return { id, blockType: 'unordered-list',  items: [''] };
    case 'typewriter':      return { id, blockType: 'typewriter',      rows:  [''] };
    case 'quote':           return { id, blockType: 'quote',           quote: '' };
    case 'figure':          return { id, blockType: 'figure',          src:   '' };
    case 'subsection':      return { id, blockType: 'subsection',      title: '', blocks: [] };
    case 'details':         return { id, blockType: 'details',                    blocks: [] };
    case 'embed':           return { id, blockType: 'embed',           targetType: '', targetId: '' };
  }
}
