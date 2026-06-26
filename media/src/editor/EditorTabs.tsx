import BottomPane from './BottomPane';
import RefsPanel from './RefsPanel';
import TermsPanel from './TermsPanel';
import LabelsEditor from './LabelsEditor';
import { useActiveTab } from './hooks/useActiveTab';
import { useSelectionContext } from './contexts/SelectionContext';
import { useBracketEditingContext } from './contexts/BracketEditingContext';
import { useTargetSelectionContext } from './contexts/TargetSelectionContext';
import { useRefTermEditingContext } from './contexts/RefTermEditingContext';
import type {
  ContentObjectData,
  ContentReference,
  ContentTerm,
} from '../shared/types';

const REF_ALLOWED_TYPES = ['chapter', 'section', 'definition', 'theorem', 'proof', 'remark', 'claim', 'term', 'external'];

interface Props {
  draft:       ContentObjectData;
  sortedRefs:  ContentReference[];
  sortedTerms: ContentTerm[];
  terms:       ContentTerm[] | null;
  onSelect:    (id: string) => void;
}

export default function EditorTabs({ draft, sortedRefs, sortedTerms, terms, onSelect }: Props) {
  const { selectedId } = useSelectionContext();
  const { activeItem, insertAtFocused } = useBracketEditingContext();
  const { targetObjects, selectingSelectorId, onBeginSelectTarget, onEndSelectTarget, onRefTargetChange, onOpenTarget } =
    useTargetSelectionContext();
  const { onRefChange, onTermChange, onLabelsChange } = useRefTermEditingContext();
  const { activeTabId, setActiveTabId } = useActiveTab(draft, selectedId, activeItem);

  const selectedTermName = (!activeItem && 'terms' in draft && selectedId)
    ? (draft.terms.find(t => t.id === selectedId)?.name ?? null) : null;
  const selectedRefName  = (!activeItem && selectedId)
    ? (draft.references.find(r => r.id === selectedId)?.name ?? null) : null;
  const highlightedTermName = activeItem?.type === 'term' ? activeItem.name : selectedTermName;
  const highlightedRefName  = activeItem?.type === 'ref'  ? activeItem.name : selectedRefName;

  return (
    <BottomPane activeTabId={activeTabId} onTabChange={setActiveTabId} tabs={[
      ...(terms !== null ? [{
        id: 'terms',
        label: 'Terms',
        panel: <TermsPanel
          terms={sortedTerms}
          onTermChange={onTermChange}
          highlightedName={highlightedTermName}
          onInsert={name => insertAtFocused({ type: 'term', name })}
          onSelect={onSelect}
        />,
      }] : []),
      {
        id: 'refs',
        label: 'References',
        panel: <RefsPanel
          references={sortedRefs}
          targetObjects={targetObjects}
          onRefChange={onRefChange}
          highlightedName={highlightedRefName}
          onInsert={name => insertAtFocused({ type: 'ref', name })}
          selectingRefId={selectingSelectorId}
          onBeginSelectTarget={refId => onBeginSelectTarget(refId, REF_ALLOWED_TYPES)}
          onEndSelectTarget={onEndSelectTarget}
          onSetUrl={(refId, url) => onRefTargetChange(refId, { id: url, type: 'external', label: url })}
          onClearTarget={(refId) => onRefTargetChange(refId, null)}
          onOpenTarget={(targetId, targetType) => onOpenTarget(targetId, targetType)}
          onSelect={onSelect}
        />,
      },
      ...((draft.type === 'definition' || draft.type === 'theorem') ? [{
        id: 'labels',
        label: 'Labels',
        panel: <LabelsEditor labels={draft.labels} onChange={onLabelsChange} />,
      }] : []),
    ]} />
  );
}
