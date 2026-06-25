import { useMemo } from 'react';
import { getAllBlocksText, sortByOccurrence } from './bracketScan';
import { SelectionContext } from './contexts/SelectionContext';
import { useContentObjectDraft } from './hooks/useContentObjectDraft';
import { useSaveOnCtrlS } from './hooks/useSaveOnCtrlS';
import { useEntitySelection } from './hooks/useEntitySelection';
import { useRefSuggestions } from './hooks/useRefSuggestions';
import BlockOpsProvider from './BlockOpsProvider';
import BracketEditingProvider from './BracketEditingProvider';
import TargetSelectionProvider from './TargetSelectionProvider';
import RefTermEditingProvider from './RefTermEditingProvider';
import EntityHeader from './EntityHeader';
import EntityBody from './EntityBody';
import EditorTabs from './EditorTabs';

interface Props { nodeId: string; }

export default function NodeView({ nodeId }: Props) {
  const { selectedId, setSelectedId, handleSelectId, handleSelectBlock } = useEntitySelection(nodeId);
  const {
    draft, setDraft, draftRef,
    targetObjects, setTargetObjects, targetObjectsRef,
    error, setError,
    isDirty, setIsDirty, isDirtyRef,
    markDirty,
  } = useContentObjectDraft({ nodeId, setSelectedId });

  const fetchRefSuggestions = useRefSuggestions({ nodeId, draftRef, targetObjectsRef });

  const selectionCtx = useMemo(() => ({
    selectedId,
    onSelectBlock: handleSelectBlock,
  }), [selectedId, handleSelectBlock]);

  useSaveOnCtrlS({ nodeId, draft, isDirtyRef, setIsDirty, setError });

  const terms       = draft !== null && 'terms' in draft ? draft.terms : null;
  const bodyText    = draft ? getAllBlocksText(draft) : '';
  const sortedRefs  = useMemo(() => sortByOccurrence(draft?.references ?? [], bodyText, 'ref'),  [draft]);
  const sortedTerms = useMemo(() => sortByOccurrence(terms ?? [],             bodyText, 'term'), [draft]);

  if (error) return <p className="msg">{error}</p>;
  if (!draft) return <p className="msg">Loading…</p>;

  return (
    <SelectionContext.Provider value={selectionCtx}>
    <RefTermEditingProvider setDraft={setDraft} setTargetObjects={setTargetObjects} draftRef={draftRef} markDirty={markDirty}>
    <BracketEditingProvider draft={draft} setDraft={setDraft} markDirty={markDirty} fetchRefSuggestions={fetchRefSuggestions}>
    <TargetSelectionProvider draftRef={draftRef} setDraft={setDraft} setTargetObjects={setTargetObjects} markDirty={markDirty} targetObjects={targetObjects}>
    <BlockOpsProvider draft={draft} setDraft={setDraft} markDirty={markDirty}>
      <div className="node-view">
        <div className="node-view-content">
          <EntityHeader nodeId={nodeId} type={draft.type} title={draft.title ?? draft.name} isDirty={isDirty} />
          <div className="blocks">
            <EntityBody draft={draft} setDraft={setDraft} markDirty={markDirty} />
          </div>
        </div>
        <EditorTabs
          draft={draft}
          sortedRefs={sortedRefs}
          sortedTerms={sortedTerms}
          terms={terms}
          onSelect={handleSelectId}
        />
      </div>
    </BlockOpsProvider>
    </TargetSelectionProvider>
    </BracketEditingProvider>
    </RefTermEditingProvider>
    </SelectionContext.Provider>
  );
}
