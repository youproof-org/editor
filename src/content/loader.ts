import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import type {
  LoadedContent,
  Book, Part, Chapter, Section,
  Namespace, Definition, Theorem, Proof, Remark,
  Term, Reference, RefTarget, RefTargetType, RefParent,
  ContentBlock, BlockParent,
  SubsectionBlock, DetailsBlock, EmbedBlock, RecallBlock,
  Labels, LabelCase,
} from './model';
import { isExternalTarget, parseFqn, type FqnKind } from './fqn';
import { normalizeStrings } from './normalize';
import { DEFAULT_LOCALE } from './locales';
import { collectBlockText } from '../protocol/blockText';
import { maskFormulas } from '../protocol/formula';

// Structural YAML files (a directory's own content object) — excluded when
// scanning a directory for child section files, which are matched by `name`.
const STRUCTURAL_YAML_FILES = new Set([
  'book.yaml', 'part.yaml', 'chapter.yaml',
  'article.yaml', 'newsletter.yaml', 'page.yaml', 'landing.yaml',
  'namespace.yaml',
]);

// ─── ID generation ────────────────────────────────────────────────────────────

function genId(): string {
  return Math.random().toString().slice(2, 18).padEnd(16, '0');
}

// A content file's locale: its `locale` field, else the default locale (so files
// predating the locale migration still load under the default).
function localeOf(data: Record<string, unknown>): string {
  const v = data['locale'];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : DEFAULT_LOCALE;
}

// ─── Canonical key helpers (match website/lib/content/graph.ts) ───────────────

function entityKey(ns: string, name: string) { return `/entities${ns}/${name}`; }
function bookKey(b: string)                   { return `/books/${b}`; }
function partKey(b: string, p: string)        { return `/books/${b}/${p}`; }
function chapterKey(b: string, p: string, c: string) { return `/books/${b}/${p}/${c}`; }
function sectionKey(b: string, p: string, c: string, s: string) { return `/books/${b}/${p}/${c}/${s}`; }

// ─── Public API ───────────────────────────────────────────────────────────────

