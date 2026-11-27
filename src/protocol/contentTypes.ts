// ─── Sidebar tree ──────────────────────────────────────────────────────────────

export type NodeType =
  | 'book' | 'part' | 'chapter' | 'section'
  | 'namespace'
  | 'definition' | 'theorem' | 'proof' | 'remark';

export interface ContentTreeItem {
  id: string;
  type: NodeType | 'group' | 'term' | 'claim';
  label: string;
  isFileBacked: boolean;
  children: ContentTreeItem[];
}

// ─── Request types ─────────────────────────────────────────────────────────────

export interface GetContentObjectRequest      { id: string; }
/** `openedFrom` names the panel that opens the object as one of its targets: that panel is kept open beside it. */
export interface SelectContentObjectRequest   { id: string; permanent?: boolean; openedFrom?: string; }
export interface SaveRecursivelyRequest       { ids: string[]; }
export interface OpenContentObjectFileRequest { id: string; }
export interface SetContentObjectDirtyRequest { id: string; }
/** Reload the model; `locale` switches the loaded locale (default: reload current). */
export interface ReloadModelRequest           { locale?: string; }
export interface BeginSelectTargetRequest     { selectorId: string; allowedTypes: string[]; }
export interface EndSelectTargetRequest       { targetId: string | null; }
export interface OpenExternalUrlRequest                  { url: string; }
export interface GetSelfReferenceDisplaySuggestionsRequest  { /* empty */ }
export interface GetSelfReferenceDisplaySuggestionsResponse { suggestions: string[]; }
/** Render held reference tokens, named by their payloads, as they render in the file `id`. */
export interface ResolveReferenceTokensRequest { id: string; payloads: string[]; }
export interface ResolveReferenceTokensResponse { displays: Record<string, ReferenceTokenDisplay>; }
/** What the reference popup of the panel `id` offers: the display templates and the targets of the loaded content. */
export interface GetReferenceChoicesRequest { id: string; }
export type GetReferenceChoicesResponse = ReferenceChoices;

interface SaveObjectBase { id: string; }

export interface SaveDefinitionObjectRequest extends SaveObjectBase { entityType: 'definition'; body: ContentBlock[]; terms: ContentTerm[]; label?: string; }
export interface SaveTheoremObjectRequest    extends SaveObjectBase { entityType: 'theorem';    body: ContentBlock[]; terms: ContentTerm[]; label?: string; }
export interface SaveProofObjectRequest      extends SaveObjectBase { entityType: 'proof';      body: ContentBlock[]; label?: string; }
export interface SaveRemarkObjectRequest     extends SaveObjectBase { entityType: 'remark';     body: ContentBlock[]; terms: ContentTerm[]; label?: string; }
export interface SaveSectionObjectRequest    extends SaveObjectBase { entityType: 'section';    body: ContentBlock[]; }
export interface SaveChapterObjectRequest    extends SaveObjectBase {
  entityType: 'chapter';
  abstract: ContentBlock[];
  prerequisiteWarning: ContentBlock[];
  prologue: ContentBlock[];
  epilogue: ContentBlock[];
}

export type SaveContentObjectRequest =
  | SaveDefinitionObjectRequest
  | SaveTheoremObjectRequest
  | SaveProofObjectRequest
  | SaveRemarkObjectRequest
  | SaveSectionObjectRequest
  | SaveChapterObjectRequest;

// ─── Response types ────────────────────────────────────────────────────────────

// `locales` = configured locale codes (one reload button each); `activeLocale`
// = the locale currently loaded in the model.
export interface GetContentTreeResponse { books: ContentTreeItem[]; kb: ContentTreeItem[]; selectedId: string | null; locales: string[]; activeLocale: string; }
export interface ReloadModelResponse    { books: ContentTreeItem[]; kb: ContentTreeItem[]; selectedId: string | null; locales: string[]; activeLocale: string; }

/** `path` is set on a sidebar pick of something a reference can target: what an item's `target` holds for it. */
export interface ContentTargetObject { id: string; type: string; label: string; path?: string; }

export interface GetContentObjectResponse {
  contentObject: ContentObjectData;
  targetObjects: Record<string, ContentTargetObject>;
}

// ─── Reference displays ────────────────────────────────────────────────────────

/** A piece of a rendered reference: plain words, or a link to the target named by its fully qualified name or URL. */
export type ReferenceTokenSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; target: string };

/** A reference as the site renders it, before sentence-start capitalization, or why the site can't render it. */
export type ReferenceTokenDisplay =
  | { segments: ReferenceTokenSegment[]; error?: undefined }
  | { segments?: undefined; error: string };

// ─── Reference choices ─────────────────────────────────────────────────────────

/** A display template as the reference popup offers it. */
export interface DisplayTemplateChoice {
  name: string;
  /** The target kinds it accepts. */
  targets: string[];
  /** A single template takes exactly one target. */
  count: { min: number; max?: number };
  list: boolean;
  order: 'sorted' | 'authored';
  groupBy?: 'label' | 'parent' | 'type';
  /** Uses in the loaded content, by the kinds of an item's targets, sorted and joined by '+'. */
  uses: Record<string, number>;
}

export type ReferenceTargetKind = 'chapter' | 'section' | 'definition' | 'theorem' | 'proof' | 'remark' | 'claim' | 'term';

