import type { ContentBlock } from '../../shared/types';

type MoveResult =
  | { kind: 'no-op' }
  | { kind: 'mutated'; blocks: ContentBlock[] }
  | { kind: 'popped';  block: ContentBlock; remaining: ContentBlock[] };

function moveBlockOp(blocks: ContentBlock[], id: string, direction: 'up' | 'down'): MoveResult {
  const idx = blocks.findIndex(b => b.id === id);
  if (idx >= 0) {
    if (direction === 'up') {
      if (idx === 0) {
        return { kind: 'popped', block: blocks[0], remaining: blocks.slice(1) };
      }
      const prev = blocks[idx - 1];
      if (prev.blockType === 'subsection' || prev.blockType === 'details') {
        const merged = [...blocks];
        merged[idx - 1] = { ...prev, blocks: [...prev.blocks, blocks[idx]] };
        merged.splice(idx, 1);
        return { kind: 'mutated', blocks: merged };
      }
      const swapped = [...blocks];
      [swapped[idx - 1], swapped[idx]] = [swapped[idx], swapped[idx - 1]];
      return { kind: 'mutated', blocks: swapped };
    }
    // direction === 'down'
    if (idx === blocks.length - 1) {
      return { kind: 'popped', block: blocks[idx], remaining: blocks.slice(0, idx) };
    }
    const next = blocks[idx + 1];
    if (next.blockType === 'subsection' || next.blockType === 'details') {
      const merged = [...blocks];
      merged[idx + 1] = { ...next, blocks: [blocks[idx], ...next.blocks] };
      merged.splice(idx, 1);
      return { kind: 'mutated', blocks: merged };
    }
    const swapped = [...blocks];
    [swapped[idx], swapped[idx + 1]] = [swapped[idx + 1], swapped[idx]];
    return { kind: 'mutated', blocks: swapped };
  }

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.blockType !== 'subsection' && b.blockType !== 'details') continue;
    const child = moveBlockOp(b.blocks, id, direction);
    if (child.kind === 'no-op') continue;

    const out = [...blocks];
    if (child.kind === 'mutated') {
      out[i] = { ...b, blocks: child.blocks };
    } else {
      out[i] = { ...b, blocks: child.remaining };
      const insertAt = direction === 'up' ? i : i + 1;
      out.splice(insertAt, 0, child.block);
    }
    return { kind: 'mutated', blocks: out };
  }

  return { kind: 'no-op' };
}

export function moveBlock(blocks: ContentBlock[], id: string, direction: 'up' | 'down'): ContentBlock[] | null {
  const r = moveBlockOp(blocks, id, direction);
  return r.kind === 'mutated' ? r.blocks : null;
}

export function canMoveBlock(blocks: ContentBlock[], id: string, direction: 'up' | 'down'): boolean {
  return moveBlockOp(blocks, id, direction).kind === 'mutated';
}

export function deleteBlock(blocks: ContentBlock[], id: string): ContentBlock[] | null {
  if (blocks.some(b => b.id === id)) {
    return blocks.filter(b => b.id !== id);
  }
  let modified = false;
  const out = blocks.map(b => {
    if (b.blockType !== 'subsection' && b.blockType !== 'details') return b;
    const child = deleteBlock(b.blocks, id);
    if (child) { modified = true; return { ...b, blocks: child }; }
    return b;
  });
  return modified ? out : null;
}
