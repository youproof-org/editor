// $...$ inline math — same token as SYNTAX_RE group 4 in CodeMirrorField.tsx.
// Replace each formula with an equal-length run of blanks so bracket scans never
// match inside math, while preserving character offsets (sortByOccurrence and
// rename rely on the match .index).
const FORMULA_RE = /\$[^$\n]+\$/g;

export function maskFormulas(text: string): string {
  return text.replace(FORMULA_RE, m => ' '.repeat(m.length));
}
