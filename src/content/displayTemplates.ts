import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { entityLabelCases, type EntityLabelRegistry } from '@youproof.org/content-model';
import { readDisplayTemplateCollection, type DisplayTemplateCollection } from '@youproof.org/display-templates';

export const DISPLAY_TEMPLATES_DIR = 'display-templates';

export function displayTemplatesFile(contentRoot: string, locale: string): string {
  return path.join(contentRoot, DISPLAY_TEMPLATES_DIR, `display-templates.${locale}.yaml`);
}

export interface DisplayTemplates {
  locale: string;
  file: string;
  /** The templates that read without a problem. */
  collection: DisplayTemplateCollection;
  /** Every problem found, each naming its template. Empty when the file is valid. */
  errors: string[];
}

/**
 * One locale's template collection, read the way the site build reads it: a
 * missing file is an empty collection, and case keys are checked against every
 * configured locale's. Without a valid label registry the case keys can't be
 * checked, so nothing is read and the reason is the one error.
 */
export function readDisplayTemplates(
  contentRoot: string,
  locale: string,
  registry: EntityLabelRegistry | null,
  locales: readonly string[],
): DisplayTemplates {
  const file = displayTemplatesFile(contentRoot, locale);
  const result = (collection: DisplayTemplateCollection, errors: string[]): DisplayTemplates =>
    ({ locale, file, collection, errors });
  if (!fs.existsSync(file)) return result({}, []);
  if (!registry) {
    return result({}, ['not read, because the entity label registry it is checked against is unavailable']);
  }
  let raw: unknown;
  try {
    raw = yaml.load(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return result({}, [(err as Error).message]);
  }
  const cases = Object.fromEntries(locales.map((l) => [l, entityLabelCases(registry, l)]));
  const { collection, errors } = readDisplayTemplateCollection(raw, { cases });
  return result(collection, errors);
}

const SHOWN_ERRORS = 5;

export function describeDisplayTemplateErrors({ file, errors }: DisplayTemplates): string | undefined {
  if (errors.length === 0) return undefined;
  const shown = errors.slice(0, SHOWN_ERRORS).join('; ');
  const more = errors.length > SHOWN_ERRORS ? ` (and ${errors.length - SHOWN_ERRORS} more)` : '';
  return `${file} has ${errors.length === 1 ? 'a problem' : `${errors.length} problems`}: ${shown}${more}. ` +
    `Until it is fixed, the editor leaves out the templates with a problem.`;
}
