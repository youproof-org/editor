import {
  entityLabels, fqnJoin, isExternalTarget, parseFqn, parseRefTarget, type EntityLabelRegistry, type PathRefTarget,
} from '@youproof.org/content-model';
import { groupKeys, type DisplayTemplateCollection } from '@youproof.org/display-templates';
import type { DisplayTemplateChoice, ReferenceChoices, ReferenceTargetChoice } from '../protocol/contentTypes';
import { REFERENCE_TOKEN_RE } from '../protocol/referenceToken';
import type { ContentBlock, Definition, LoadedContent, Remark, Theorem } from './model';
import { editorOutline, type ReferenceResolution } from './numbering';

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The kinds of an item's targets as `uses` keys them: each target's kind, distinct, sorted and joined by '+'. */
export function targetKindsKey(kinds: readonly string[]): string {
  return [...new Set(kinds)].sort().join('+');
}

function kindOf(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  if (isExternalTarget(raw.trim())) return 'external';
  try {
    return parseFqn(raw.trim(), 'reference target').kind;
  } catch {
    return undefined;
  }
}

interface Usage {
  templates: Map<string, Record<string, number>>;
  texts: Map<string, Map<string, number>>;
}

/** How the loaded files' `references` lists use each template, per kinds of targets, and each link text, per target. */
function countUsage(content: LoadedContent): Usage {
  const usage: Usage = { templates: new Map(), texts: new Map() };
  for (const obj of content.idToObject.values()) {
    const saved = (obj as { references?: { saved?: unknown[] } }).references?.saved;
    if (!Array.isArray(saved)) continue;
    for (const raw of saved) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const item = raw as Record<string, unknown>;
      const targets = Array.isArray(item['targets']) ? item['targets'] as unknown[] : [item['target']];
      if (typeof item['display'] === 'string') {
        const kinds = targets.map(kindOf);
        if (kinds.some((kind) => kind === undefined)) continue;
        const key = targetKindsKey(kinds as string[]);
        const uses = usage.templates.get(item['display']) ?? {};
        uses[key] = (uses[key] ?? 0) + 1;
        usage.templates.set(item['display'], uses);
      } else if (typeof item['text'] === 'string' && targets.length === 1 && typeof targets[0] === 'string') {
        const texts = usage.texts.get(targets[0]) ?? new Map<string, number>();
        texts.set(item['text'], (texts.get(item['text']) ?? 0) + 1);
        usage.texts.set(targets[0], texts);
      }
    }
  }
  return usage;
}

function templateChoices(templates: DisplayTemplateCollection, usage: Usage): DisplayTemplateChoice[] {
  return Object.values(templates).map((template) => ({
    name: template.name,
    targets: [...template.targets],
    count: template.kind === 'list' ? { ...template.list.count } : { min: 1, max: 1 },
    list: template.kind === 'list',
    order: template.kind === 'list' ? template.list.order : 'sorted',
    ...(template.kind === 'list' && template.list.groupBy ? { groupBy: template.list.groupBy } : {}),
    uses: usage.templates.get(template.name) ?? {},
  }));
}

/** A claim's words, for telling claims apart in a list: its text without markup, reference tokens shown as an ellipsis. */
function claimExcerpt(content: string): string | undefined {
  const plain = content
    .replace(new RegExp(REFERENCE_TOKEN_RE.source, 'g'), '…')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/[*^]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return undefined;
  return plain.length > 80 ? `${plain.slice(0, 79).trimEnd()}…` : plain;
}

type TermOwner = Definition | Theorem | Remark;

/**
 * Everything the loaded content holds that a reference can target, under the path
 * the site's graph keys it by, which is the key set of the editor's numbering: an
 * entity under the name `editorOutline` gives it, a chapter under its book, a
 * section under its chapter, and a claim or a term under its entity. Left out are a
 * remark that nothing lists, which the path grammar gives no address, and a claim
 * inside a subsection or a details block, since the site numbers only the claims of
 * an entity's own body. With the templates, as the popup offers them, and
 * how the loaded files use each.
 */
