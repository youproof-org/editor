import BottomPane from './BottomPane';
import TermsPanel from './TermsPanel';
import { useSelectionContext } from './contexts/SelectionContext';
import { useBracketEditingContext } from './contexts/BracketEditingContext';
import { useTermEditingContext } from './contexts/TermEditingContext';
import type { ContentTerm } from '../shared/types';

interface Props {
  sortedTerms: ContentTerm[];
  terms:       ContentTerm[] | null;
  onSelect:    (id: string) => void;
}

export default function EditorTabs({ sortedTerms, terms, onSelect }: Props) {
  const { selectedId } = useSelectionContext();
  const { activeItem, insertAtFocused } = useBracketEditingContext();
  const { onTermChange } = useTermEditingContext();

  if (terms === null) return null;

  const selectedTermName = (!activeItem && selectedId)
    ? (terms.find(t => t.id === selectedId)?.name ?? null) : null;
  const highlightedTermName = activeItem ? activeItem.name : selectedTermName;

  return (
    <BottomPane activeTabId="terms" onTabChange={() => {}} tabs={[{
      id: 'terms',
      label: 'Terms',
      panel: <TermsPanel
        terms={sortedTerms}
        onTermChange={onTermChange}
        highlightedName={highlightedTermName}
        onInsert={name => insertAtFocused({ type: 'term', name })}
        onSelect={onSelect}
      />,
    }]} />
  );
}