// Loads exactly ONE locale's content: every file-backed object whose `locale`
// matches (book/namespace subtrees and KB entities in other locales are skipped),
// so the in-memory model never mixes locales. A locale with no content yields an
// empty model (no error) — that's what makes the per-locale reload buttons
// forward-compatible before other locales exist.
export function loadContent(contentRoot: string, locale: string = DEFAULT_LOCALE): LoadedContent {
  const idToFilePath = new Map<string, string>();
  const filePathToId = new Map<string, string>();
  const idToObject   = new Map<string, unknown>();
  const refPathToId  = new Map<string, string>(); // temporary; discarded after Pass 2

  type PendingEntry = { set: (r: RefTarget) => void; raw: unknown };
  const pending: PendingEntry[] = [];

  // Tracks entity lists keyed by namespace path, used in Pass 2 for wiring
  type EntityLists = { defs: Definition[]; thms: Theorem[]; proofs: Proof[]; remarks: Remark[] };
  const entityListsByNs = new Map<string, EntityLists>();
  // Temporary storage: entity id → raw name arrays for Pass 2 wiring
  const remarkNames = new Map<string, string[]>(); // entityId → remark names
  const proofNames  = new Map<string, string[]>(); // theoremId → proof names

  function registerFile(id: string, fp: string): void {
    idToFilePath.set(id, fp);
    filePathToId.set(fp, id);
  }
  function reg(id: string, obj: unknown): void { idToObject.set(id, obj); }
  function regRef(key: string, id: string): void { refPathToId.set(key, id); }

  // ─── YAML helpers ─────────────────────────────────────────────────────────────

  function readYaml(fp: string): Record<string, unknown> {
    const raw = yaml.load(fs.readFileSync(fp, 'utf-8'));
    const obj = (raw && typeof raw === 'object' && !Array.isArray(raw))
      ? (raw as Record<string, unknown>) : {};
    return normalizeStrings(obj) as Record<string, unknown>;
  }

  function readYamlArray(fp: string): string[] {
    const raw = yaml.load(fs.readFileSync(fp, 'utf-8'));
    const normalized = normalizeStrings(raw);
    return Array.isArray(normalized) ? (normalized as unknown[]).map(String) : [];
  }

  // Directory/file resolution keys off the YAML `name` field, never the folder
  // or file basename (which may carry an NN- ordering prefix). Folder names on
  // disk are arbitrary; only `name` is authoritative — mirrors the services
  // graph.ts / gen-manifest.mjs behaviour.
  function findChildDir(parentDir: string, name: string, childYaml: string): string | null {
    let entries: string[];
    try { entries = fs.readdirSync(parentDir); } catch { return null; }
    for (const e of entries) {
      const dir = path.join(parentDir, e);
      try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }
      const yamlPath = path.join(dir, childYaml);
      if (!fs.existsSync(yamlPath)) continue;
      if (readYaml(yamlPath)['name'] === name) return dir;
    }
    return null;
  }

  function findChildFile(dir: string, name: string): string | null {
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { return null; }
    for (const e of entries) {
      if (!e.endsWith('.yaml') || STRUCTURAL_YAML_FILES.has(e)) continue;
      if (readYaml(path.join(dir, e))['name'] === name) return path.join(dir, e);
    }
    return null;
  }

  function str(obj: Record<string, unknown>, key: string, fb: string): string {
    const v = obj[key]; return typeof v === 'string' ? v : fb;
  }

  function strArr(obj: Record<string, unknown>, key: string): string[] {
    const v = obj[key]; return Array.isArray(v) ? v.map(String) : [];
  }

  function parseLabels(raw: unknown): Labels | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const obj = raw as Record<string, unknown>;
    const canonical = str(obj, 'canonical', '');
    if (!canonical) return undefined;
    const cr = obj['cases'];
    const cases: Record<string, LabelCase> = {};
    if (cr && typeof cr === 'object' && !Array.isArray(cr)) {
      for (const [k, v] of Object.entries(cr as Record<string, unknown>)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const vc = v as Record<string, unknown>;
          cases[k] = {
            base:   typeof vc['base']   === 'string' ? vc['base']   : undefined,
            suffix: typeof vc['suffix'] === 'string' ? vc['suffix'] : undefined,
          };
        }
      }
    }
    return { canonical, cases: Object.keys(cases).length ? cases : undefined };
  }

  function parseLogo(raw: unknown): { src: string; alt: string } | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const obj = raw as Record<string, unknown>;
    return { src: str(obj, 'src', ''), alt: str(obj, 'alt', '') };
  }

  // ─── Term / Reference / Block loading ────────────────────────────────────────

  function sortByFirstOccurrence<T extends { name: string }>(
    items: T[], text: string, type: 'ref' | 'term',
  ): T[] {
    const masked = maskFormulas(text);
    const pos = (name: string): number => {
      const re = type === 'ref'
        ? new RegExp(`(?<!\\[)\\[${name}\\](?!\\])`)
        : new RegExp(`\\[\\[${name}\\]\\]`);
      const m = re.exec(masked);
      return m !== null ? m.index : Infinity;
    };
    return [...items].sort((a, b) => pos(a.name) - pos(b.name));
  }

  function loadTerms(rawMap: unknown, parent: Definition | Theorem | Remark): Term[] {
    if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return [];
    return Object.entries(rawMap as Record<string, unknown>).flatMap(([key, v]) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
      const obj = v as Record<string, unknown>;
      const id  = genId();
      const synonyms = Array.isArray(obj['synonyms'])
        ? (obj['synonyms'] as unknown[]).filter((s): s is string => typeof s === 'string')
        : [];
      const term: Term = { id, name: key, display: str(obj, 'display', ''), canonical: str(obj, 'canonical', key), synonyms, parent };
      reg(id, term);
      return [term];
    });
  }

  // A target is a STRING now — a fully qualified name or a URL. The object guard
  // this used to have silently dropped every one of them.
  function enqueueTarget(rawTarget: unknown, set: (r: RefTarget) => void): void {
    if (typeof rawTarget !== 'string' || !rawTarget.trim()) return;
    pending.push({ set, raw: rawTarget });
  }

  function loadRefs(rawMap: unknown, parent: RefParent): Reference[] {
    if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return [];
    return Object.entries(rawMap as Record<string, unknown>).flatMap(([key, v]) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
      const obj = v as Record<string, unknown>;
      const id  = genId();
      const ref: Reference = { id, name: key, display: str(obj, 'display', ''), target: { type: 'external', target: '' }, parent };
      reg(id, ref);
      enqueueTarget(obj['target'], r => { ref.target = r; });
      return [ref];
    });
  }

  function loadBlocks(rawList: unknown, parent: BlockParent): ContentBlock[] {
    if (!Array.isArray(rawList)) return [];
    const result: ContentBlock[] = [];
    for (const rawBlock of rawList) {
      if (!rawBlock || typeof rawBlock !== 'object' || Array.isArray(rawBlock)) continue;
      const b = rawBlock as Record<string, unknown>;
      const blockType = str(b, 'type', '');
      const context   = b['context'] === 'web' ? ('web' as const)
                      : b['context'] === 'latex' ? ('latex' as const)
                      : undefined;
      const id = genId();
      let block: ContentBlock | null = null;

      switch (blockType) {
        case 'narrative':
          block = { id, blockType: 'narrative', content: str(b, 'content', ''), context, parent }; break;
        case 'formula':
          block = { id, blockType: 'formula', leadIn: b['lead-in'] as string | undefined, content: str(b, 'content', ''), leadOut: b['lead-out'] as string | undefined, context, parent }; break;
        case 'figure': {
          const sr = b['self-reference'];
          block = {
            id, blockType: 'figure',
            leadIn: b['lead-in'] as string | undefined,
            src: str(b, 'src', ''),
            alt: b['alt'] as string | undefined,
            caption: b['caption'] as string | undefined,
            size: ['small', 'medium', 'large'].includes(b['size'] as string) ? b['size'] as 'small' | 'medium' | 'large' : undefined,
            selfReference: sr && typeof sr === 'object' && !Array.isArray(sr)
              ? { display: str(sr as Record<string, unknown>, 'display', '') } : undefined,
            context, parent,
          }; break;
        }
        case 'ordered-list':
          block = { id, blockType: 'ordered-list', leadIn: b['lead-in'] as string | undefined, items: Array.isArray(b['items']) ? b['items'].map(String) : [], context, parent }; break;
        case 'unordered-list':
          block = { id, blockType: 'unordered-list', leadIn: b['lead-in'] as string | undefined, items: Array.isArray(b['items']) ? b['items'].map(String) : [], context, parent }; break;
        case 'typewriter':
          block = { id, blockType: 'typewriter', leadIn: b['lead-in'] as string | undefined, rows: Array.isArray(b['rows']) ? b['rows'].map(String) : [], context, parent }; break;
        case 'quote':
          block = { id, blockType: 'quote', leadIn: b['lead-in'] as string | undefined, quote: str(b, 'quote', ''), author: b['author'] as string | undefined, context, parent }; break;
        case 'subsection': {
          const sub: SubsectionBlock = { id, blockType: 'subsection', title: str(b, 'title', ''), blocks: [], context, parent };
          sub.blocks = loadBlocks(b['blocks'], sub);
          block = sub; break;
        }
        case 'details': {
          const det: DetailsBlock = { id, blockType: 'details', title: b['title'] as string | undefined, blocks: [], context, parent };
          det.blocks = loadBlocks(b['blocks'], det);
          block = det; break;
        }
        case 'embed': {
          const emb: EmbedBlock = {
            id, blockType: 'embed',
            target: { type: 'external', target: '' },
            context, parent,
            ...(typeof b['show-title'] === 'boolean' ? { showTitle: b['show-title'] as boolean } : {}),
          };
          enqueueTarget(b['target'], r => { emb.target = r; });
          block = emb; break;
        }
        case 'recall': {
          const rec: RecallBlock = { id, blockType: 'recall', target: { type: 'external', target: '' }, context, parent };
          enqueueTarget(b['target'], r => { rec.target = r; });
          block = rec; break;
        }
        case 'claim':
          block = { id, blockType: 'claim', name: str(b, 'name', id), content: str(b, 'content', ''), formula: b['formula'] as string | undefined, context, parent }; break;
        default: continue;
      }

      reg(id, block);
      result.push(block);
    }
    return result;
  }

  // ─── Books ───────────────────────────────────────────────────────────────────

  function loadBooks(booksDir: string): Book[] {
    let names: string[];
    try { names = readYamlArray(path.join(booksDir, 'episodes.yaml')); } catch { return []; }
    return names.map(n => loadBook(booksDir, n)).filter((b): b is Book => b !== null);
  }

  function loadBook(booksDir: string, bookName: string): Book | null {
    const bookDir  = path.join(booksDir, bookName);
    const bookYaml = path.join(bookDir, 'book.yaml');
    try {
      const data = readYaml(bookYaml);
      if (localeOf(data) !== locale) return null; // book (and its subtree) belongs to another locale
      const id   = genId();
      const book: Book = {
        id, filePath: bookYaml, type: 'book',
        name: bookName, title: str(data, 'title', bookName), locale: localeOf(data),
        logo: parseLogo(data['logo']), parts: [],
      };
      registerFile(id, bookYaml); reg(id, book); regRef(bookKey(bookName), id);
      book.parts = strArr(data, 'parts')
        .map(p => loadPart(bookDir, p, bookName, book))
        .filter((p): p is Part => p !== null);
      return book;
    } catch { return null; }
  }

  function loadPart(bookDir: string, partName: string, bookName: string, book: Book): Part | null {
    const partDir  = findChildDir(bookDir, partName, 'part.yaml');
    if (!partDir) return null;
    const partYaml = path.join(partDir, 'part.yaml');
    try {
      const data = readYaml(partYaml);
      const id   = genId();
      const part: Part = {
        id, filePath: partYaml, type: 'part',
        name: partName, title: str(data, 'title', partName), locale: localeOf(data),
        chapters: [], book,
      };
      registerFile(id, partYaml); reg(id, part); regRef(partKey(bookName, partName), id);
      part.chapters = strArr(data, 'chapters')
        .map(c => loadChapter(partDir, c, partName, bookName, part))
        .filter((c): c is Chapter => c !== null);
      return part;
    } catch { return null; }
  }

  function loadChapter(
    partDir: string, chapterName: string, partName: string, bookName: string, part: Part,
  ): Chapter | null {
    const chapterDir  = findChildDir(partDir, chapterName, 'chapter.yaml');
    if (!chapterDir) return null;
    const chapterYaml = path.join(chapterDir, 'chapter.yaml');
    try {
      const data = readYaml(chapterYaml);
      const id   = genId();
      const chapter: Chapter = {
        id, filePath: chapterYaml, type: 'chapter',
        name: chapterName, title: str(data, 'title', chapterName), locale: localeOf(data),
        thumbnail: parseLogo(data['thumbnail']),
        references: [], abstract: [], prerequisiteWarning: [],
        prologue: [], sections: [], epilogue: [], part,
      };
      registerFile(id, chapterYaml); reg(id, chapter); regRef(chapterKey(bookName, partName, chapterName), id);
      chapter.references          = loadRefs(data['references'], chapter);
      chapter.abstract            = loadBlocks(data['abstract'], chapter);
      chapter.prerequisiteWarning = loadBlocks(data['prerequisite-warning'], chapter);
      chapter.prologue            = loadBlocks(data['prologue'], chapter);
      chapter.epilogue            = loadBlocks(data['epilogue'], chapter);
      const chText = collectBlockText([...chapter.abstract, ...chapter.prerequisiteWarning, ...chapter.prologue, ...chapter.epilogue]);
      chapter.references = sortByFirstOccurrence(chapter.references, chText, 'ref');
      chapter.sections = strArr(data, 'sections')
        .map(s => loadSection(chapterDir, s, chapterName, partName, bookName, chapter))
        .filter((s): s is Section => s !== null);
      return chapter;
    } catch { return null; }
  }

  function loadSection(
    chapterDir: string, sectionName: string,
    chapterName: string, partName: string, bookName: string, chapter: Chapter,
  ): Section | null {
    const sectionFile = findChildFile(chapterDir, sectionName);
    if (!sectionFile) return null;
    try {
      const data = readYaml(sectionFile);
      const id   = genId();
      const section: Section = {
        id, filePath: sectionFile, type: 'section',
        name: sectionName, title: str(data, 'title', sectionName), locale: localeOf(data),
        references: [], body: [], chapter,
      };
      registerFile(id, sectionFile); reg(id, section); regRef(sectionKey(bookName, partName, chapterName, sectionName), id);
      section.references = loadRefs(data['references'], section);
      section.body       = loadBlocks(data['body'], section);
      section.references = sortByFirstOccurrence(section.references, collectBlockText(section.body), 'ref');
      return section;
    } catch { return null; }
  }

  // ─── Knowledge base ───────────────────────────────────────────────────────────

  function loadKnowledgeBase(kbDir: string): Namespace[] {
    let entries: string[];
    try { entries = fs.readdirSync(kbDir); } catch { return []; }
    return entries
      .filter(e => { try { return fs.statSync(path.join(kbDir, e)).isDirectory(); } catch { return false; } })
      .map(e => loadNamespace(path.join(kbDir, e), null, ''))
      .filter((n): n is Namespace => n !== null);
  }

  const ENTITY_FOLDERS = ['definitions', 'theorems', 'proofs', 'remarks'] as const;

  function loadNamespace(nsDir: string, parentNs: Namespace | null, parentNsPath: string): Namespace | null {
    try {
      const nsYaml = path.join(nsDir, 'namespace.yaml');
      let name     = path.basename(nsDir).replace(/^\d+-/, '');
      let title    = name;
      let nsFilePath: string | null = null;
      // Fileless (purely structural) namespaces adopt the active locale; a
      // file-backed one takes its own `locale` (default locale if unset).
      let nsLocale = locale;

      if (fs.existsSync(nsYaml)) {
        try {
          const data = readYaml(nsYaml);
          name       = str(data, 'name', name);
          title      = str(data, 'title', name);
          nsFilePath = nsYaml;
          nsLocale   = localeOf(data);
        } catch { /* keep defaults */ }
      }

      // A file-backed namespace in another locale is not part of this model —
      // skip its whole subtree.
      if (nsFilePath && nsLocale !== locale) return null;

      const nsPath = `${parentNsPath}/${name}`;
      const id     = genId();
      const ns: Namespace = {
        id, filePath: nsFilePath, type: 'namespace',
        name, title, locale: nsLocale,
        subNamespaces: [], definitions: [], theorems: [], proofs: [], remarks: [],
        parent: parentNs,
      };
      reg(id, ns);
      if (nsFilePath) registerFile(id, nsFilePath);

      const lists: EntityLists = { defs: [], thms: [], proofs: [], remarks: [] };

      for (const folder of ENTITY_FOLDERS) {
        const folderPath = path.join(nsDir, folder);
        if (!fs.existsSync(folderPath)) continue;
        let files: string[];
        try { files = fs.readdirSync(folderPath).filter(f => f.endsWith('.yaml')); } catch { continue; }
        for (const f of files) {
          const entity = loadEntity(path.join(folderPath, f), folder, nsPath, ns);
          if (!entity) continue;
          if (folder === 'definitions') { lists.defs.push(entity as Definition);   ns.definitions.push(entity as Definition); }
          if (folder === 'theorems')    { lists.thms.push(entity as Theorem);      ns.theorems.push(entity as Theorem); }
          if (folder === 'proofs')      { lists.proofs.push(entity as Proof);      ns.proofs.push(entity as Proof); }
          if (folder === 'remarks')     { lists.remarks.push(entity as Remark);    ns.remarks.push(entity as Remark); }
        }
      }

      entityListsByNs.set(nsPath, lists);

      let entries: string[];
      try { entries = fs.readdirSync(nsDir); } catch { entries = []; }
      for (const entry of entries) {
        if (ENTITY_FOLDERS.includes(entry as typeof ENTITY_FOLDERS[number])) continue;
        if (entry.endsWith('.yaml')) continue;
        const entryPath = path.join(nsDir, entry);
        try { if (!fs.statSync(entryPath).isDirectory()) continue; } catch { continue; }
        const sub = loadNamespace(entryPath, ns, nsPath);
        if (sub) ns.subNamespaces.push(sub);
      }

      if (!nsFilePath && !ns.subNamespaces.length
          && !lists.defs.length && !lists.thms.length
          && !lists.proofs.length && !lists.remarks.length) {
        return null;
      }
      return ns;
    } catch { return null; }
  }

  function loadEntity(
    filePath: string,
    folder: typeof ENTITY_FOLDERS[number],
    nsPath: string,
    namespace: Namespace,
  ): Definition | Theorem | Proof | Remark | null {
    try {
      const data = readYaml(filePath);
      if (localeOf(data) !== locale) return null; // entity belongs to another locale
      const name = str(data, 'name', path.basename(filePath, '.yaml').replace(/^\d+-/, ''));
      const id   = genId();
      const key  = entityKey(nsPath, name);

      if (folder === 'definitions') {
        const def: Definition = {
          id, filePath, type: 'definition', name, namespacePath: nsPath, locale: localeOf(data),
          title: data['title'] as string | undefined,
          labels: parseLabels(data['labels']),
          terms: [], references: [], body: [], remarks: [], namespace,
        };
        registerFile(id, filePath); reg(id, def); regRef(key, id);
        def.terms      = loadTerms(data['terms'], def);
        def.references = loadRefs(data['references'], def);
        def.body       = loadBlocks(data['body'], def);
        const defText  = collectBlockText(def.body);
        def.terms      = sortByFirstOccurrence(def.terms,      defText, 'term');
        def.references = sortByFirstOccurrence(def.references, defText, 'ref');
        remarkNames.set(id, strArr(data, 'remarks'));
        return def;
      }

      if (folder === 'theorems') {
        const thm: Theorem = {
          id, filePath, type: 'theorem', name, namespacePath: nsPath, locale: localeOf(data),
          title: data['title'] as string | undefined,
          labels: parseLabels(data['labels']),
          terms: [], references: [], body: [], proofs: [], remarks: [], namespace,
        };
        registerFile(id, filePath); reg(id, thm); regRef(key, id);
        thm.terms      = loadTerms(data['terms'], thm);
        thm.references = loadRefs(data['references'], thm);
        thm.body       = loadBlocks(data['body'], thm);
        const thmText  = collectBlockText(thm.body);
        thm.terms      = sortByFirstOccurrence(thm.terms,      thmText, 'term');
        thm.references = sortByFirstOccurrence(thm.references, thmText, 'ref');
        proofNames.set(id, strArr(data, 'proofs'));
        remarkNames.set(id, strArr(data, 'remarks'));
        return thm;
      }

      if (folder === 'proofs') {
        const proof: Proof = {
          id, filePath, type: 'proof', name, namespacePath: nsPath, locale: localeOf(data),
          references: [], body: [], remarks: [], namespace,
        };
        registerFile(id, filePath); reg(id, proof); regRef(key, id);
        proof.references = loadRefs(data['references'], proof);
        proof.body       = loadBlocks(data['body'], proof);
        proof.references = sortByFirstOccurrence(proof.references, collectBlockText(proof.body), 'ref');
        remarkNames.set(id, strArr(data, 'remarks'));
        return proof;
      }

      // remarks
      const rem: Remark = {
        id, filePath, type: 'remark', name, namespacePath: nsPath, locale: localeOf(data),
        terms: [], references: [], body: [], namespace,
      };
      registerFile(id, filePath); reg(id, rem); regRef(key, id);
      rem.terms      = loadTerms(data['terms'], rem);
      rem.references = loadRefs(data['references'], rem);
      rem.body       = loadBlocks(data['body'], rem);
      const remText  = collectBlockText(rem.body);
      rem.terms      = sortByFirstOccurrence(rem.terms,      remText, 'term');
      rem.references = sortByFirstOccurrence(rem.references, remText, 'ref');
      return rem;
    } catch { return null; }
  }

  // ─── Pass 1 execution ─────────────────────────────────────────────────────────

  const books = loadBooks(path.join(contentRoot, 'books'));
  const kb    = loadKnowledgeBase(path.join(contentRoot, 'knowledge-base'));

  // ─── Pass 2 — resolve entity links and reference targets ─────────────────────

  for (const [, lists] of entityListsByNs) {
    const remarkByName = new Map(lists.remarks.map(r => [r.name, r]));
    const proofByName  = new Map(lists.proofs.map(p => [p.name, p]));

    for (const def of lists.defs) {
      def.remarks = (remarkNames.get(def.id) ?? []).map(n => remarkByName.get(n)).filter((r): r is Remark => !!r);
    }
    for (const thm of lists.thms) {
      thm.proofs  = (proofNames.get(thm.id)  ?? []).map(n => proofByName.get(n)).filter((p): p is Proof => !!p);
      thm.remarks = (remarkNames.get(thm.id) ?? []).map(n => remarkByName.get(n)).filter((r): r is Remark => !!r);
    }
    for (const proof of lists.proofs) {
      proof.remarks = (remarkNames.get(proof.id) ?? []).map(n => remarkByName.get(n)).filter((r): r is Remark => !!r);
    }
  }

  // Root indexes for target resolution. Definitions and theorems are addressed
  // flat (their names are unique per type), so a name index is all the walk needs
  // to start from; everything else is reached by stepping down from them.
  const defsByName = new Map<string, Definition>();
  const thmsByName = new Map<string, Theorem>();
  for (const [, lists] of entityListsByNs) {
    for (const d of lists.defs) defsByName.set(d.name, d);
    for (const t of lists.thms) thmsByName.set(t.name, t);
  }

  for (const { set, raw } of pending) {
    set(resolveTarget(raw, { books, defsByName, thmsByName }));
  }

  return { books, kb, idToFilePath, filePathToId, idToObject };
}

