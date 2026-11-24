// The editor loads and edits exactly ONE locale's content at a time (see
// loader.ts's locale filter and the per-locale reload buttons). The configured
// locales come from the services checkout's locales.json, read by servicesData.ts.
let configuredLocales: string[] = [];

export function setLocales(locales: string[]): void {
  configuredLocales = [...locales];
}

export function getLocales(): string[] {
  return configuredLocales;
}

export function isLocale(value: string): boolean {
  return configuredLocales.includes(value);
}
