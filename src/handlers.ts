import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import type { MessageServer } from './protocol/messageServer';
import type { PanelManager } from './views/panelManager';
import type { LoadedContent, Namespace, Definition, Theorem, Proof, Remark } from './content/model';
import { buildFqn, IDENTIFIER_RE, type FqnKind, type FqnStep } from './content/fqn';
import { normalizeStrings } from './content/normalize';
import { LOCALES } from './content/locales';
import type {
  ContentTreeItem,
  ContentTargetObject,
  ContentLabels,
  ContentTerm,
  ContentReference,
  GetContentObjectRequest,
  SelectContentObjectRequest,
  SaveContentObjectRequest,
  SaveChapterObjectRequest,
  SaveRecursivelyRequest,
  OpenContentObjectFileRequest,
  SetContentObjectDirtyRequest,
  BeginSelectTargetRequest,
  EndSelectTargetRequest,
  OpenExternalUrlRequest,
  GetReferenceDisplaySuggestionsRequest,
  GetReferenceDisplaySuggestionsResponse,
  GetSelfReferenceDisplaySuggestionsResponse,
  GetReferenceSuggestionsRequest,
  GetReferenceSuggestionsResponse,
  RefSuggestion,
  GetContentTreeResponse,
  GetContentObjectResponse,
  ReloadModelResponse,
  ReloadModelRequest,
} from './protocol/contentTypes';

// ─── Handler context ──────────────────────────────────────────────────────────

export interface HandlerContext {
  server:            MessageServer;
  panelManager:      PanelManager;
  context:           vscode.ExtensionContext;
  getContent:        () => LoadedContent;
  getSelectedId:     () => string | null;
  setSelectedId:     (id: string | null) => void;
  resetContentCache: () => void;
  getActiveLocale:   () => string;
  setActiveLocale:   (locale: string) => void;
}

// ─── Handler registration ─────────────────────────────────────────────────────

