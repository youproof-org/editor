/**
 * The `references` section of a content file's YAML source: the `references:` line
 * and every line under it, up to the next top-level key. Null when the file has no
 * `references` key. Trailing blank lines belong to no key and are left out.
 */
export function referencesSection(source: string): string | null {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => /^references\s*:/.test(line));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^[^\s#-]/.test(lines[end])) end++;
  while (end > start + 1 && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end).join('\n') + '\n';
}