export function buildReferenceChoices(content: LoadedContent, resolution: ReferenceResolution): ReferenceChoices {
  const { numbering, labels } = resolution;
  const { index } = numbering;
  const usage = countUsage(content);
  const targets: ReferenceTargetChoice[] = [];

  const add = (choice: Omit<ReferenceTargetChoice, 'groups' | 'position' | 'problem'>): void => {
    const target = addressable(choice.path);
    if (!target) return;
    const position = index.positions.get(choice.path);
    const problem = numbering.unnumbered(target);
    targets.push({
      ...choice,
      ...(position !== undefined ? { position } : {}),
      groups: groupKeys(target, index, labels),
      ...(problem ? { problem } : {}),
    });
  };

  for (const book of content.books) {
    const bookFqn = fqnJoin('', 'book', book.name);
    for (const part of book.parts) {
      for (const chapter of part.chapters) {
        const chapterFqn = fqnJoin(bookFqn, 'chapter', chapter.name);
        add({ path: chapterFqn, kind: 'chapter', id: chapter.id, label: index.chapters.get(chapterFqn)?.index ?? chapter.name, title: chapter.title });
        for (const section of chapter.sections) {
          const sectionFqn = fqnJoin(chapterFqn, 'section', section.name);
          add({ path: sectionFqn, kind: 'section', id: section.id, label: index.sections.get(sectionFqn)?.index ?? section.name, title: section.title });
        }
      }
    }
  }

  const { names } = editorOutline(content);
  const labelOf = new Map<string, { label: string; labelName: string }>();
  for (const [entity, fqn] of names) {
    const labelName = capitalize(entityLabelName(labels, entity.locale, entity.type, entity.label));
    const number = index.embedding.get(fqn)?.index;
    labelOf.set(fqn, { label: number ? `${number} ${labelName}` : labelName, labelName });
  }
  for (const [entity, fqn] of names) {
    const { label, labelName } = labelOf.get(fqn)!;
    if (!addressable(fqn)) continue;
    const parentFqn = parseFqn(fqn, 'reference target').parentFqn;
    const owner = parentFqn ? labelOf.get(parentFqn)?.label : undefined;
    const title = 'title' in entity ? entity.title : undefined;
    add({
      path: fqn, kind: entity.type, id: entity.id, label, labelName,
      ...(title ? { title } : {}), ...(owner ? { owner } : {}),
    });
    let claims = 0;
    for (const block of entity.body as ContentBlock[]) {
      if (block.blockType !== 'claim') continue;
      const excerpt = claimExcerpt(block.content);
      add({
        path: fqnJoin(fqn, 'claim', block.name), kind: 'claim', id: block.id, label: `${++claims}.`, owner: label,
        ...(excerpt ? { title: excerpt } : {}),
      });
    }
    if (entity.type === 'proof') continue;
    for (const term of (entity as TermOwner).terms) {
      const path = fqnJoin(fqn, 'term', term.name);
      const texts = [...(usage.texts.get(path) ?? new Map<string, number>())]
        .sort((a, b) => b[1] - a[1])
        .map(([text, uses]) => ({ text, uses }));
      add({
        path, kind: 'term', id: term.id, label: term.canonical || term.name, owner: label,
        ...(term.synonyms.length > 0 ? { synonyms: [...term.synonyms] } : {}),
        ...(texts.length > 0 ? { texts } : {}),
      });
    }
  }

  const order = targets.map((target, i) => ({ target, i }));
  order.sort((a, b) => (a.target.position ?? Infinity) - (b.target.position ?? Infinity) || a.i - b.i);
  return {
    templates: templateChoices(resolution.templates ?? {}, usage),
    targets: order.map(({ target }) => target),
  };
}

/** The target a path names, or undefined when the grammar rejects it, as it does a remark that nothing lists. */
function addressable(path: string): PathRefTarget | undefined {
  try {
    const target = parseRefTarget(path, 'reference target');
    return target.type === 'external' ? undefined : target;
  } catch {
    return undefined;
  }
}

function entityLabelName(labels: EntityLabelRegistry, locale: string, type: string, variant?: string): string {
  try {
    return entityLabels(labels, locale, type, variant).canonical;
  } catch {
    return type;
  }
}