/** Something the loaded content holds that a reference can target. */
export interface ReferenceTargetChoice {
  /** What an item's `target` holds for it. */
  path: string;
  kind: ReferenceTargetKind;
  /** The model id, for opening it and for matching a sidebar pick. */
  id: string;
  /** Its number and label, such as `24.16. Tétel`, `23.5.` or `23.`, a claim's number, or a term's canonical form. */
  label: string;
  title?: string;
  /** For a claim, a term, a proof and a remark that belongs to an entity: the owner's label. */
  owner?: string;
  /** For an entity: its label variant's canonical form, capitalized, which a template grouping by label groups under. */
  labelName?: string;
  /** Its place in reading order; absent for what nothing embeds. */
  position?: number;
  /** What it shares with the other targets of a group, for each `group-by`. */
  groups: { type?: string; parent?: string; label?: string };
  synonyms?: string[];
  /** For a term: the link texts the loaded references use for it, most used first. */
  texts?: { text: string; uses: number }[];
  /** Why its number can't be trusted, when missing content could change it. */
  problem?: string;
}

export interface ReferenceChoices {
  /** In the collection's order. */
  templates: DisplayTemplateChoice[];
  /** In reading order, an entity followed by its claims and terms, then what nothing embeds. */
  targets: ReferenceTargetChoice[];
  /** Why there is nothing to offer, when references can't be rendered at all. */
  error?: string;
}

// ─── Content block types ───────────────────────────────────────────────────────

interface ContentBlockBase { id: string; }

export interface ContentNarrativeBlock     extends ContentBlockBase { blockType: 'narrative';       content: string; }
export interface ContentFormulaBlock       extends ContentBlockBase { blockType: 'formula';         leadIn?: string; content: string; leadOut?: string; }
export interface ContentClaimBlock         extends ContentBlockBase { blockType: 'claim';           name: string; slug: string; content: string; formula?: string; }
export interface ContentOrderedListBlock   extends ContentBlockBase { blockType: 'ordered-list';    leadIn?: string; items: string[]; }
export interface ContentUnorderedListBlock extends ContentBlockBase { blockType: 'unordered-list';  leadIn?: string; items: string[]; }
export interface ContentTypewriterBlock    extends ContentBlockBase { blockType: 'typewriter';      leadIn?: string; rows: string[]; }
export interface ContentQuoteBlock         extends ContentBlockBase { blockType: 'quote';           leadIn?: string; quote: string; author?: string; }
export interface ContentFigureBlock        extends ContentBlockBase { blockType: 'figure';          leadIn?: string; src: string; alt?: string; caption?: string; size?: string; selfReference?: { display: string }; }
export interface ContentSubsectionBlock    extends ContentBlockBase { blockType: 'subsection';      title: string; blocks: ContentBlock[]; }
export interface ContentDetailsBlock       extends ContentBlockBase { blockType: 'details';         title?: string; blocks: ContentBlock[]; }
export interface ContentEmbedBlock         extends ContentBlockBase { blockType: 'embed';           targetId: string; targetType: string; showTitle?: boolean; }

export type ContentBlock =
  | ContentNarrativeBlock | ContentFormulaBlock | ContentClaimBlock
  | ContentOrderedListBlock | ContentUnorderedListBlock | ContentTypewriterBlock
  | ContentQuoteBlock | ContentFigureBlock | ContentSubsectionBlock | ContentDetailsBlock
  | ContentEmbedBlock;

// ─── Term types ───────────────────────────────────────────────────────────────

export interface ContentTerm      { id: string; name: string; slug: string; display: string; canonical: string; synonyms: string[]; }

// ─── Content object data (discriminated by type) ──────────────────────────────

// `hasReferencesDictionary` flags a file that still has the keyed `references`
// dictionary the site now rejects, so the panel can say why saving is refused.
interface ContentObjectBase { id: string; name: string; title?: string; selectedId: string | null; hasReferencesDictionary?: boolean; }
export type { KbEntityType } from '@youproof.org/content-model';
export interface EntityLabelVariant { key: string; canonical: string; }
export interface EntityTypeLabels   { default: string; variants: EntityLabelVariant[]; }

interface ContentEntityLabelFields {
  locale: string; label?: string; hasLabelsBlock?: boolean;
  labelVariants?: EntityTypeLabels; labelRegistryError?: string;
}

export interface ContentDefinitionData extends ContentObjectBase, ContentEntityLabelFields {
  type: 'definition'; namespacePath: string;
  terms: ContentTerm[]; body: ContentBlock[];
}
export interface ContentTheoremData extends ContentObjectBase, ContentEntityLabelFields {
  type: 'theorem'; namespacePath: string;
  terms: ContentTerm[]; body: ContentBlock[];
}
export interface ContentProofData extends ContentObjectBase, ContentEntityLabelFields {
  type: 'proof'; namespacePath: string;
  body: ContentBlock[];
}
export interface ContentRemarkData extends ContentObjectBase, ContentEntityLabelFields {
  type: 'remark'; namespacePath: string;
  terms: ContentTerm[]; body: ContentBlock[];
}
export interface ContentChapterData extends ContentObjectBase {
  type: 'chapter';
  abstract: ContentBlock[]; prerequisiteWarning: ContentBlock[];
  prologue: ContentBlock[]; epilogue: ContentBlock[];
}
export interface ContentSectionData extends ContentObjectBase {
  type: 'section';
  body: ContentBlock[];
}

export type ContentObjectData =
  | ContentDefinitionData | ContentTheoremData | ContentProofData | ContentRemarkData
  | ContentChapterData | ContentSectionData;