export function registerHandlers(ctx: HandlerContext): void {
  const { server, panelManager, getContent, getSelectedId, setSelectedId, resetContentCache,
          getActiveLocale, setActiveLocale } = ctx;
  let pendingTargetSelection: { selectorId: string; allowedTypes: string[] } | null = null;

  server.onRequest('getContentTree', async (): Promise<GetContentTreeResponse> => {
    return {
      ...buildContentTree(getContent()),
      selectedId: getSelectedId(),
      locales: LOCALES,
      activeLocale: getActiveLocale(),
    };
  });

  server.onRequest('getContentObject', async (params): Promise<GetContentObjectResponse> => {
    const p = params as GetContentObjectRequest;
    const content = getContent();
    const obj = content.idToObject.get(p.id) as Record<string, unknown> | undefined;
    if (!obj) throw new Error(`Object not found: ${p.id}`);

    const type  = obj['type'] as string;
    const base  = { id: p.id, name: obj['name'] as string, title: obj['title'] as string | undefined };
    const rawRefs = Array.isArray(obj['references']) ? obj['references'] as unknown[] : [];
    const refs    = serializeRefs(rawRefs);
    const terms   = serializeTerms(Array.isArray(obj['terms']) ? obj['terms'] as unknown[] : []);
    const ns      = obj['namespacePath'] as string;
    const allBlocks: unknown[] = type === 'chapter'
      ? [
          ...(Array.isArray(obj['abstract'])            ? obj['abstract']            as unknown[] : []),
          ...(Array.isArray(obj['prerequisiteWarning']) ? obj['prerequisiteWarning'] as unknown[] : []),
          ...(Array.isArray(obj['prologue'])            ? obj['prologue']            as unknown[] : []),
          ...(Array.isArray(obj['epilogue'])            ? obj['epilogue']            as unknown[] : []),
        ]
      : (Array.isArray(obj['body']) ? obj['body'] as unknown[] : []);
    const targetObjects = buildTargetObjects(rawRefs, allBlocks, content);
    const selectedId = getSelectedId();

    const labels = (type === 'definition' || type === 'theorem')
      ? (obj['labels'] as ContentLabels | undefined)
      : undefined;

    let contentObject;
    if (type === 'definition' || type === 'theorem') {
      contentObject = { ...base, type, namespacePath: ns, terms, references: refs, body: serializeBlocks(obj['body'] as unknown[]), labels, selectedId };
    } else if (type === 'remark') {
      contentObject = { ...base, type, namespacePath: ns, terms, references: refs, body: serializeBlocks(obj['body'] as unknown[]), selectedId };
    } else if (type === 'proof') {
      contentObject = { ...base, type, namespacePath: ns, references: refs, body: serializeBlocks(obj['body'] as unknown[]), selectedId };
    } else if (type === 'chapter') {
      contentObject = { ...base, type, references: refs,
        abstract:            serializeBlocks(obj['abstract']            as unknown[]),
        prerequisiteWarning: serializeBlocks(obj['prerequisiteWarning'] as unknown[]),
        prologue:            serializeBlocks(obj['prologue']            as unknown[]),
        epilogue:            serializeBlocks(obj['epilogue']            as unknown[]),
        selectedId };
    } else if (type === 'section') {
      contentObject = { ...base, type, references: refs, body: serializeBlocks(obj['body'] as unknown[]), selectedId };
    } else {
      throw new Error(`Unsupported type for getContentObject: ${type}`);
    }

    return { contentObject: contentObject as unknown as GetContentObjectResponse['contentObject'], targetObjects };
  });

  server.onRequest('selectContentObject', async (params) => {
    const p = params as SelectContentObjectRequest;
    const content = getContent();

    let entityId = p.id;
    if (!content.idToFilePath.has(p.id)) {
      const parentId = findFileBacked(p.id, content);
      if (!parentId) throw new Error(`Cannot find file-backed parent for: ${p.id}`);
      entityId = parentId;
    }

    const filePath = content.idToFilePath.get(entityId)!;
    const obj   = content.idToObject.get(entityId) as Record<string, unknown> | undefined;
    const name  = typeof obj?.['name']  === 'string' ? obj['name']  as string : entityId;
    const title = typeof obj?.['title'] === 'string' ? obj['title'] as string : undefined;
    const type  = typeof obj?.['type']  === 'string' ? obj['type']  as string : '';
    panelManager.open(entityId, title ?? name, filePath, type);
    if (p.permanent) panelManager.promote(entityId);

    if (p.id !== getSelectedId()) {
      setSelectedId(p.id);
      server.notify('contentObjectSelected', { id: p.id });
    }
    return {};
  });

  server.onRequest('saveContentObject', async (params) => {
    const p = params as SaveContentObjectRequest;
    const content  = getContent();
    const filePath = content.idToFilePath.get(p.id);
    if (!filePath) throw new Error(`No file for: ${p.id}`);

    const oldSelectedId = getSelectedId();
    let oldSelectedParentId: string | null = null;
    if (oldSelectedId && oldSelectedId !== p.id) {
      const sel = content.idToObject.get(oldSelectedId) as Record<string, unknown> | undefined;
      const parent = sel?.['parent'] as Record<string, unknown> | undefined;
      if (parent && typeof parent['id'] === 'string') {
        oldSelectedParentId = parent['id'] as string;
      }
    }

    const obj = content.idToObject.get(p.id) as WireBlock;
    const oldBlockIds = new Set<string>();
    const newBlockIds = new Set<string>();
    if (p.entityType === 'chapter') {
      const cp = p as SaveChapterObjectRequest;
      for (const f of ['abstract', 'prerequisiteWarning', 'prologue', 'epilogue'] as const) {
        collectBlockIds(obj[f] as WireBlock[] | undefined, oldBlockIds);
      }
      obj['abstract']            = updateModelBlocks(cp.abstract            as unknown as WireBlock[], obj, content.idToObject);
      obj['prerequisiteWarning'] = updateModelBlocks(cp.prerequisiteWarning as unknown as WireBlock[], obj, content.idToObject);
      obj['prologue']            = updateModelBlocks(cp.prologue            as unknown as WireBlock[], obj, content.idToObject);
      obj['epilogue']            = updateModelBlocks(cp.epilogue            as unknown as WireBlock[], obj, content.idToObject);
      for (const f of ['abstract', 'prerequisiteWarning', 'prologue', 'epilogue'] as const) {
        collectBlockIds(obj[f] as WireBlock[], newBlockIds);
      }
    } else {
      collectBlockIds(obj['body'] as WireBlock[] | undefined, oldBlockIds);
      obj['body'] = updateModelBlocks(p.body as unknown as WireBlock[], obj, content.idToObject);
      collectBlockIds(obj['body'] as WireBlock[], newBlockIds);
    }
    for (const id of oldBlockIds) {
      if (!newBlockIds.has(id)) content.idToObject.delete(id);
    }
    if ('terms' in p && Array.isArray(p.terms))
      updateModelTerms(obj, p.terms as ContentTerm[], content.idToObject);
    if ('references' in p && Array.isArray(p.references))
      updateModelRefs(obj, p.references as ContentReference[], content.idToObject);

    if (p.entityType === 'definition' || p.entityType === 'theorem') {
      const lp = p as { labels?: ContentLabels };
      if (lp.labels && lp.labels.canonical) {
        obj['labels'] = lp.labels;
      } else {
        delete obj['labels'];
      }
    }

    saveFromModel(p.id, content);
    panelManager.setDirty(p.id, false);

    if (oldSelectedId && !content.idToObject.has(oldSelectedId)) {
      setSelectedId(oldSelectedParentId ?? p.id);
    }
    server.notify('contentObjectUpdated', { id: p.id });
    return {};
  });

  server.onRequest('saveRecursively', async (params) => {
    const p = params as SaveRecursivelyRequest;
    const content = getContent();

    const dirtyIds = p.ids.filter(id => panelManager.isDirty(id));
    if (dirtyIds.length > 0) {
      const labels = dirtyIds.map(id => {
        const obj = content.idToObject.get(id) as Record<string, unknown> | undefined;
        return (obj?.['title'] as string | undefined) ?? (obj?.['name'] as string | undefined) ?? id;
      });
      vscode.window.showErrorMessage(
        `Save or discard unsaved changes before saving recursively: ${labels.join(', ')}`,
      );
      return {};
    }

    for (const id of p.ids) saveFromModel(id, content);
    return {};
  });

  server.onRequest('openContentObjectFile', async (params) => {
    const p = params as OpenContentObjectFileRequest;
    const filePath = getContent().idToFilePath.get(p.id);
    if (!filePath) throw new Error(`No file for: ${p.id}`);
    panelManager.promote(p.id);
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
    return {};
  });

  server.onRequest('reloadModel', async (params): Promise<ReloadModelResponse> => {
    const p = (params ?? {}) as ReloadModelRequest;
    // Switch to the requested locale when valid; otherwise reload the current one.
    // The editor holds exactly one locale at a time, so a locale switch discards
    // and rebuilds the whole model (below).
    const targetLocale = p.locale && LOCALES.includes(p.locale) ? p.locale : getActiveLocale();

    const content  = getContent();
    const allIds   = [...content.idToFilePath.keys()];
    const dirtyIds = allIds.filter(id => panelManager.isDirty(id));
    if (dirtyIds.length > 0) {
      const labels = dirtyIds.map(id => {
        const obj = content.idToObject.get(id) as Record<string, unknown> | undefined;
        return (obj?.['title'] as string | undefined) ?? (obj?.['name'] as string | undefined) ?? id;
      });
      const action = targetLocale !== getActiveLocale() ? 'switching locale' : 'reloading';
      vscode.window.showErrorMessage(
        `Save or discard unsaved changes before ${action}: ${labels.join(', ')}`,
      );
      return {
        ...buildContentTree(content),
        selectedId: getSelectedId(),
        locales: LOCALES,
        activeLocale: getActiveLocale(),
      };
    }

    const openIds = panelManager.closeAll();
    const sel = getSelectedId();
    let oldSelectedFilePath: string | undefined;
    if (sel) {
      const fileBackedId = content.idToFilePath.has(sel) ? sel : findFileBacked(sel, content);
      if (fileBackedId) oldSelectedFilePath = content.idToFilePath.get(fileBackedId);
    }
    const filePaths = openIds
      .map(id => content.idToFilePath.get(id))
      .filter((fp): fp is string => fp !== undefined);

    // Apply the (possibly new) locale before rebuilding the model.
    setActiveLocale(targetLocale);
    resetContentCache();
    const newContent = getContent();

    let lastReopenedId: string | null = null;
    for (const fp of filePaths) {
      const newId = newContent.filePathToId.get(fp);
      if (!newId) continue;
      const obj   = newContent.idToObject.get(newId) as Record<string, unknown> | undefined;
      const name  = typeof obj?.['name']  === 'string' ? obj['name']  as string : newId;
      const title = typeof obj?.['title'] === 'string' ? obj['title'] as string : undefined;
      const type  = typeof obj?.['type']  === 'string' ? obj['type']  as string : '';
      panelManager.open(newId, title ?? name, fp, type, true);
      lastReopenedId = newId;
    }

    let newSelectedId: string | null = oldSelectedFilePath
      ? (newContent.filePathToId.get(oldSelectedFilePath) ?? null)
      : null;
    if (!newSelectedId) newSelectedId = lastReopenedId;
    setSelectedId(newSelectedId);

    if (newSelectedId) panelManager.focusWhenReady(newSelectedId);

    return {
      ...buildContentTree(newContent),
      selectedId: newSelectedId,
      locales: LOCALES,
      activeLocale: getActiveLocale(),
    };
  });

  server.onRequest('setContentObjectDirty', async (params) => {
    const p = params as SetContentObjectDirtyRequest;
    panelManager.setDirty(p.id, true);
    panelManager.promote(p.id);
    return {};
  });

  server.onRequest('getReferenceDisplaySuggestions', async (params): Promise<GetReferenceDisplaySuggestionsResponse> => {
    const p = params as GetReferenceDisplaySuggestionsRequest;
    const { idToObject } = getContent();
    const counts = new Map<string, number>();
    for (const v of idToObject.values()) {
      const obj = v as Record<string, unknown>;
      const tgt = obj['target'] as Record<string, unknown> | undefined;
      if (!tgt || tgt['type'] !== p.type) continue;
      const parent = obj['parent'] as Record<string, unknown> | undefined;
      if (!parent) continue;
      const parentRefs = Array.isArray(parent['references']) ? parent['references'] as unknown[] : [];
      if (!parentRefs.includes(obj)) continue;
      const display = obj['display'] as string | undefined;
      if (display) counts.set(display, (counts.get(display) ?? 0) + 1);
    }
    const suggestions = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([s]) => s);
    return { suggestions };
  });

  server.onRequest('getReferenceSuggestions', async (params): Promise<GetReferenceSuggestionsResponse> => {
    const { currentObjectId } = params as GetReferenceSuggestionsRequest;
    const { idToObject } = getContent();

    // Walk parent chain looking for an ancestor whose id matches currentObjectId.
    const belongsToCurrent = (parent: unknown): boolean => {
      let cursor: unknown = parent;
      while (cursor && typeof cursor === 'object') {
        const id = (cursor as { id?: unknown }).id;
        if (id === currentObjectId) return true;
        cursor = (cursor as { parent?: unknown }).parent;
      }
      return false;
    };

    const suggestions: RefSuggestion[] = [];

    for (const v of idToObject.values()) {
      const obj = v as Record<string, unknown>;
      const tgt = obj['target'] as { type?: string; target?: string } | undefined;
      const parent = obj['parent'];
      if (!tgt || !parent) continue;
      const parentRefs = Array.isArray((parent as { references?: unknown[] }).references)
        ? (parent as { references: unknown[] }).references
        : [];
      if (!parentRefs.includes(obj)) continue;        // only Reference entities
      const display = obj['display'] as string | undefined;
      if (!display) continue;                          // filter: must have a display
      const targetType = tgt.type;
      const targetId   = tgt.target;
      if (!targetType || !targetId) continue;
      let label: string | undefined;
      if (targetType === 'external') {
        label = targetId;
      } else {
        const resolved = idToObject.get(targetId) as { title?: string; name?: string } | undefined;
        label = resolved?.title ?? resolved?.name;
      }
      if (!label) continue;                            // filter: must have a resolved target

      suggestions.push({
        source:  belongsToCurrent(parent) ? 'current' : 'other',
        name:    obj['name'] as string,
        display,
        target:  { id: targetId, type: targetType, label },
      });
    }
    return { suggestions };
  });

  server.onRequest('getSelfReferenceDisplaySuggestions', async (): Promise<GetSelfReferenceDisplaySuggestionsResponse> => {
    const { idToObject } = getContent();
    const counts = new Map<string, number>();
    for (const v of idToObject.values()) {
      const obj = v as Record<string, unknown>;
      if (obj['blockType'] !== 'figure') continue;
      const sr = obj['selfReference'] as { display?: string } | undefined;
      if (!sr || !sr.display) continue;
      counts.set(sr.display, (counts.get(sr.display) ?? 0) + 1);
    }
    const suggestions = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([s]) => s);
    return { suggestions };
  });

  server.onRequest('openExternalUrl', async (params) => {
    const p = params as OpenExternalUrlRequest;
    await vscode.env.openExternal(vscode.Uri.parse(p.url));
    return {};
  });

  server.onRequest('beginSelectTarget', async (params) => {
    if (pendingTargetSelection !== null) return {};
    const p = params as BeginSelectTargetRequest;
    pendingTargetSelection = { selectorId: p.selectorId, allowedTypes: p.allowedTypes };
    server.notify('targetSelectionStarted', { selectorId: p.selectorId, allowedTypes: p.allowedTypes });
    return {};
  });

  server.onRequest('endSelectTarget', async (params) => {
    if (pendingTargetSelection === null) return {};
    const { selectorId } = pendingTargetSelection;
    pendingTargetSelection = null;
    const p = params as EndSelectTargetRequest;
    let result: ContentTargetObject | null = null;
    if (p.targetId !== null) {
      const { idToObject } = getContent();
      const found = idToObject.get(p.targetId) as Record<string, unknown> | undefined;
      if (found) {
        const t = found['type'] as string | undefined;
        let type: string | undefined;
        if (['chapter', 'section', 'definition', 'theorem', 'proof', 'remark'].includes(t ?? '')) {
          type = t;
        } else if (found['blockType'] === 'claim') {
          type = 'claim';
        } else {
          const parent = found['parent'] as Record<string, unknown> | undefined;
          const parentTerms = Array.isArray(parent?.['terms']) ? parent!['terms'] as unknown[] : [];
          if (parentTerms.includes(found)) type = 'term';
        }
        if (type !== undefined) {
          const label = (found['title'] as string | undefined) ?? (found['name'] as string | undefined) ?? p.targetId;
          result = { id: p.targetId, type, label };
        }
      }
    }
    server.notify('targetSelectionEnded', { selectorId, result });
    return {};
  });
}

