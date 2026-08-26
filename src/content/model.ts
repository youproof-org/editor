// ─── Shared primitives ────────────────────────────────────────────────────────

export type NodeType =
  | 'book' | 'part' | 'chapter' | 'section'
  | 'namespace'
  | 'definition' | 'theorem' | 'proof' | 'remark';

export interface LabelCase { base?: string; suffix?: string; }
export interface Labels { canonical: string; cases?: Record<string, LabelCase>; }

// ─── Term (inline, no file) ───────────────────────────────────────────────────

export interface Term {
  id: string;
  name: string;
  display: string;
  canonical: string;
  synonyms: string[];
  parent: Definition | Theorem | Remark;
}

// ─── Reference target ─────────────────────────────────────────────────────────

export type RefTargetType =
  | 'chapter' | 'section'
  | 'definition' | 'theorem' | 'proof' | 'remark'
  | 'claim' | 'term'
  | 'external'
  // A well-formed target this editor cannot resolve, because it models only books
  // and the knowledge base — a reference to an article, page, landing, book or part.
  // Modelled explicitly so it can be written back untouched instead of being
  // mistaken for an empty external and dropped; see RefTarget.fqn.
  | 'unresolved';

/**
 * A reference target.
 *
 * `target` is the resolved ID of the referenced object, or the URL when
 * `type === 'external'`, or empty when unresolved.
 *
 * `fqn` is the path exactly as authored, kept for every non-external target. It is
 * what makes an unresolved target survive a save: the editor rebuilds a resolved
 * target's path from the object graph (so it follows a rename), and writes this
 * back verbatim when there is nothing to rebuild from. Without it, a reference the
 * editor does not model loses its target on the first save — which is what used to
 * happen to every article, page, landing and book reference.
 */
export interface RefTarget {
  type: RefTargetType;
  target: string;
  fqn?: string;
}

// ─── Reference (inline, no file) ─────────────────────────────────────────────

export type RefParent = Chapter | Section | Definition | Theorem | Proof | Remark;

export interface Reference {
  id: string;
  name: string;
  display: string;
  target: RefTarget;
  parent: RefParent;
}

// ─── Content blocks ───────────────────────────────────────────────────────────

export type BlockParent =
  | Chapter | Section | Definition | Theorem | Proof | Remark
  | SubsectionBlock | DetailsBlock;

interface BlockBase {
  id: string;
  context?: 'web' | 'latex';
  parent: BlockParent;
}

export interface NarrativeBlock    extends BlockBase { blockType: 'narrative';      content: string; }
export interface FormulaBlock      extends BlockBase { blockType: 'formula';        leadIn?: string; content: string; leadOut?: string; }
export interface FigureBlock       extends BlockBase {
  blockType: 'figure';
  leadIn?: string; src: string; alt?: string; caption?: string;
  size?: 'small' | 'medium' | 'large';
  selfReference?: { display: string };
}
export interface OrderedListBlock  extends BlockBase { blockType: 'ordered-list';   leadIn?: string; items: string[]; }
export interface UnorderedListBlock extends BlockBase { blockType: 'unordered-list'; leadIn?: string; items: string[]; }
export interface TypewriterBlock   extends BlockBase { blockType: 'typewriter';     leadIn?: string; rows: string[]; }
export interface QuoteBlock        extends BlockBase { blockType: 'quote';          leadIn?: string; quote: string; author?: string; }
export interface SubsectionBlock   extends BlockBase { blockType: 'subsection';     title: string; blocks: ContentBlock[]; }
export interface DetailsBlock      extends BlockBase { blockType: 'details';        title?: string; blocks: ContentBlock[]; }
export interface EmbedBlock        extends BlockBase { blockType: 'embed';          target: RefTarget; showTitle?: boolean; }
export interface RecallBlock       extends BlockBase { blockType: 'recall';         target: RefTarget; }
export interface ClaimBlock        extends BlockBase { blockType: 'claim';          name: string; content: string; formula?: string; }

