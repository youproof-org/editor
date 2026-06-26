// ─── Sidebar tree ──────────────────────────────────────────────────────────────

export type NodeType =
  | 'book' | 'part' | 'chapter' | 'section'
  | 'namespace'
  | 'definition' | 'theorem' | 'proof' | 'remark';

export interface ContentTreeItem {
  id: string;
  type: NodeType | 'group' | 'reference' | 'term' | 'claim';
  label: string;
  isFileBacked: boolean;
  targetId?: string;
  children: ContentTreeItem[];
}

// ─── Request types ─────────────────────────────────────────────────────────────

export interface GetContentObjectRequest      { id: string; }
export interface SelectContentObjectRequest   { id: string; permanent?: boolean; }
export interface SaveRecursivelyRequest       { ids: string[]; }
export interface OpenContentObjectFileRequest { id: string; }
export interface SetContentObjectDirtyRequest { id: string; }
export interface BeginSelectTargetRequest     { selectorId: string; allowedTypes: string[]; }
export interface EndSelectTargetRequest       { targetId: string | null; }
export interface OpenExternalUrlRequest                  { url: string; }
export interface GetReferenceDisplaySuggestionsRequest  { type: string; }
export interface GetReferenceDisplaySuggestionsResponse { suggestions: string[]; }
export interface GetSelfReferenceDisplaySuggestionsRequest  { /* empty */ }
export interface GetSelfReferenceDisplaySuggestionsResponse { suggestions: string[]; }

export interface RefSuggestion {
  source:  'current' | 'other';
  name:    string;
  display: string;
  target:  ContentTargetObject;
}
export interface GetReferenceSuggestionsRequest  { currentObjectId: string; }
export interface GetReferenceSuggestionsResponse { suggestions: RefSuggestion[]; }

export interface ContentLabelCase { base?: string; suffix?: string; }
export interface ContentLabels     { canonical: string; cases?: Record<string, ContentLabelCase>; }

interface SaveObjectBase { id: string; }

export interface SaveDefinitionObjectRequest extends SaveObjectBase { entityType: 'definition'; body: ContentBlock[]; terms: ContentTerm[]; references: ContentReference[]; labels?: ContentLabels; }
export interface SaveTheoremObjectRequest    extends SaveObjectBase { entityType: 'theorem';    body: ContentBlock[]; terms: ContentTerm[]; references: ContentReference[]; labels?: ContentLabels; }
export interface SaveProofObjectRequest      extends SaveObjectBase { entityType: 'proof';      body: ContentBlock[]; references: ContentReference[]; }
export interface SaveRemarkObjectRequest     extends SaveObjectBase { entityType: 'remark';     body: ContentBlock[]; terms: ContentTerm[]; references: ContentReference[]; }
export interface SaveSectionObjectRequest    extends SaveObjectBase { entityType: 'section';    body: ContentBlock[]; references: ContentReference[]; }
export interface SaveChapterObjectRequest    extends SaveObjectBase {
  entityType: 'chapter';
  abstract: ContentBlock[];
  prerequisiteWarning: ContentBlock[];
  prologue: ContentBlock[];
  epilogue: ContentBlock[];
  references: ContentReference[];
}

export type SaveContentObjectRequest =
  | SaveDefinitionObjectRequest
  | SaveTheoremObjectRequest
  | SaveProofObjectRequest
  | SaveRemarkObjectRequest
  | SaveSectionObjectRequest
  | SaveChapterObjectRequest;

// ─── Response types ────────────────────────────────────────────────────────────

export interface GetContentTreeResponse { books: ContentTreeItem[]; kb: ContentTreeItem[]; selectedId: string | null; }
export interface ReloadModelResponse    { books: ContentTreeItem[]; kb: ContentTreeItem[]; selectedId: string | null; }

export interface ContentTargetObject { id: string; type: string; label: string; }

export interface GetContentObjectResponse {
  contentObject: ContentObjectData;
  targetObjects: Record<string, ContentTargetObject>;
}