// ─── Content navigation helpers ───────────────────────────────────────────────

function findFileBacked(id: string, content: LoadedContent): string | null {
  let cur = content.idToObject.get(id) as { parent?: { id: string } } | undefined;
  for (let i = 0; i < 10 && cur?.parent; i++) {
    const parentId = cur.parent.id;
    if (content.idToFilePath.has(parentId)) return parentId;
    cur = content.idToObject.get(parentId) as typeof cur;
  }
  return null;
}

// ─── YAML save helpers ────────────────────────────────────────────────────────

type WireBlock = Record<string, unknown>;

/**
 * Serialize a reference target back to YAML: a single string, either a URL or a
 * fully qualified name.
 *
 * A resolved target's path is REBUILT from the object graph rather than echoed, so
 * it follows a rename or a move made in the editor. An unresolved one — a
 * well-formed path to something this editor does not model, i.e. an article, page,
 * landing, book or part — is written back verbatim from `fqn`.
 *
 * That last case is not defensive tidiness. Before targets became strings, an
 * unmodelled target loaded as an empty external and this function returned
 * `undefined` for it, so the caller wrote no `target` key at all: every article,
 * page and book reference lost its target on the first save of the file that
 * contained it. Returning `undefined` now means only "there is genuinely nothing to
 * write".
 */
