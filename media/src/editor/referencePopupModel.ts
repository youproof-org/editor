import { isExternalTarget, parseFqn } from '@youproof.org/content-model';
import { checkLinkText, targetCountError, type DisplayTemplate } from '@youproof.org/display-templates';
import type {
  DisplayTemplateChoice, ReferenceChoices, ReferenceTargetChoice, ReferenceTokenSegment,
} from '../shared/types';
import { fold } from './textFold';

/** A target in the popup's draft: one the catalogue has, a URL, or a path the editor doesn't load. */
export interface DraftTarget {
  path: string;
  /** The catalogue's kind, `external` for a URL, or what the path names, such as `article`. */
  kind: string;
  /** Reading order, for a target the catalogue has and something embeds. */
  position?: number;
}

/** The reference being made or edited: a template or literal text, and the targets. */
export interface ReferenceDraft {
  mode: 'template' | 'text';
  /** The chosen template, kept while the mode is text and while the targets don't suit it. */
  display?: string;
  text: string;
  targets: DraftTarget[];
}

export const KIND_NAMES: Record<string, string> = {
  chapter: 'Chapter', section: 'Section', definition: 'Definition', theorem: 'Theorem', proof: 'Proof',
  remark: 'Remark', claim: 'Claim', term: 'Term', external: 'URL',
};

const KIND_PLURALS: Record<string, string> = {
  chapter: 'Chapters', section: 'Sections', definition: 'Definitions', theorem: 'Theorems', proof: 'Proofs',
  remark: 'Remarks', claim: 'Claims', term: 'Terms',
};

const MULTIPLE_TEXT_TARGETS = "a 'text' item has one target. Several targets need a list template in 'display'";

// ─── Targets ────────────────────────────────────────────────────────────────────

export function choicesByPath(choices: ReferenceChoices): Map<string, ReferenceTargetChoice> {
  return new Map(choices.targets.map((target) => [target.path, target]));
}

/** What the popup's draft holds for a target string: the catalogue's entry, a URL, or a path it can't check. */
export function draftTarget(path: string, byPath: ReadonlyMap<string, ReferenceTargetChoice>): DraftTarget {
  const known = byPath.get(path);
  if (known) return { path, kind: known.kind, ...(known.position !== undefined ? { position: known.position } : {}) };
  if (isExternalTarget(path)) return { path, kind: 'external' };
  try {
    return { path, kind: parseFqn(path, 'reference target').kind };
  } catch {
    return { path, kind: 'unknown' };
  }
}

/** Targets in reading order, what nothing embeds last, the rest as given. */
export function inReadingOrder(targets: readonly DraftTarget[]): DraftTarget[] {
  return targets.map((target, i) => ({ target, i }))
    .sort((a, b) => (a.target.position ?? Infinity) - (b.target.position ?? Infinity) || a.i - b.i)
    .map(({ target }) => target);
}

// ─── Search ─────────────────────────────────────────────────────────────────────

export type SearchHit =
  | { kind: 'self' }
  | { kind: 'term'; text: string; target: ReferenceTargetChoice; uses?: number }
  | { kind: 'target'; target: ReferenceTargetChoice }
  | { kind: 'url'; url: string }
  | { kind: 'path'; path: string; targetKind: string };

export interface SearchOptions {
  /** The figure lead-in, where `[*]` is the figure's self-reference. */
  allowSelfReference?: boolean;
  limit?: number;
}