// ─── Reference target resolution (Pass 2) ────────────────────────────────────

/**
 * Resolve a reference target string.
 *
 * A target is now a single string: a URL, or a fully qualified name like
 * `theorems.{t}.proofs.{p}.terms.{x}`. Resolution WALKS the loaded object graph
 * step by step rather than looking up a flat key, which is stricter for free — a
 * path naming a proof that is not actually that theorem's proof fails to resolve
 * instead of quietly finding the proof anyway.
 *
 * Runs in Pass 2, after ownership is wired, which is what makes the walk possible.
 *
 * Anything well-formed that this editor does not model — an article, page, landing,
 * book or part — comes back as `unresolved` WITH its path intact, so the writer can
 * put it back untouched. Returning an empty external instead is what used to delete
 * those targets on save.
 */
function resolveTarget(
  raw: unknown,
  roots: {
    books: Book[]
    defsByName: Map<string, Definition>
    thmsByName: Map<string, Theorem>
  },
): RefTarget {
  if (typeof raw !== 'string') return { type: 'external', target: '' };
  const target = raw.trim();
  if (isExternalTarget(target)) return { type: 'external', target };

  const steps = parseFqn(target);
  if (!steps) return { type: 'unresolved', target: '', fqn: target };

  const unresolved: RefTarget = { type: 'unresolved', target: '', fqn: target };
  const found = (type: RefTargetType, id: unknown): RefTarget =>
    typeof id === 'string' && id
      ? { type, target: id, fqn: target }
      : unresolved;

  // Walk from the root. `node` is whatever the previous step resolved to.
  let node: Record<string, unknown> | undefined;
  for (let i = 0; i < steps.length; i++) {
    const { kind, name } = steps[i];
    const last = i === steps.length - 1;

    if (i === 0) {
      if (kind === 'book') {
        node = roots.books.find(b => b.name === name) as unknown as Record<string, unknown>;
      } else if (kind === 'definition') {
        node = roots.defsByName.get(name) as unknown as Record<string, unknown>;
      } else if (kind === 'theorem') {
        node = roots.thmsByName.get(name) as unknown as Record<string, unknown>;
      } else {
        return unresolved; // article / page / landing: not modelled here
      }
      if (!node) return unresolved;
      if (last) return found(kind as RefTargetType, node['id']);
      continue;
    }

    const child = childOf(node, kind, name);
    if (!child) return unresolved;
    node = child;
    if (last) return found(kind as RefTargetType, node['id']);
  }
  return unresolved;
}

