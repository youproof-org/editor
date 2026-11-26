import * as fs from 'fs';
import * as path from 'path';
import { localeCodes, validateEntityLabelRegistry, type EntityLabelRegistry } from '@youproof.org/content-model';

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

export interface LocaleConfig { locales: string[]; defaultLocale: string; }

export function readLocaleConfig(servicesRoot: string, configuredDefault?: string): LocaleConfig {
  const localesPath = path.join(servicesRoot, LOCALES_FILE);
  let locales: string[];
  try {
    locales = localeCodes(readJson(servicesRoot, LOCALES_FILE));
  } catch (err) {
    if (err instanceof ServicesDataError) throw err;
    throw new ServicesDataError(`${localesPath}: ${(err as Error).message}. Point ${SERVICES_ROOT_SETTING} at a services checkout.`);
  }
  if (locales.length === 0) {
    throw new ServicesDataError(`${localesPath} has no 'locales'. Point ${SERVICES_ROOT_SETTING} at a services checkout.`);
  }
  const wanted = configuredDefault?.trim();
  if (wanted && !locales.includes(wanted)) {
    throw new ServicesDataError(
      `${DEFAULT_LOCALE_SETTING} is '${wanted}', which is not a configured locale. ` +
        `${localesPath} configures: ${locales.join(', ')}.`,
    );
  }
  return { locales, defaultLocale: wanted || locales[0] };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const SHOWN_REGISTRY_ERRORS = 5;

/**
 * The whole registry, cases included, checked by the same rules as the site build,
 * so the editor never offers a label the build would reject.
 */
export function readEntityLabels(servicesRoot: string, locales: readonly string[]): EntityLabelRegistry {
  const data = readJson(servicesRoot, ENTITY_LABELS_FILE);
  const invalid = (problems: string[]): never => {
    const shown = problems.slice(0, SHOWN_REGISTRY_ERRORS).join('; ');
    const more = problems.length > SHOWN_REGISTRY_ERRORS ? ` (and ${problems.length - SHOWN_REGISTRY_ERRORS} more)` : '';
    throw new ServicesDataError(
      `${path.join(servicesRoot, ENTITY_LABELS_FILE)} is not a valid entity label registry: ${shown}${more}. ` +
        `Point ${SERVICES_ROOT_SETTING} at a services checkout.`,
    );
  };
  if (!isRecord(data)) return invalid(['not an object']);
  const notObjects = Object.entries(data).filter(([, entry]) => !isRecord(entry)).map(([locale]) => `${locale}: not an object`);
  if (notObjects.length > 0) return invalid(notObjects);
  const registry = data as unknown as EntityLabelRegistry;
  let problems: string[];
  try {
    problems = validateEntityLabelRegistry(registry, locales);
  } catch (err) {
    problems = [(err as Error).message];
  }
  if (problems.length > 0) return invalid(problems);
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
    return { root: servicesRoot, localeConfig, entityLabels: readEntityLabels(servicesRoot, localeConfig.locales) };
  } catch (err) {
    if (!(err instanceof ServicesDataError)) throw err;
    return { root: servicesRoot, localeConfig, entityLabels: null, entityLabelsError: err.message };
  }
}
