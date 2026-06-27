// Strip combining diacritics for accent-insensitive search.
// "szám" → "szam", "egész" → "egesz". For Latin scripts (incl. Hungarian)
// each accented character decomposes to base + combining mark via NFD;
// stripping the marks restores the bare base with the same JS string length,
// so indexOf results in folded space map unchanged into the original.
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