function targetToYaml(
  target: { type: string; target: string; fqn?: string },
  content: LoadedContent,
): string | undefined {
  const { type, target: id, fqn } = target;
  if (type === 'unreadable') {
    throw new Error(
      'This file has a reference target in the old composite form, which this editor ' +
        'cannot write back. Saving would delete it. Migrate the content to path ' +
        'targets first (scripts/migrate-ref-targets.mjs in the content repo), or ' +
        'install the editor release that matches this content.',
    );
  }
  if (type === 'external') return id || undefined;
  if (type === 'unresolved' || !id) return fqn || undefined;

  const obj = content.idToObject.get(id) as Record<string, unknown> | undefined;
  if (!obj) return fqn || undefined;

  const steps = stepsForObject(obj, type as FqnKind, content);
  return steps ? buildFqn(steps) : (fqn || undefined);
}

/**
 * The ancestor chain of a referenced object, as fully qualified name steps.
 *
 * Walks UP through the parent pointers the loader wired, which is what makes a path
 * follow the object rather than the text it was authored from. Returns null when the
 * chain cannot be completed, so the caller falls back to the authored path instead
 * of writing a truncated one.
 */
function stepsForObject(
  obj: Record<string, unknown>,
  kind: FqnKind,
  content: LoadedContent,
): FqnStep[] | null {
  const name = obj['name'];
  if (typeof name !== 'string') return null;
  const self: FqnStep = { kind, name };

  switch (kind) {
    case 'definition':
    case 'theorem':
      return [self];
    case 'proof': {
      // A proof's theorem is not a back-pointer on the proof, so it is found by
      // asking which theorem lists it.
      const theorem = findOwner(content, 'theorem', (t) =>
        (t['proofs'] as Record<string, unknown>[] | undefined)?.some((p) => p['id'] === obj['id']) ?? false);
      if (!theorem) return null;
      const parent = stepsForObject(theorem, 'theorem', content);
      return parent ? [...parent, self] : null;
    }
    case 'remark': {
      const owner = findOwner(content, null, (o) =>
        (o['remarks'] as Record<string, unknown>[] | undefined)?.some((r) => r['id'] === obj['id']) ?? false);
      if (!owner) return null;
      const ownerKind = owner['type'] as FqnKind;
      const parent = stepsForObject(owner, ownerKind, content);
      return parent ? [...parent, self] : null;
    }
    case 'claim':
    case 'term': {
      const parentObj = obj['parent'] as Record<string, unknown> | undefined;
      if (!parentObj || typeof parentObj['type'] !== 'string') {
        throw new Error(
          `${kind} "${name}" has no entity parent — claims nested in subsections or ` +
            `details are not supported.`,
        );
      }
      const parent = stepsForObject(parentObj, parentObj['type'] as FqnKind, content);
      return parent ? [...parent, self] : null;
    }
    case 'chapter': {
      const part = obj['part'] as { name: string; book: { name: string } } | undefined;
      if (!part?.book?.name) return null;
      // No part step: a chapter is addressed under its book (see fqn.ts).
      return [{ kind: 'book', name: part.book.name }, self];
    }
    case 'section': {
      const chapter = obj['chapter'] as Record<string, unknown> | undefined;
      if (!chapter) return null;
      const parent = stepsForObject(chapter, 'chapter', content);
      return parent ? [...parent, self] : null;
    }
    case 'part': {
      const book = obj['book'] as { name: string } | undefined;
      if (!book?.name) return null;
      return [{ kind: 'book', name: book.name }, self];
    }
    case 'book':
      return [self];
    default:
      return null;
  }
}

/** First loaded object of `type` (or any type) satisfying `pred`. */
function findOwner(
  content: LoadedContent,
  type: string | null,
  pred: (obj: Record<string, unknown>) => boolean,
): Record<string, unknown> | undefined {
  for (const value of content.idToObject.values()) {
    const obj = value as Record<string, unknown>;
    if (type !== null && obj['type'] !== type) continue;
    if (pred(obj)) return obj;
  }
  return undefined;
}

// Types whose `terms` map the model actually represents (see model.ts: `Proof`
// has no `terms`). Only for these may an empty model mean "the author deleted the
// terms" — for anything else the field simply isn't modelled, so it must be left
// exactly as authored rather than deleted. Mirrors how `labels` below is only
// rewritten for the two types that model it. Defining terms directly on a proof
// is a planned content feature; without this guard the first save would silently
// destroy such a block.
const TERM_BEARING_TYPES = ['definition', 'theorem', 'remark'];