/** One step down from `node` into its `kind` children, by name. */
function childOf(
  node: Record<string, unknown> | undefined,
  kind: FqnKind,
  name: string,
): Record<string, unknown> | undefined {
  if (!node) return undefined;
  const list = (key: string): Record<string, unknown>[] =>
    Array.isArray(node[key]) ? (node[key] as Record<string, unknown>[]) : [];

  switch (kind) {
    case 'part':
      return list('parts').find(p => p['name'] === name);
    // A chapter hangs off its BOOK, not its part: chapter URLs flatten the part
    // out, so a chapter moving between parts must not change how it is referenced.
    case 'chapter':
      return list('parts').flatMap(p => (Array.isArray(p['chapters']) ? p['chapters'] as Record<string, unknown>[] : []))
        .find(c => c['name'] === name);
    case 'section':
      return list('sections').find(sec => sec['name'] === name);
    case 'proof':
      return list('proofs').find(pf => pf['name'] === name);
    case 'remark':
      return list('remarks').find(r => r['name'] === name);
    case 'term':
      return list('terms').find(t => t['name'] === name);
    case 'claim':
      return claimsOf(node).find(c => c['name'] === name);
    default:
      return undefined;
  }
}

/** Claim blocks in a node's body, including ones nested in subsections/details. */
function claimsOf(node: Record<string, unknown>): Record<string, unknown>[] {
  const walk = (blocks: unknown): Record<string, unknown>[] => {
    if (!Array.isArray(blocks)) return [];
    return blocks.flatMap(b => {
      const block = b as Record<string, unknown>;
      const nested = walk(block['blocks']);
      return block['blockType'] === 'claim' ? [block, ...nested] : nested;
    });
  };
  return walk(node['body']);
}
