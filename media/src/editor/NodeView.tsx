import { useMemo } from 'react';
import { getAllBlocksText, sortByOccurrence } from './bracketScan';
import { SelectionContext } from './contexts/SelectionContext';
import { useContentObjectDraft } from './hooks/useContentObjectDraft';
import { useSaveOnCtrlS } from './hooks/useSaveOnCtrlS';
import { useEntitySelection } from './hooks/useEntitySelection';
import BlockOpsProvider from './BlockOpsProvider';
import BracketEditingProvider from './BracketEditingProvider';
import TargetSelectionProvider from './TargetSelectionProvider';
import TermEditingProvider from './TermEditingProvider';
import EntityHeader from './EntityHeader';
import EntityBody from './EntityBody';
import EditorTabs from './EditorTabs';

interface Props { nodeId: string; }

export default function NodeView({ nodeId }: Props) {
  const { selectedId, setSelectedId, handleSelectId, handleSelectBlock } = useEntitySelection(nodeId);
  const {
    draft, setDraft, draftRef,
    targetObjects, setTargetObjects,
    error, setError,
    isDirty, setIsDirty, isDirtyRef,
    markDirty,
  } = useContentObjectDraft({ nodeId, setSelectedId });

  const selectionCtx = useMemo(() => ({
    selectedId,
    onSelectBlock: handleSelectBlock,
  }), [selectedId, handleSelectBlock]);

  useSaveOnCtrlS({ nodeId, draft, isDirtyRef, setIsDirty, setError });

  const terms       = draft !== null && 'terms' in draft ? draft.terms : null;
  const bodyText    = draft ? getAllBlocksText(draft) : '';
  const sortedTerms = useMemo(() => sortByOccurrence(terms ?? [], bodyText), [draft]);

  if (error) return <p className="msg">{error}</p>;
  if (!draft) return <p className="msg">Loading…</p>;

  return (
    <SelectionContext.Provider value={selectionCtx}>
    <TermEditingProvider setDraft={setDraft} draftRef={draftRef} markDirty={markDirty}>
    <BracketEditingProvider draft={draft} setDraft={setDraft} markDirty={markDirty}>
    <TargetSelectionProvider setDraft={setDraft} setTargetObjects={setTargetObjects} markDirty={markDirty} targetObjects={targetObjects}>
    <BlockOpsProvider draft={draft} setDraft={setDraft} markDirty={markDirty}>
      <div className="node-view">
        <div className="node-view-content">
          <EntityHeader
            nodeId={nodeId} type={draft.type} title={draft.title ?? draft.name} isDirty={isDirty}
            entityLabel={draft.type === 'chapter' || draft.type === 'section' ? undefined : {
              locale: draft.locale, type: draft.type, label: draft.label, hasLabelsBlock: draft.hasLabelsBlock ?? false,
              labelVariants: draft.labelVariants, labelRegistryError: draft.labelRegistryError,
            }}
          />
          <div className="blocks">
            <EntityBody draft={draft} setDraft={setDraft} markDirty={markDirty} />
          </div>
        </div>
        <EditorTabs
          sortedTerms={sortedTerms}
          terms={terms}
          onSelect={handleSelectId}
        />
      </div>
    </BlockOpsProvider>
    </TargetSelectionProvider>
    </BracketEditingProvider>
    </TermEditingProvider>
    </SelectionContext.Provider>
  );
}
