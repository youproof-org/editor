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
export interface SelectContentObjectRequest   { id: string; permanent?: boolean; }
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

export interface ContentTargetObject { id: string; type: string; label: string; }

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