// ─── Content block types ───────────────────────────────────────────────────────

interface ContentBlockBase { id: string; }

export interface ContentNarrativeBlock     extends ContentBlockBase { blockType: 'narrative';       content: string; }
export interface ContentFormulaBlock       extends ContentBlockBase { blockType: 'formula';         leadIn?: string; content: string; leadOut?: string; }
export interface ContentClaimBlock         extends ContentBlockBase { blockType: 'claim';           name: string; content: string; formula?: string; }
export interface ContentOrderedListBlock   extends ContentBlockBase { blockType: 'ordered-list';    leadIn?: string; items: string[]; }
export interface ContentUnorderedListBlock extends ContentBlockBase { blockType: 'unordered-list';  leadIn?: string; items: string[]; }
export interface ContentTypewriterBlock    extends ContentBlockBase { blockType: 'typewriter';      leadIn?: string; rows: string[]; }
export interface ContentQuoteBlock         extends ContentBlockBase { blockType: 'quote';           leadIn?: string; quote: string; author?: string; }
export interface ContentFigureBlock        extends ContentBlockBase { blockType: 'figure';          leadIn?: string; src: string; alt?: string; caption?: string; size?: string; selfReference?: { display: string }; }
export interface ContentSubsectionBlock    extends ContentBlockBase { blockType: 'subsection';      title: string; blocks: ContentBlock[]; }
export interface ContentDetailsBlock       extends ContentBlockBase { blockType: 'details';         title?: string; blocks: ContentBlock[]; }
export interface ContentEmbedBlock         extends ContentBlockBase { blockType: 'embed';           targetId: string; targetType: string; showTitle?: boolean; }
export interface ContentRecallBlock        extends ContentBlockBase { blockType: 'recall';          targetId: string; targetType: string; }

export type ContentBlock =
  | ContentNarrativeBlock | ContentFormulaBlock | ContentClaimBlock
  | ContentOrderedListBlock | ContentUnorderedListBlock | ContentTypewriterBlock
  | ContentQuoteBlock | ContentFigureBlock | ContentSubsectionBlock | ContentDetailsBlock
  | ContentEmbedBlock | ContentRecallBlock;

// ─── Term / reference types ───────────────────────────────────────────────────

export interface ContentTerm      { id: string; name: string; display: string; canonical: string; synonyms: string[]; }
export interface ContentReference { id: string; name: string; display: string; targetId?: string; }

// ─── Content object data (discriminated by type) ──────────────────────────────

interface ContentObjectBase { id: string; name: string; title?: string; selectedId: string | null; }

export interface ContentDefinitionData extends ContentObjectBase {
  type: 'definition'; namespacePath: string;
  terms: ContentTerm[]; references: ContentReference[]; body: ContentBlock[]; labels?: ContentLabels;
}
export interface ContentTheoremData extends ContentObjectBase {
  type: 'theorem'; namespacePath: string;
  terms: ContentTerm[]; references: ContentReference[]; body: ContentBlock[]; labels?: ContentLabels;
}
export interface ContentProofData extends ContentObjectBase {
  type: 'proof'; namespacePath: string;
  references: ContentReference[]; body: ContentBlock[];
}
export interface ContentRemarkData extends ContentObjectBase {
  type: 'remark'; namespacePath: string;
  terms: ContentTerm[]; references: ContentReference[]; body: ContentBlock[];
}
export interface ContentChapterData extends ContentObjectBase {
  type: 'chapter';
  references: ContentReference[];
  abstract: ContentBlock[]; prerequisiteWarning: ContentBlock[];
  prologue: ContentBlock[]; epilogue: ContentBlock[];
}
export interface ContentSectionData extends ContentObjectBase {
  type: 'section';
  references: ContentReference[]; body: ContentBlock[];
}

export type ContentObjectData =
  | ContentDefinitionData | ContentTheoremData | ContentProofData | ContentRemarkData
  | ContentChapterData | ContentSectionData;