export type ContentBlock =
  | NarrativeBlock | FormulaBlock | FigureBlock
  | OrderedListBlock | UnorderedListBlock | TypewriterBlock | QuoteBlock
  | SubsectionBlock | DetailsBlock
  | EmbedBlock | RecallBlock | ClaimBlock;

// ─── Book hierarchy ───────────────────────────────────────────────────────────

// NOTE: `locale` mirrors the shared content schema (services:
// apps/website/lib/content/types.ts). It is modelled here because the editor
// loads/edits exactly one locale at a time (see loader.ts's locale filter).
//
// `slug` is intentionally NOT modelled — the editor does not build URLs. It is
// nonetheless PRESERVED on save, and that now covers three places rather than
// one, because the knowledge base grew public per-node URLs:
//   * entity level (definition/theorem/proof/remark, plus chapter/section) —
//     saveFromModel merges into the loaded YAML instead of reconstructing it, so
//     an unmodelled top-level key survives on its own; CANONICAL_ORDER lists
//     `slug` so it also keeps its position in the file.
//   * `claim` blocks and `terms` entries — these ARE reconstructed field by field
//     on save, so their `slug` has to be copied across explicitly, keyed by the
//     claim/term name. See collectClaimSlugs in handlers.ts.
// Adding a new unmodelled sub-field to a claim or a term means extending that
// copy step too, or the first save in the editor deletes it.

export interface Book {
  id: string; filePath: string; type: 'book';
  name: string; title: string; locale: string;
  logo?: { src: string; alt: string };
  parts: Part[];
}

export interface Part {
  id: string; filePath: string; type: 'part';
  name: string; title: string; locale: string;
  chapters: Chapter[];
  book: Book;
}

export interface Chapter {
  id: string; filePath: string; type: 'chapter';
  name: string; title: string; locale: string;
  thumbnail?: { src: string; alt: string };
  references: Reference[];
  abstract: ContentBlock[];
  prerequisiteWarning: ContentBlock[];
  prologue: ContentBlock[];
  sections: Section[];
  epilogue: ContentBlock[];
  part: Part;
}

export interface Section {
  id: string; filePath: string; type: 'section';
  name: string; title: string; locale: string;
  references: Reference[];
  body: ContentBlock[];
  chapter: Chapter;
}

// ─── Knowledge base ───────────────────────────────────────────────────────────

export interface Namespace {
  id: string; filePath: string | null; type: 'namespace';
  name: string; title: string; locale: string;
  subNamespaces: Namespace[];
  definitions: Definition[];
  theorems: Theorem[];
  proofs: Proof[];
  remarks: Remark[];
  parent: Namespace | null;
}

export interface Definition {
  id: string; filePath: string; type: 'definition';
  name: string; namespacePath: string; locale: string;
  title?: string; labels?: Labels;
  terms: Term[];
  references: Reference[];
  body: ContentBlock[];
  remarks: Remark[];
  namespace: Namespace;
}

export interface Theorem {
  id: string; filePath: string; type: 'theorem';
  name: string; namespacePath: string; locale: string;
  title?: string; labels?: Labels;
  terms: Term[];
  references: Reference[];
  body: ContentBlock[];
  proofs: Proof[];
  remarks: Remark[];
  namespace: Namespace;
}

export interface Proof {
  id: string; filePath: string; type: 'proof';
  name: string; namespacePath: string; locale: string;
  references: Reference[];
  body: ContentBlock[];
  remarks: Remark[];
  namespace: Namespace;
}

export interface Remark {
  id: string; filePath: string; type: 'remark';
  name: string; namespacePath: string; locale: string;
  terms: Term[];
  references: Reference[];
  body: ContentBlock[];
  namespace: Namespace;
}

// ─── Top-level container ──────────────────────────────────────────────────────

export interface LoadedContent {
  books: Book[];
  kb: Namespace[];
  /** Maps IDs of file-backed objects to their YAML file paths. */
  idToFilePath: Map<string, string>;
  /** Maps YAML file paths to the IDs of their corresponding objects. */
  filePathToId: Map<string, string>;
  /** Maps all object IDs (including inline objects) to their objects. */
  idToObject: Map<string, unknown>;
}
