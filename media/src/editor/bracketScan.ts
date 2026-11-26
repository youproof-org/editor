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

export function countTermSegments(text: string, name: string): number {
  return (maskFormulas(text).match(new RegExp(`\\[\\[${name}\\]\\]`, 'g')) ?? []).length;
}

export function sortByOccurrence<T extends { name: string }>(items: T[], text: string): T[] {
  const masked = maskFormulas(text);
  const pos = (name: string): number => {
    const m = new RegExp(`\\[\\[${name}\\]\\]`).exec(masked);
    return m !== null ? m.index : Infinity;
  };
  return [...items].sort((a, b) => pos(a.name) - pos(b.name));
}
