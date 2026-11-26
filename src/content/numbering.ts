import {
  fqnJoin, indexContent, parseFqn, refTargetKey,
  type ContentIndex, type ContentOutline, type EntityLabelRegistry, type OutlineBlock, type OutlineEntity,
  type RefTarget as PathOrUrlTarget,
} from '@youproof.org/content-model';
import {
  resolveReference, type DisplayTemplateCollection, type ReferenceDisplay, type ReferenceItem,
} from '@youproof.org/display-templates';
import type {
  ContentBlock, Definition, FileReferences, LoadedContent, LoadProblem, Namespace, Proof, Remark,
  NumberingScope, Theorem,
} from './model';

type Entity = Definition | Theorem | Proof | Remark;

/**
 * The editor's loaded content numbered the way the site numbers it, with what the
 * editor knows is missing. A number that missing content could change is withheld:
 * `unnumbered` says why, and a reference to it resolves to that error instead.
 */
export interface ContentNumbering {
  index: ContentIndex;
  /** Everything that keeps the numbering from being the site's, load problems first. */
  problems: LoadProblem[];
  /** Why `target`'s number can't be trusted, or undefined when it can. */
  unnumbered(target: PathOrUrlTarget): string | undefined;
}

function walkKb(namespaces: readonly Namespace[], visit: (entity: Entity) => void): void {
  for (const ns of namespaces) {
    for (const entity of [...ns.definitions, ...ns.theorems, ...ns.proofs, ...ns.remarks]) visit(entity);
    walkKb(ns.subNamespaces, visit);
  }
}

/**
 * Every loaded entity's fully qualified name, keyed as the site keys its graph: a
 * proof under the theorem that lists it, a remark under the entity that lists it,
 * and a remark nothing lists at the root. A proof nothing lists has no address.
 */
function entityNames(content: LoadedContent): Map<Entity, string> {
  const names = new Map<Entity, string>();
  const remarks: Remark[] = [];
  const attach = (owner: Entity, ownerFqn: string) => {
    for (const remark of 'remarks' in owner ? owner.remarks : []) names.set(remark, fqnJoin(ownerFqn, 'remark', remark.name));
  };
  walkKb(content.kb, (entity) => {
    if (entity.type === 'definition' || entity.type === 'theorem') {
      const fqn = fqnJoin('', entity.type, entity.name);
      names.set(entity, fqn);
      attach(entity, fqn);
      if (entity.type === 'theorem') {
        for (const proof of entity.proofs) {
          const proofFqn = fqnJoin(fqn, 'proof', proof.name);
          names.set(proof, proofFqn);
          attach(proof, proofFqn);
        }
      }
    }
    if (entity.type === 'remark') remarks.push(entity);
  });
  for (const remark of remarks) if (!names.has(remark)) names.set(remark, fqnJoin('', 'remark', remark.name));
  return names;
}

function embedTarget(block: ContentBlock, content: LoadedContent, names: Map<Entity, string>): OutlineBlock['target'] {
  if (block.blockType !== 'embed') return undefined;
  const loaded = block.target.target ? content.idToObject.get(block.target.target) as Entity | undefined : undefined;
  const fqn = (loaded && names.get(loaded)) ?? block.target.fqn;
  if (!fqn) return undefined;
  try {
    return { type: parseFqn(fqn, 'embed target').kind, fqn };
  } catch {
    return undefined;
  }
}

/** The loaded content as the shared numbering reads it, and the name of each loaded entity. */
export function editorOutline(content: LoadedContent): { outline: ContentOutline; names: Map<Entity, string> } {
  const names = entityNames(content);
  const blocks = (list: readonly ContentBlock[]): OutlineBlock[] => list.map((block) => ({
    type: block.blockType,
    ...(block.blockType === 'embed' ? { target: embedTarget(block, content, names) } : {}),
    ...(block.blockType === 'claim' ? { name: block.name } : {}),
    ...(block.blockType === 'subsection' || block.blockType === 'details' ? { blocks: blocks(block.blocks) } : {}),
  }));
  const attached = new Set<Remark>();
  walkKb(content.kb, (entity) => {
    if (entity.type !== 'remark') for (const remark of entity.remarks) attached.add(remark);
  });
  const entities = new Map<string, OutlineEntity>();
  for (const [entity, fqn] of names) {
    entities.set(fqn, {
      type: entity.type,
      locale: entity.locale,
      title: 'title' in entity ? entity.title : undefined,
      label: entity.label,
      body: blocks(entity.body),
      terms: 'terms' in entity ? entity.terms.map((term) => term.name) : [],
      attached: entity.type === 'remark' && attached.has(entity),
    });
  }
  const outline: ContentOutline = {
    books: content.books.map((book) => ({
      name: book.name,
      title: book.title,
      parts: book.parts.map((part) => ({
        name: part.name,
        chapters: part.chapters.map((chapter) => ({
          name: chapter.name,
          title: chapter.title,
          prologue: blocks(chapter.prologue),
          sections: chapter.sections.map((section) => ({ name: section.name, title: section.title, body: blocks(section.body) })),
          epilogue: blocks(chapter.epilogue),
        })),
      })),
    })),
    entities,
    standalones: [],
  };
  return { outline, names };
}

const KB_KINDS: readonly string[] = ['definition', 'theorem', 'proof', 'remark'];