// Exported for the round-trip test (test/save-roundtrip.test.mjs), which asserts
// that saving a knowledge-base file preserves the unmodelled `slug` fields and is
// idempotent. Not part of the extension's public surface.
export function saveFromModel(id: string, content: LoadedContent): void {
  const filePath = content.idToFilePath.get(id);
  if (!filePath) return;

  const obj  = content.idToObject.get(id) as WireBlock;
  const type = obj['type'] as string;

  // CORE_SCHEMA (not DEFAULT): keep YAML timestamps like `published-at:
  // 2020-03-29 22:17:00` as plain STRINGS so they round-trip verbatim. Under the
  // default schema js-yaml parses them into Date objects, which normalizeStrings
  // then flattens to `{}` (a Date has no enumerable own keys) — corrupting the
  // field on save.
  const yamlDoc = yaml.load(fs.readFileSync(filePath, 'utf8'), { schema: yaml.CORE_SCHEMA }) as Record<string, unknown>;

  // Read the unmodelled `slug`s off the file BEFORE any field is rewritten below.
  const claimSlugs = collectClaimSlugs(yamlDoc);
  const origTerms = (yamlDoc['terms'] && typeof yamlDoc['terms'] === 'object' && !Array.isArray(yamlDoc['terms']))
    ? yamlDoc['terms'] as Record<string, unknown>
    : {};

  if (type === 'chapter') {
    const merge = (yamlField: string, modelBlocks: WireBlock[]) => {
      if (!Array.isArray(modelBlocks) || modelBlocks.length === 0) {
        delete yamlDoc[yamlField];
        return;
      }
      const orig = (yamlDoc[yamlField] ?? []) as WireBlock[];
      yamlDoc[yamlField] = mergeBlocks(orig, modelBlocks, content, claimSlugs);
    };
    merge('abstract',             obj['abstract']            as WireBlock[]);
    merge('prerequisite-warning', obj['prerequisiteWarning'] as WireBlock[]);
    merge('prologue',             obj['prologue']            as WireBlock[]);
    merge('epilogue',             obj['epilogue']            as WireBlock[]);
  } else {
    const modelBody = Array.isArray(obj['body']) ? obj['body'] as WireBlock[] : [];
    if (modelBody.length > 0) {
      const orig = (yamlDoc['body'] ?? []) as WireBlock[];
      yamlDoc['body'] = mergeBlocks(orig, modelBody, content, claimSlugs);
    } else {
      delete yamlDoc['body'];
    }
  }

  const modelTermsArr = Array.isArray(obj['terms']) ? obj['terms'] as WireBlock[] : [];
  if (modelTermsArr.length > 0) {
    const termsYaml: Record<string, unknown> = {};
    for (const t of modelTermsArr) {
      const name  = t['name'] as string;
      const entry: Record<string, unknown> = {};
      // Unmodelled `slug`, carried over from the file keyed by the term name —
      // same rule as claim slugs (see collectClaimSlugs). First key in the entry,
      // since the map key is the term's name.
      const prev = origTerms[name];
      const slug = prev && typeof prev === 'object' && !Array.isArray(prev)
        ? (prev as Record<string, unknown>)['slug']
        : undefined;
      if (typeof slug === 'string') entry['slug'] = slug;
      if (t['display'])   entry['display']   = t['display'];
      if (t['canonical']) entry['canonical'] = t['canonical'];
      if (Array.isArray(t['synonyms']) && (t['synonyms'] as unknown[]).length)
        entry['synonyms'] = t['synonyms'];
      termsYaml[name] = entry;
    }
    yamlDoc['terms'] = termsYaml;
  } else if (TERM_BEARING_TYPES.includes(type)) {
    delete yamlDoc['terms'];
  }

  const modelRefsArr = Array.isArray(obj['references']) ? obj['references'] as WireBlock[] : [];
  if (modelRefsArr.length > 0) {
    const refsYaml: Record<string, unknown> = {};
    for (const r of modelRefsArr) {
      const entry: Record<string, unknown> = {};
      if (r['display']) entry['display'] = r['display'];
      const tgt = r['target'] as { type: string; target: string } | undefined;
      if (tgt) {
        const yamlTarget = targetToYaml(tgt, content);
        if (yamlTarget) entry['target'] = yamlTarget;
      }
      refsYaml[r['name'] as string] = entry;
    }
    yamlDoc['references'] = refsYaml;
  } else {
    delete yamlDoc['references'];
  }

  const modelLabels = obj['labels'] as ContentLabels | undefined;
  if ((type === 'definition' || type === 'theorem') && modelLabels && modelLabels.canonical) {
    const labelsYaml: Record<string, unknown> = { canonical: modelLabels.canonical };
    if (modelLabels.cases && Object.keys(modelLabels.cases).length > 0) {
      const casesYaml: Record<string, unknown> = {};
      for (const [k, c] of Object.entries(modelLabels.cases)) {
        const entry: Record<string, unknown> = {};
        if (c.base)   entry['base']   = c.base;
        if (c.suffix) entry['suffix'] = c.suffix;
        casesYaml[k] = entry;
      }
      labelsYaml['cases'] = casesYaml;
    }
    yamlDoc['labels'] = labelsYaml;
  } else if (type === 'definition' || type === 'theorem') {
    delete yamlDoc['labels'];
  }

  const reordered = reorderYamlKeys(yamlDoc, type);
  fs.writeFileSync(filePath, yaml.dump(
    normalizeStrings(reordered) as Record<string, unknown>,
    { lineWidth: 120, noCompatMode: true },
  ));
}

// Key order per type — keeps saved YAML stable instead of appending keys. The
// localization fields (`slug`, `locale`), the chapter migration/listing fields
// (`excerpt`, `published-at`, `legacy-path`) and the crawler-metadata block
// (`meta`) are included so they stay in place on save (read from / written back
// verbatim, not modelled). `slug` follows `name` and `locale` follows `slug`, on
// every type that carries one — the knowledge-base types now do, since each of
// them has its own public URL. Keys not listed are still preserved —
// appended after these — but list everything the content emits so nothing moves.
// Types with NO entry here (book, article, newsletter, page, landing) are left
// untouched by reorderYamlKeys, so their `meta`/`excerpt` keep their authored
// position; add an entry when the editor gains a UI for those types.
const CANONICAL_ORDER: Record<string, string[]> = {
  definition: ['type', 'name', 'slug', 'locale', 'title', 'labels', 'remarks', 'terms', 'references', 'body'],
  theorem:    ['type', 'name', 'slug', 'locale', 'title', 'labels', 'proofs', 'remarks', 'terms', 'references', 'body'],
  proof:      ['type', 'name', 'slug', 'locale', 'title', 'remarks', 'terms', 'references', 'body'],
  remark:     ['type', 'name', 'slug', 'locale', 'title', 'terms', 'references', 'body'],
  section:    ['type', 'name', 'slug', 'locale', 'title', 'references', 'body'],
  part:       ['type', 'name', 'slug', 'locale', 'title', 'chapters'],
  chapter:    ['type', 'name', 'slug', 'locale', 'title', 'excerpt', 'published-at', 'legacy-path',
               'meta', 'thumbnail', 'references',
               'abstract', 'prerequisite-warning', 'prologue', 'sections', 'epilogue'],
};

function reorderYamlKeys(yamlDoc: Record<string, unknown>, type: string): Record<string, unknown> {
  const order = CANONICAL_ORDER[type];
  if (!order) return yamlDoc;
  const result: Record<string, unknown> = {};
  for (const key of order) {
    if (key in yamlDoc) result[key] = yamlDoc[key];
  }
  for (const key of Object.keys(yamlDoc)) {
    if (!(key in result)) result[key] = yamlDoc[key];
  }
  return result;
}