const normalize = (text: string): string => fold(text).toLowerCase();
const words = (text: string): string[] => normalize(text).split(/[\s.,;:()'"!?–-]+/).filter(Boolean);

/** What a numbered target is searched by: its number and label, and for a claim its owner's. */
function numberedLabel(target: ReferenceTargetChoice): string {
  return target.kind === 'claim' && target.owner ? `${target.owner} ${target.label}` : target.label;
}

/**
 * The popup's search over the catalogue. In order: the link texts other references
 * use for a term that start with the query, most used first; the terms whose
 * canonical form or a synonym starts with it; the numbered targets whose number
 * starts with it, then those with a word of the title or label that starts with it,
 * in reading order; and then everything that merely contains it, in the same order.
 * Case and accents don't matter. A URL gives one URL row and a path one row, the
 * catalogue's target when it has it. `*` gives the self-reference where there is one.
 */
export function searchReferenceTargets(choices: ReferenceChoices, query: string, options: SearchOptions = {}): SearchHit[] {
  const trimmed = query.trim();
  const limit = options.limit ?? 50;
  if (trimmed === '' || trimmed === '*') return options.allowSelfReference ? [{ kind: 'self' }] : [];
  if (isExternalTarget(trimmed)) return [{ kind: 'url', url: trimmed }];
  const byPath = choicesByPath(choices);
  if (trimmed.includes('.') && !trimmed.includes(' ')) {
    try {
      const parsed = parseFqn(trimmed, 'reference target');
      const known = byPath.get(parsed.fqn);
      return [known ? { kind: 'target', target: known } : { kind: 'path', path: parsed.fqn, targetKind: parsed.kind }];
    } catch {
      // Not a path: a number such as 24.16 is searched like any other query.
    }
  }

  const q = normalize(trimmed);
  const terms = choices.targets.filter((target) => target.kind === 'term');
  const numbered = choices.targets.filter((target) => target.kind !== 'term');
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const push = (key: string, hit: SearchHit): void => {
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(hit);
  };
  const termHit = (target: ReferenceTargetChoice, text: string, uses?: number) =>
    push(`term:${target.path}:${text}`, { kind: 'term', text, target, ...(uses !== undefined ? { uses } : {}) });
  const forms = (target: ReferenceTargetChoice) => [target.label, ...(target.synonyms ?? [])];

  terms.flatMap((target) => (target.texts ?? []).filter(({ text }) => normalize(text).startsWith(q)).map((text) => ({ target, ...text })))
    .sort((a, b) => b.uses - a.uses)
    .forEach(({ target, text, uses }) => termHit(target, text, uses));
  for (const target of terms) for (const form of forms(target)) if (normalize(form).startsWith(q)) termHit(target, form);
  for (const target of numbered) if (normalize(numberedLabel(target)).startsWith(q)) push(`target:${target.path}`, { kind: 'target', target });
  for (const target of numbered) {
    if ([...words(target.title ?? ''), ...words(numberedLabel(target))].some((word) => word.startsWith(q))) {
      push(`target:${target.path}`, { kind: 'target', target });
    }
  }
  for (const target of terms) {
    for (const { text, uses } of target.texts ?? []) if (normalize(text).includes(q)) termHit(target, text, uses);
    for (const form of forms(target)) if (normalize(form).includes(q)) termHit(target, form);
  }
  for (const target of numbered) {
    if (normalize(numberedLabel(target)).includes(q) || normalize(target.title ?? '').includes(q)) {
      push(`target:${target.path}`, { kind: 'target', target });
    }
  }
  return hits.slice(0, limit);
}

// ─── Templates ──────────────────────────────────────────────────────────────────

/** The kinds of a reference's targets as `uses` keys them: distinct, sorted, joined by '+'. */
export function kindsKey(kinds: readonly string[]): string {
  return [...new Set(kinds)].sort().join('+');
}

function asTemplate(choice: DisplayTemplateChoice): DisplayTemplate {
  return (choice.list
    ? { kind: 'list', name: choice.name, targets: choice.targets, list: { count: choice.count } }
    : { kind: 'single', name: choice.name, targets: choice.targets }) as DisplayTemplate;
}

/** Why `template` can't take `targets`, in the words of the site build's reader, or undefined when it can. */
export function templateProblem(template: DisplayTemplateChoice, targets: readonly DraftTarget[]): string | undefined {
  const problems: string[] = [];
  for (const target of targets) {
    if (!template.targets.includes(target.kind)) {
      problems.push(`template '${template.name}' takes ${template.targets.join(', ')} targets, ` +
        `not ${target.kind === 'external' ? 'a URL' : `a ${target.kind}`} ('${target.path}')`);
    }
  }
  const countError = targetCountError(asTemplate(template), targets.length);
  if (countError && targets.length > 0) problems.push(`template '${template.name}' ${countError}`);
  return problems.length > 0 ? problems.join('; ') : undefined;
}

/**
 * The templates that take every one of the targets and their number, the checks the
 * site build's reader makes, the most used for these kinds of targets first and in
 * the collection's order otherwise.
 */
export function candidateTemplates(templates: readonly DisplayTemplateChoice[], targets: readonly DraftTarget[]): DisplayTemplateChoice[] {
  if (targets.length === 0) return [];
  const key = kindsKey(targets.map((target) => target.kind));
  return templates.map((template, i) => ({ template, i }))
    .filter(({ template }) => templateProblem(template, targets) === undefined)
    .sort((a, b) => (b.template.uses[key] ?? 0) - (a.template.uses[key] ?? 0) || a.i - b.i)
    .map(({ template }) => template);
}

/** The candidates whose name or preview text holds the filter, case and accents aside. */
export function filterTemplates(
  candidates: readonly DisplayTemplateChoice[], filter: string, previewText: (name: string) => string | undefined,
): DisplayTemplateChoice[] {
  const q = normalize(filter.trim());
  if (!q) return [...candidates];
  return candidates.filter((template) => normalize(template.name).includes(q) || normalize(previewText(template.name) ?? '').includes(q));
}

// ─── The draft ──────────────────────────────────────────────────────────────────

/** The targets in the order the reference lists them: reading order, unless the template keeps the authored order. */
export function orderedTargets(draft: ReferenceDraft, templates: readonly DisplayTemplateChoice[]): DraftTarget[] {
  const template = draft.mode === 'template' ? templates.find((t) => t.name === draft.display) : undefined;
  return template?.order === 'authored' ? [...draft.targets] : inReadingOrder(draft.targets);
}

/** Whether the author can reorder the targets: only for a template that keeps the authored order. */
export function canReorder(draft: ReferenceDraft, templates: readonly DisplayTemplateChoice[]): boolean {
  return draft.mode === 'template' && templates.find((t) => t.name === draft.display)?.order === 'authored';
}

/** Why the draft can't be confirmed yet, in the words of the site build's reader where it has them, or undefined. */
export function draftProblem(draft: ReferenceDraft, templates: readonly DisplayTemplateChoice[]): string | undefined {
  if (draft.targets.length === 0) return 'Add a target.';
  const seen = new Set<string>();
  for (const target of draft.targets) {
    if (seen.has(target.path)) return `lists '${target.path}' twice`;
    seen.add(target.path);
  }
  if (draft.mode === 'text') {
    if (draft.targets.length > 1) return MULTIPLE_TEXT_TARGETS;
    if (draft.text === '') return "'text' must be non-empty link text";
    const errors = checkLinkText(draft.text);
    return errors.length > 0 ? errors.map((error) => `text: ${error}`).join('; ') : undefined;
  }
  if (!draft.display) return 'Choose a template.';
  const template = templates.find((t) => t.name === draft.display);
  if (!template) return `'${draft.display}' is not a display template in the collection`;
  return templateProblem(template, draft.targets);
}

/** Why Text mode is unavailable for the draft, or undefined: it has one target. */
export function textModeProblem(draft: ReferenceDraft): string | undefined {
  return draft.targets.length > 1 ? MULTIPLE_TEXT_TARGETS : undefined;
}

/**
 * The `references` list item for the draft, as a save writes it: `display` or
 * `text` first, then `target` for one target or `targets` for several, in the order
 * `orderedTargets` gives.
 */
export function buildReferenceItem(draft: ReferenceDraft, templates: readonly DisplayTemplateChoice[]): Record<string, unknown> {
  const paths = orderedTargets(draft, templates).map((target) => target.path);
  const head = draft.mode === 'text' ? { text: draft.text } : { display: draft.display };
  return paths.length === 1 ? { ...head, target: paths[0] } : { ...head, targets: paths };
}

/** The draft for an item as a token holds it, or undefined when it isn't one the popup can edit. */
export function draftFromItem(item: unknown, byPath: ReadonlyMap<string, ReferenceTargetChoice>): ReferenceDraft | undefined {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const { display, text, target, targets } = item as Record<string, unknown>;
  const raw = Array.isArray(targets) ? targets : target !== undefined ? [target] : [];
  if (!raw.every((t): t is string => typeof t === 'string')) return undefined;
  const drafted = raw.map((path) => draftTarget(path, byPath));
  if (typeof text === 'string') return { mode: 'text', text, targets: drafted };
  if (typeof display === 'string') return { mode: 'template', display, text: '', targets: drafted };
  return undefined;
}

const sameStrings = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * Whether confirming the draft would leave the item as it is: the same template or
 * text and the same targets, in the same order, or in any order when the template
 * sorts them anyway. Then confirming changes nothing in the text.
 */
export function leavesItemUnchanged(original: unknown, draft: ReferenceDraft, templates: readonly DisplayTemplateChoice[]): boolean {
  const before = draftFromItem(original, new Map());
  if (!before || before.mode !== draft.mode) return false;
  if (draft.mode === 'text' ? before.text !== draft.text : before.display !== draft.display) return false;
  const authored = (draft.mode === 'template' && templates.find((t) => t.name === draft.display)?.order === 'authored');
  const paths = (list: readonly DraftTarget[]) => list.map((target) => target.path);
  return authored || draft.mode === 'text'
    ? sameStrings(paths(before.targets), paths(draft.targets))
    : sameStrings(paths(before.targets).sort(), paths(draft.targets).sort());
}

// ─── Text mode and grouping ─────────────────────────────────────────────────────

/** A rendered display as literal link text: the words, each link in brackets, as Text mode starts from it. */
export function textFromSegments(segments: readonly ReferenceTokenSegment[]): string {
  return segments.map((segment) => (segment.kind === 'link' ? `[${segment.text}]` : segment.text)).join('');
}

export interface TargetGroup {
  /** What the group's targets share, shown above them; absent when the template doesn't group. */
  header?: string;
  targets: DraftTarget[];
}

/**
 * The targets as the template groups them, groups in the order of their first
 * member, as the site's list resolver forms them. A target the catalogue doesn't
 * have joins a group of its own.
 */
export function targetGroups(
  targets: readonly DraftTarget[], template: DisplayTemplateChoice | undefined, byPath: ReadonlyMap<string, ReferenceTargetChoice>,
): TargetGroup[] {
  const groupBy = template?.list ? template.groupBy : undefined;
  if (!groupBy) return [{ targets: [...targets] }];
  const groups = new Map<string, TargetGroup>();
  for (const target of targets) {
    const choice = byPath.get(target.path);
    const key = choice?.groups[groupBy] ?? `?${target.path}`;
    const header = !choice ? target.path
      : groupBy === 'type' ? KIND_PLURALS[choice.kind] ?? choice.kind
      : groupBy === 'label' ? choice.labelName ?? choice.label
      : choice.owner ?? key;
    const group = groups.get(key);
    if (group) group.targets.push(target);
    else groups.set(key, { header, targets: [target] });
  }
  return [...groups.values()];
}