/** An embed in a chapter whose target the editor didn't load, which the site may have. */
function missingEmbeds(content: LoadedContent, outline: ContentOutline): LoadProblem[] {
  const problems: LoadProblem[] = [];
  const scan = (chapterFqn: string, file: string, list: readonly ContentBlock[], outlined: readonly OutlineBlock[]) => {
    list.forEach((block, i) => {
      const target = outlined[i].target;
      if (block.blockType === 'embed' && !(target && KB_KINDS.includes(target.type) && outline.entities.has(target.fqn))) {
        const what = target?.fqn ?? block.target.fqn ?? 'a target it could not read';
        problems.push({
          message: `${file} embeds '${what}', which the editor has not loaded`,
          scope: { kind: 'chapter', fqn: chapterFqn },
        });
      }
      if ((block.blockType === 'subsection' || block.blockType === 'details') && outlined[i].blocks) {
        scan(chapterFqn, file, block.blocks, outlined[i].blocks!);
      }
    });
  };
  content.books.forEach((book, b) => book.parts.forEach((part, p) => part.chapters.forEach((chapter, c) => {
    const outlined = outline.books[b].parts[p].chapters[c];
    const chapterFqn = fqnJoin(fqnJoin('', 'book', book.name), 'chapter', chapter.name);
    scan(chapterFqn, chapter.filePath, chapter.prologue, outlined.prologue);
    scan(chapterFqn, chapter.filePath, chapter.epilogue, outlined.epilogue);
    chapter.sections.forEach((section, s) => scan(chapterFqn, section.filePath, section.body, outlined.sections[s].body));
  })));
  return problems;
}

/**
 * Numbers the loaded content with the shared numbering (`indexContent`) and works
 * out which numbers missing content could change, so the editor never shows a
 * number the site would not.
 *
 * A missing section can shift the section and entity numbers of its chapter, a
 * missing part or chapter the chapter numbers of its book, and any of them can be
 * where an entity is first embedded, which decides its number. So an entity's
 * number is trusted only when nothing is missing at or before the chapter that
 * embeds it, in reading order, and an entity embedded nowhere only when nothing is
 * missing at all.
 */
export function numberContent(content: LoadedContent): ContentNumbering {
  const { outline } = editorOutline(content);
  const index = indexContent(outline);
  const problems = [...content.problems, ...missingEmbeds(content, outline)];

  const scoped = (kind: 'book' | 'chapter', fqn: string) =>
    problems.filter(({ scope }) => scope?.kind === kind && scope.fqn === fqn);
  const positionOf = (scope: NumberingScope): number =>
    scope.kind === 'all' ? -Infinity : index.positions.get(scope.fqn) ?? -Infinity;
  const ordered = problems
    .filter((problem): problem is Required<LoadProblem> => problem.scope !== undefined)
    .map((problem) => ({ problem, position: positionOf(problem.scope) }))
    .sort((a, b) => a.position - b.position);

  const because = (key: string, found: LoadProblem[]): string | undefined => {
    if (found.length === 0) return undefined;
    const more = found.length > 1 ? ` (and ${found.length - 1} more)` : '';
    return `'${key}' can't be numbered as the site numbers it, because ${found[0].message}${more}.`;
  };

  const unnumbered = (target: PathOrUrlTarget): string | undefined => {
    if (target.type === 'external') return undefined;
    const key = refTargetKey(target);
    if (target.type === 'chapter') return because(key, scoped('book', target.parentFqn));
    if (target.type === 'section') {
      if (target.parentKind !== 'chapter') return undefined;
      const book = parseFqn(target.parentFqn, 'section target').parentFqn;
      return because(key, [...scoped('book', book), ...scoped('chapter', target.parentFqn)]);
    }
    if (target.type === 'claim' || target.type === 'term' || KB_KINDS.includes(target.type)) {
      const entity = target.type === 'claim' || target.type === 'term' ? target.parentFqn : target.fqn;
      const embedding = index.embedding.get(entity);
      if (!embedding) return because(key, ordered.map(({ problem }) => problem));
      const at = index.positions.get(embedding.chapter) ?? Infinity;
      return because(key, ordered.filter(({ position }) => position <= at).map(({ problem }) => problem));
    }
    return undefined;
  };

  return { index, problems, unnumbered };
}

/** What resolving one file's references needs besides the file. */
export interface ReferenceResolution {
  numbering: ContentNumbering;
  /** The file's locale's display template collection. */
  templates: DisplayTemplateCollection | undefined;
  labels: EntityLabelRegistry;
}

/**
 * One reference item resolved to segments the way the site resolves it, or the
 * reason it can't be: the site's own error, or a number the editor can't vouch for.
 */
export function resolveEditorReference(item: ReferenceItem, locale: string, resolution: ReferenceResolution): ReferenceDisplay {
  if (item.display !== undefined) {
    for (const target of item.targets) {
      const reason = resolution.numbering.unnumbered(target);
      if (reason) return { error: reason };
    }
  }
  return resolveReference(item, {
    locale, templates: resolution.templates, content: resolution.numbering.index, labels: resolution.labels,
  });
}

/** Every item of a file's `references` list resolved, in list order, so `[i]` is the i-th. */
export function resolveFileReferences(references: FileReferences, locale: string, resolution: ReferenceResolution): ReferenceDisplay[] {
  return references.entries.map((entry) => entry.item
    ? resolveEditorReference(entry.item, locale, resolution)
    : { error: `reference [${entry.index}] can't be read; the site build reports why` });
}

const SHOWN_PROBLEMS = 5;

export function describeNumberingProblems(problems: readonly LoadProblem[]): string | undefined {
  if (problems.length === 0) return undefined;
  const shown = problems.slice(0, SHOWN_PROBLEMS).map((problem) => problem.message).join('; ');
  const more = problems.length > SHOWN_PROBLEMS ? ` (and ${problems.length - SHOWN_PROBLEMS} more)` : '';
  return `The editor is missing content the site has, so some numbers could differ from the site's: ${shown}${more}. ` +
    `Until it is fixed and the content is reloaded, references to what it could renumber show an error instead of a number.`;
}