function blockHeader(wire: WireBlock, type: string): WireBlock {
  const r: WireBlock = { type };
  if (wire['context'] === 'web' || wire['context'] === 'latex') r['context'] = wire['context'];
  return r;
}

/**
 * Claim `slug`s (and term `slug`s, below) are authored in the content YAML but are
 * deliberately NOT modelled — the editor has no UI for them (see model.ts). They
 * must therefore be carried across a save from the file on disk.
 *
 * Keyed by the claim `name`, never by position: the editor lets an author insert,
 * delete and reorder blocks, so an index-paired lookup would transplant a slug
 * onto a different claim. A *renamed* claim legitimately loses its slug — the slug
 * describes the claim's content, so a rename invalidates it, and re-deriving it is
 * an authoring decision rather than something to guess here.
 */
function collectClaimSlugs(yamlDoc: Record<string, unknown>): Map<string, string> {
  const slugs = new Map<string, string>();
  const walk = (blocks: unknown): void => {
    if (!Array.isArray(blocks)) return;
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      const blk = b as Record<string, unknown>;
      if (blk['type'] === 'claim' && typeof blk['name'] === 'string' && typeof blk['slug'] === 'string') {
        slugs.set(blk['name'], blk['slug']);
      }
      walk(blk['blocks']);
    }
  };
  for (const field of ['body', 'abstract', 'prerequisite-warning', 'prologue', 'epilogue']) {
    walk(yamlDoc[field]);
  }
  return slugs;
}

function blockToYaml(
  wire: WireBlock,
  orig: WireBlock,
  content: LoadedContent,
  claimSlugs: Map<string, string>,
): WireBlock {
  const bt = wire['blockType'] as string;
  if (bt === 'embed' || bt === 'recall') {
    const r = blockHeader(wire, bt);
    if (bt === 'embed' && wire['showTitle']) r['show-title'] = wire['showTitle'];
    const target = wire['target'] as { type: string; target: string } | undefined;
    if (target) {
      const yt = targetToYaml(target, content);
      if (yt) r['target'] = yt;
    }
    return r;
  }
  switch (bt) {
    case 'narrative': {
      const r = blockHeader(wire, 'narrative');
      r['content'] = wire['content'];
      return r;
    }
    case 'formula': {
      const r = blockHeader(wire, 'formula');
      if (wire['leadIn'])  r['lead-in']  = wire['leadIn'];
      r['content'] = wire['content'];
      if (wire['leadOut']) r['lead-out'] = wire['leadOut'];
      return r;
    }
    case 'claim': {
      const r = blockHeader(wire, 'claim');
      r['name']    = wire['name'];
      // `slug` sits right after `name`, matching where it sits on the addressable
      // types (chapter/section) and in CANONICAL_ORDER below.
      // The only identifier this editor lets an author type: a new claim block is
      // created with an empty name. It becomes a segment of a dotted path — a
      // reference to it is `...claims.{name}` — so a `.` or a space would make that
      // reference unparseable, and the site build would reject it far from here.
      const claimName = wire['name'];
      if (typeof claimName !== 'string' || !IDENTIFIER_RE.test(claimName)) {
        throw new Error(
          `Claim name ${JSON.stringify(claimName)} is not a valid identifier: it must be ` +
            `lowercase kebab-case (${IDENTIFIER_RE.source}). A claim name is part of the ` +
            `path that references it, so it cannot contain a '.', a space or a capital.`,
        );
      }
      const slug = claimSlugs.get(claimName);
      if (slug) r['slug'] = slug;
      r['content'] = wire['content'];
      if (wire['formula']) r['formula'] = wire['formula'];
      return r;
    }
    case 'ordered-list':
    case 'unordered-list': {
      const r = blockHeader(wire, bt);
      if (wire['leadIn']) r['lead-in'] = wire['leadIn'];
      r['items'] = wire['items'];
      return r;
    }
    case 'typewriter': {
      const r = blockHeader(wire, 'typewriter');
      if (wire['leadIn']) r['lead-in'] = wire['leadIn'];
      r['rows'] = wire['rows'];
      return r;
    }
    case 'quote': {
      const r = blockHeader(wire, 'quote');
      if (wire['leadIn']) r['lead-in'] = wire['leadIn'];
      r['quote'] = wire['quote'];
      if (wire['author']) r['author'] = wire['author'];
      return r;
    }
    case 'figure': {
      const r = blockHeader(wire, 'figure');
      const sr = wire['selfReference'] as { display: string } | undefined;
      if (sr && sr.display) r['self-reference'] = { display: sr.display };
      if (wire['leadIn'])   r['lead-in']  = wire['leadIn'];
      r['src'] = wire['src'];
      if (wire['alt'])      r['alt']      = wire['alt'];
      if (wire['caption'])  r['caption']  = wire['caption'];
      if (wire['size'])     r['size']     = wire['size'];
      return r;
    }
    case 'subsection': {
      const origChildren = ((orig['blocks'] ?? orig['body'] ?? []) as WireBlock[]);
      const wireChildren = ((wire['blocks'] ?? []) as WireBlock[]);
      const r = blockHeader(wire, 'subsection');
      r['title']  = wire['title'];
      r['blocks'] = mergeBlocks(origChildren, wireChildren, content, claimSlugs);
      return r;
    }
    case 'details': {
      const origChildren = ((orig['blocks'] ?? orig['body'] ?? []) as WireBlock[]);
      const wireChildren = ((wire['blocks'] ?? []) as WireBlock[]);
      const r = blockHeader(wire, 'details');
      if (wire['title']) r['title'] = wire['title'];
      r['blocks'] = mergeBlocks(origChildren, wireChildren, content, claimSlugs);
      return r;
    }
    default: return orig;
  }
}

function mergeBlocks(
  orig: WireBlock[],
  wire: WireBlock[],
  content: LoadedContent,
  claimSlugs: Map<string, string>,
): WireBlock[] {
  return wire.map((w, i) => blockToYaml(w, orig[i] ?? {}, content, claimSlugs));
}

function updateModelTerms(obj: WireBlock, incoming: ContentTerm[], idToObject: Map<string, unknown>): void {
  const modelTerms = Array.isArray(obj['terms']) ? obj['terms'] as WireBlock[] : [];
  obj['terms'] = incoming.map(t => {
    const existing = modelTerms.find(m => m['id'] === t.id);
    if (existing) {
      existing['name'] = t.name; existing['display'] = t.display;
      existing['canonical'] = t.canonical; existing['synonyms'] = t.synonyms;
      return existing;
    }
    const newTerm: WireBlock = { id: t.id, name: t.name, display: t.display, canonical: t.canonical, synonyms: t.synonyms, parent: obj };
    idToObject.set(t.id, newTerm);
    return newTerm;
  });
  for (const m of modelTerms) {
    if (!incoming.some(t => t.id === m['id'])) idToObject.delete(m['id'] as string);
  }
}

