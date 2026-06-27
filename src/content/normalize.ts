export function normalizeStrings(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\n+/g, ' ').trim();
  if (Array.isArray(value)) return value.map(normalizeStrings);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const blockType = obj['type'];
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const preserveNewlines =
        (blockType === 'formula' && k === 'content') ||
        (blockType === 'claim'   && k === 'formula');
      if (preserveNewlines && typeof v === 'string') {
        // trim leading/trailing whitespace (incl. newlines); keep internal newlines verbatim
        result[k] = v.trim();
      } else {
        result[k] = normalizeStrings(v);
      }
    }
    return result;
  }
  return value;
}
