import { collectBlockText } from '../shared/blockText';
import { maskFormulas } from '../shared/formula';
import type { ContentBlock, ContentObjectData } from '../shared/types';

export function getAllBlocksText(d: ContentObjectData): string {
  if (d.type === 'chapter') {
    return collectBlockText([...d.abstract, ...d.prerequisiteWarning, ...d.prologue, ...d.epilogue]);
  }
  if ('body' in d) {
    return collectBlockText((d as { body: ContentBlock[] }).body);
  }
  return '';
}

export function countSegments(text: string, name: string, type: 'ref' | 'term'): number {
  const re = type === 'ref'
    ? new RegExp(`(?<!\\[)\\[${name}\\](?!\\])`, 'g')
    : new RegExp(`\\[\\[${name}\\]\\]`, 'g');
  return (maskFormulas(text).match(re) ?? []).length;
}

export function sortByOccurrence<T extends { name: string }>(
  items: T[], text: string, type: 'ref' | 'term',
): T[] {
  const masked = maskFormulas(text);
  const pos = (name: string): number => {
    const re = type === 'ref'
      ? new RegExp(`(?<!\\[)\\[${name}\\](?!\\])`)
      : new RegExp(`\\[\\[${name}\\]\\]`);
    const m = re.exec(masked);
    return m !== null ? m.index : Infinity;
  };
  return [...items].sort((a, b) => pos(a.name) - pos(b.name));
}