function updateModelRefs(obj: WireBlock, incoming: ContentReference[], idToObject: Map<string, unknown>): void {
  const resolveTarget = (targetId: string | undefined): WireBlock => {
    if (!targetId) return { type: 'external', target: '' };
    const found = idToObject.get(targetId) as Record<string, unknown> | undefined;
    if (found) {
      const t = found['type'] as string | undefined;
      if (['chapter', 'section', 'definition', 'theorem', 'proof', 'remark'].includes(t ?? ''))
        return { type: t!, target: targetId };
      if (found['blockType'] === 'claim') return { type: 'claim', target: targetId };
      const parent = found['parent'] as Record<string, unknown> | undefined;
      const parentTerms = Array.isArray(parent?.['terms']) ? parent!['terms'] as unknown[] : [];
      if (parentTerms.includes(found)) return { type: 'term', target: targetId };
      return { type: 'external', target: '' };
    }
    if (targetId.startsWith('http://') || targetId.startsWith('https://'))
      return { type: 'external', target: targetId };
    return { type: 'external', target: '' };
  };
  const modelRefs = Array.isArray(obj['references']) ? obj['references'] as WireBlock[] : [];
  obj['references'] = incoming.map(r => {
    const existing = modelRefs.find(m => m['id'] === r.id);
    if (existing) {
      existing['name'] = r.name; existing['display'] = r.display; existing['target'] = resolveTarget(r.targetId);
      return existing;
    }
    const newRef: WireBlock = { id: r.id, name: r.name, display: r.display, target: resolveTarget(r.targetId), parent: obj };
    idToObject.set(r.id, newRef);
    return newRef;
  });
  for (const m of modelRefs) {
    if (!incoming.some(r => r.id === m['id'])) idToObject.delete(m['id'] as string);
  }
}

function applyWireToBlock(model: WireBlock, wire: WireBlock, parent: WireBlock): void {
  model['id']        = wire['id'];
  model['blockType'] = wire['blockType'];
  model['parent']    = parent;

  const bt = wire['blockType'] as string;
  if (bt === 'embed' || bt === 'recall') {
    if ('targetType' in wire || 'targetId' in wire) {
      model['target'] = { type: String(wire['targetType'] ?? ''), target: String(wire['targetId'] ?? '') };
    }
    if (bt === 'embed') {
      if ('showTitle' in wire) model['showTitle'] = wire['showTitle'];
      else delete model['showTitle'];
    }
    return;
  }
  for (const f of ['content', 'leadIn', 'leadOut', 'formula', 'quote', 'author', 'title', 'name', 'src', 'alt', 'caption', 'size']) {
    if (f in wire) model[f] = wire[f]; else delete model[f];
  }
  if (Array.isArray(wire['items'])) model['items'] = [...wire['items'] as unknown[]];
  if (Array.isArray(wire['rows']))  model['rows']  = [...wire['rows']  as unknown[]];

  if (bt === 'figure') {
    const sr = wire['selfReference'] as { display: string } | undefined;
    if (sr && sr.display) model['selfReference'] = { display: sr.display };
    else delete model['selfReference'];
  }
}

function updateModelBlocks(
  wireBlocks: WireBlock[],
  parent: WireBlock,
  idToObject: Map<string, unknown>,
): WireBlock[] {
  return wireBlocks.map(wire => {
    let model = idToObject.get(wire['id'] as string) as WireBlock | undefined;
    if (!model) {
      model = {} as WireBlock;
      idToObject.set(wire['id'] as string, model);
    }
    applyWireToBlock(model, wire, parent);
    if (Array.isArray(wire['blocks'])) {
      model['blocks'] = updateModelBlocks(wire['blocks'] as WireBlock[], model, idToObject);
    }
    return model;
  });
}

function collectBlockIds(blocks: WireBlock[] | undefined, out: Set<string>): void {
  if (!Array.isArray(blocks)) return;
  for (const b of blocks) {
    out.add(b['id'] as string);
    if (Array.isArray(b['blocks'])) collectBlockIds(b['blocks'] as WireBlock[], out);
  }
}

// ─── Content serialization helpers ────────────────────────────────────────────

function serializeBlock(b: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { id: b['id'], blockType: b['blockType'] };
  for (const key of ['content', 'leadIn', 'leadOut', 'formula', 'name', 'src', 'alt', 'caption', 'size', 'quote', 'author', 'title']) {
    if (typeof b[key] === 'string') result[key] = b[key];
  }
  if (Array.isArray(b['items']))  result['items']  = b['items'];
  if (Array.isArray(b['rows']))   result['rows']   = b['rows'];
  if (Array.isArray(b['blocks'])) result['blocks'] = serializeBlocks(b['blocks'] as unknown[]);
  const target = b['target'] as { type: string; target: string } | undefined;
  if (target) { result['targetType'] = target.type; result['targetId'] = target.target; }
  if (typeof b['showTitle'] === 'boolean') result['showTitle'] = b['showTitle'];
  const sr = b['selfReference'] as { display: string } | undefined;
  if (sr && sr.display) result['selfReference'] = { display: sr.display };
  return result;
}

function serializeBlocks(blocks: unknown[]): Record<string, unknown>[] {
  return (blocks as Array<Record<string, unknown>>).map(serializeBlock);
}

function serializeRefs(raw: unknown[]): Array<Record<string, unknown>> {
  return (raw as Array<Record<string, unknown>>).map(r => {
    const tgt = r['target'] as { type: string; target: string } | undefined;
    return { id: r['id'], name: r['name'], display: r['display'], targetId: tgt?.target };
  });
}

function serializeTerms(raw: unknown[]): Array<Record<string, unknown>> {
  return (raw as Array<Record<string, unknown>>).map(t => ({
    id: t['id'], name: t['name'], display: t['display'], canonical: t['canonical'],
    synonyms: Array.isArray(t['synonyms']) ? t['synonyms'] : [],
  }));
}

// ─── Target object map builder ────────────────────────────────────────────────

