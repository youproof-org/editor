import { Dispatch, SetStateAction } from 'react';
import BlockSequence from './blocks/BlockSequence';
import type { ContentBlock, ContentChapterData, ContentObjectData } from '../shared/types';

interface Props {
  draft:    ContentObjectData;
  setDraft: Dispatch<SetStateAction<ContentObjectData | null>>;
  markDirty: () => void;
}

export default function EntityBody({ draft, setDraft, markDirty }: Props) {
  if (draft.type === 'chapter') {
    return <ChapterBody draft={draft} setDraft={setDraft} markDirty={markDirty} />;
  }
  if ('body' in draft) {
    return <SimpleBody body={draft.body} setDraft={setDraft} markDirty={markDirty} />;
  }
  return null;
}

function SimpleBody({ body, setDraft, markDirty }: {
  body:      ContentBlock[];
  setDraft:  Dispatch<SetStateAction<ContentObjectData | null>>;
  markDirty: () => void;
}) {
  return (
    <BlockSequence blocks={body}
      onChange={blocks => { setDraft(d => d && { ...d, body: blocks }); markDirty(); }} />
  );
}

function ChapterBody({ draft, setDraft, markDirty }: {
  draft:     ContentChapterData;
  setDraft:  Dispatch<SetStateAction<ContentObjectData | null>>;
  markDirty: () => void;
}) {
  const updateField = (
    field: 'abstract' | 'prerequisiteWarning' | 'prologue' | 'epilogue',
  ) => (blocks: ContentBlock[]) => {
    setDraft(d => d && d.type === 'chapter' ? { ...d, [field]: blocks } : d);
    markDirty();
  };
  return (
    <>
      <div className="chapter-section">
        <div className="chapter-section-label">Abstract</div>
        <BlockSequence blocks={draft.abstract}            onChange={updateField('abstract')} />
      </div>
      <div className="chapter-section">
        <div className="chapter-section-label">Prerequisite Warning</div>
        <BlockSequence blocks={draft.prerequisiteWarning} onChange={updateField('prerequisiteWarning')} />
      </div>
      <div className="chapter-section">
        <div className="chapter-section-label">Prologue</div>
        <BlockSequence blocks={draft.prologue}            onChange={updateField('prologue')} />
      </div>
      <div className="chapter-section">
        <div className="chapter-section-label">Epilogue</div>
        <BlockSequence blocks={draft.epilogue}            onChange={updateField('epilogue')} />
      </div>
    </>
  );
}
