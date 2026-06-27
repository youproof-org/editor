interface BlockTextShape {
  blockType: string;
  content?: string;
  leadIn?: string;
  leadOut?: string;
  items?: string[];
  blocks?: BlockTextShape[];
}

export function collectBlockText(blocks: readonly BlockTextShape[]): string {
  const parts: string[] = [];
  function add(b: BlockTextShape) {
    switch (b.blockType) {
      case 'narrative':                if (b.content) parts.push(b.content); break;
      case 'formula':
        if (b.leadIn)  parts.push(b.leadIn);
        if (b.leadOut) parts.push(b.leadOut);
        break;
      case 'claim':                    if (b.content) parts.push(b.content); break;
      case 'ordered-list':
      case 'unordered-list':
        if (b.leadIn) parts.push(b.leadIn);
        if (b.items)  parts.push(...b.items);
        break;
      case 'typewriter':               if (b.leadIn) parts.push(b.leadIn); break;
      case 'quote':                    if (b.leadIn) parts.push(b.leadIn); break;
      case 'figure':                   if (b.leadIn) parts.push(b.leadIn); break;
      case 'subsection':
      case 'details':                  if (b.blocks) b.blocks.forEach(add); break;
    }
  }
  blocks.forEach(add);
  return parts.join('\n');
}