function buildTargetObjects(rawRefs: unknown[], blocks: unknown[], content: LoadedContent): Record<string, ContentTargetObject> {
  const result: Record<string, ContentTargetObject> = {};
  const addTarget = (tgt: { type: string; target: string } | undefined): void => {
    const targetId = tgt?.target;
    if (!targetId || result[targetId]) return;
    if (tgt?.type === 'external') {
      result[targetId] = { id: targetId, type: 'external', label: targetId };
      return;
    }
    const targetObj = content.idToObject.get(targetId) as Record<string, unknown> | undefined;
    if (!targetObj) return;
    const type  = (targetObj['type'] as string | undefined) ?? tgt?.type ?? 'unknown';
    const label = (targetObj['title'] as string | undefined) ?? (targetObj['name'] as string | undefined) ?? targetId;
    result[targetId] = { id: targetId, type, label };
  };

  for (const r of rawRefs as Array<Record<string, unknown>>) {
    addTarget(r['target'] as { type: string; target: string } | undefined);
  }

  const walk = (bs: unknown[]): void => {
    for (const b of bs as Array<Record<string, unknown>>) {
      const bt = b['blockType'] as string | undefined;
      if (bt === 'embed' || bt === 'recall') {
        addTarget(b['target'] as { type: string; target: string } | undefined);
      }
      if (Array.isArray(b['blocks'])) walk(b['blocks'] as unknown[]);
    }
  };
  walk(blocks);

  return result;
}

// ─── Content tree builder ─────────────────────────────────────────────────────

export function buildContentTree(content: LoadedContent): Pick<GetContentTreeResponse, 'books' | 'kb'> {
  function group(id: string, label: string, children: ContentTreeItem[]): ContentTreeItem {
    return { id, type: 'group', label, isFileBacked: false, children };
  }

  function refItems(refs: Array<{ id: string; name: string; display: string; target: { target: string } }>): ContentTreeItem[] {
    return refs.map(r => ({
      id: r.id, type: 'reference' as const,
      label: `${r.name}`,
      isFileBacked: false,
      targetId: r.target.target || undefined,
      children: [],
    }));
  }

  function termItems(terms: Array<{ id: string; name: string; canonical: string }>): ContentTreeItem[] {
    return terms.map(t => ({ id: t.id, type: 'term' as const, label: `${t.name}`, isFileBacked: false, children: [] }));
  }

  function claimItems(body: Array<Record<string, unknown>>): ContentTreeItem[] {
    return body
      .filter(b => b['blockType'] === 'claim')
      .map(b => ({ id: b['id'] as string, type: 'claim' as const, label: b['name'] as string, isFileBacked: false, children: [] }));
  }

  function entityChildren(entity: Definition | Theorem | Proof | Remark): ContentTreeItem[] {
    const anyEntity = entity as unknown as Record<string, unknown>;
    const terms  = Array.isArray(anyEntity['terms']) ? anyEntity['terms'] as Array<{ id: string; name: string; canonical: string }> : [];
    const refs   = entity.references as Array<{ id: string; name: string; display: string; target: { target: string } }>;
    const body   = entity.body as unknown as Array<Record<string, unknown>>;
    return [...termItems(terms), ...claimItems(body), ...refItems(refs)];
  }

  function entityToTree(entity: Definition | Theorem | Proof | Remark): ContentTreeItem {
    const subEntityChildren: ContentTreeItem[] = [];
    if (entity.type === 'theorem') {
      for (const p of entity.proofs) subEntityChildren.push(entityToTree(p));
    }
    if (entity.type !== 'remark') {
      for (const r of (entity as { remarks?: Remark[] }).remarks ?? []) {
        subEntityChildren.push(entityToTree(r));
      }
    }
    const label = ('title' in entity && entity.title) ? entity.title : entity.name;
    return {
      id: entity.id, type: entity.type, label,
      isFileBacked: entity.filePath !== null,
      children: [...subEntityChildren, ...entityChildren(entity)],
    };
  }

  function nsToTree(ns: Namespace): ContentTreeItem {
    const children: ContentTreeItem[] = [];
    for (const sub of ns.subNamespaces) children.push(nsToTree(sub));

    const attachedProofIds  = new Set<string>();
    const attachedRemarkIds = new Set<string>();
    for (const d of ns.definitions) for (const r of d.remarks)  attachedRemarkIds.add(r.id);
    for (const t of ns.theorems) {
      for (const p of t.proofs)   attachedProofIds.add(p.id);
      for (const r of t.remarks)  attachedRemarkIds.add(r.id);
    }
    for (const p of ns.proofs) for (const r of p.remarks) attachedRemarkIds.add(r.id);

    for (const d of ns.definitions) children.push(entityToTree(d));
    for (const t of ns.theorems)    children.push(entityToTree(t));
    for (const p of ns.proofs)      if (!attachedProofIds.has(p.id))  children.push(entityToTree(p));
    for (const r of ns.remarks)     if (!attachedRemarkIds.has(r.id)) children.push(entityToTree(r));

    return { id: ns.id, type: 'namespace', label: ns.title, isFileBacked: ns.filePath !== null, children };
  }

  const books: ContentTreeItem[] = content.books.map(book => ({
    id: book.id, type: 'book', label: book.title, isFileBacked: book.filePath !== null,
    children: book.parts.map(part => ({
      id: part.id, type: 'part', label: part.title, isFileBacked: part.filePath !== null,
      children: part.chapters.map(chapter => {
        const chRefs = chapter.references as Array<{ id: string; name: string; display: string; target: { target: string } }>;
        const chChildren: ContentTreeItem[] = [
          ...(chRefs.length ? [group(`${chapter.id}:_refs`, 'References', refItems(chRefs))] : []),
          ...chapter.sections.map(section => {
            const secRefs = section.references as Array<{ id: string; name: string; display: string; target: { target: string } }>;
            return {
              id: section.id, type: 'section' as const, label: section.title, isFileBacked: section.filePath !== null,
              children: refItems(secRefs),
            };
          }),
        ];
        return { id: chapter.id, type: 'chapter', label: chapter.title, isFileBacked: chapter.filePath !== null, children: chChildren };
      }),
    })),
  }));

  return { books, kb: content.kb.map(nsToTree) };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function resolveContentRoot(context: vscode.ExtensionContext): string {
  const configured = vscode.workspace.getConfiguration('youproof').get<string>('contentRoot')?.trim();
  if (!configured) {
    throw new Error('youproof.contentRoot is not set. Add it to your workspace settings.');
  }
  if (path.isAbsolute(configured)) return configured;
  const base = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ?? path.dirname(context.extensionUri.fsPath);
  return path.join(base, configured);
}
