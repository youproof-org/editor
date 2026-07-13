// Locale config for the editor.
//
// MIRROR of the website's single source of truth
// (youproof-org/services: apps/website/lib/i18n/locales.json + config.ts). The
// editor is a separate repo with no dependency on services, so this list is a
// hand-maintained copy — keep it in sync when locales change there.
//
// The editor loads and edits exactly ONE locale's content at a time (see
// loader.ts's locale filter and the per-locale reload buttons); DEFAULT_LOCALE
// is loaded on startup.
export const LOCALES: string[] = ['hu'];
export const DEFAULT_LOCALE = 'hu';

export function isLocale(value: string): boolean {
  return LOCALES.includes(value);
}
