import * as fs from 'fs';
import * as path from 'path';
import type { EntityTypeLabels, KbEntityType } from '../protocol/contentTypes';

export const SERVICES_ROOT_SETTING  = 'youproof.servicesRoot';
export const DEFAULT_LOCALE_SETTING = 'youproof.defaultLocale';

export const LOCALES_FILE       = path.join('apps', 'website', 'lib', 'i18n', 'locales.json');
export const ENTITY_LABELS_FILE = path.join('apps', 'website', 'lib', 'i18n', 'entity-labels.json');

export class ServicesDataError extends Error {}

// `contentRoot` is the content repo's `content/` directory, so the default is a
// `services` checkout beside the content repo.
export function resolveServicesRoot(configured: string | undefined, workspaceBase: string, contentRoot: string): string {
  const value = configured?.trim();
  if (!value) return path.resolve(contentRoot, '..', '..', 'services');
  return path.isAbsolute(value) ? value : path.resolve(workspaceBase, value);
}

function readJson(servicesRoot: string, file: string): unknown {
  const filePath = path.join(servicesRoot, file);
  const fail = (problem: string): never => {
    throw new ServicesDataError(
      `${filePath} ${problem}. Point ${SERVICES_ROOT_SETTING} at a services checkout ` +
        `(it defaults to a 'services' folder beside the content repo).`,
    );
  };
  let text: string;
  try { text = fs.readFileSync(filePath, 'utf8'); } catch { return fail('could not be read'); }
  try { return JSON.parse(text); } catch { return fail('is not valid JSON'); }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export interface LocaleConfig { locales: string[]; defaultLocale: string; }

export function readLocaleConfig(servicesRoot: string, configuredDefault?: string): LocaleConfig {
  const data = readJson(servicesRoot, LOCALES_FILE);
  const locales = isRecord(data) && isRecord(data['locales']) ? Object.keys(data['locales']) : [];
  if (locales.length === 0) {
    throw new ServicesDataError(
      `${path.join(servicesRoot, LOCALES_FILE)} has no 'locales'. Point ${SERVICES_ROOT_SETTING} at a services checkout.`,
    );
  }
  const wanted = configuredDefault?.trim();
  if (wanted && !locales.includes(wanted)) {
    throw new ServicesDataError(
      `${DEFAULT_LOCALE_SETTING} is '${wanted}', which is not a configured locale. ` +
        `${path.join(servicesRoot, LOCALES_FILE)} configures: ${locales.join(', ')}.`,
    );
  }
  return { locales, defaultLocale: wanted || locales[0] };
}

export type EntityLabelRegistry = Record<string, Partial<Record<KbEntityType, EntityTypeLabels>>>;

const KB_TYPES: KbEntityType[] = ['definition', 'theorem', 'proof', 'remark'];

export function readEntityLabels(servicesRoot: string): EntityLabelRegistry {
  const data = readJson(servicesRoot, ENTITY_LABELS_FILE);
  const invalid = (where: string): never => {
    throw new ServicesDataError(
      `${path.join(servicesRoot, ENTITY_LABELS_FILE)} is not a label registry (${where}). ` +
        `Point ${SERVICES_ROOT_SETTING} at a services checkout.`,
    );
  };
  if (!isRecord(data)) return invalid('not an object');
  const registry: EntityLabelRegistry = {};
  for (const [locale, rawLocale] of Object.entries(data)) {
    if (!isRecord(rawLocale)) return invalid(locale);
    const types: Partial<Record<KbEntityType, EntityTypeLabels>> = {};
    for (const type of KB_TYPES) {
      const entry = rawLocale[type];
      if (entry === undefined) continue;
      if (!isRecord(entry) || typeof entry['default'] !== 'string' || !isRecord(entry['variants'])) {
        return invalid(`${locale}.${type}`);
      }
      const variants = Object.entries(entry['variants']).map(([key, v]) => {
        if (!isRecord(v) || typeof v['canonical'] !== 'string') return invalid(`${locale}.${type}.${key}`);
        return { key, canonical: v['canonical'] };
      });
      types[type] = { default: entry['default'], variants };
    }
    registry[locale] = types;
  }
  return registry;
}

export interface ServicesData {
  root: string;
  localeConfig: LocaleConfig;
  entityLabels: EntityLabelRegistry | null;
  entityLabelsError?: string;
}

export function readServicesData(servicesRoot: string, configuredDefaultLocale?: string): ServicesData {
  const localeConfig = readLocaleConfig(servicesRoot, configuredDefaultLocale);
  try {
    return { root: servicesRoot, localeConfig, entityLabels: readEntityLabels(servicesRoot) };
  } catch (err) {
    if (!(err instanceof ServicesDataError)) throw err;
    return { root: servicesRoot, localeConfig, entityLabels: null, entityLabelsError: err.message };
  }
}
