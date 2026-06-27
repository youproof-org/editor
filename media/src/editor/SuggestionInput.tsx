import { ReactNode, useRef, useState } from 'react';
import HighlightedText from './HighlightedText';
import SuggestionPopup, { AnchorRect } from './SuggestionPopup';
import { useSuggestionPopup } from './hooks/useSuggestionPopup';

interface Props<T = string> {
  value:            string;
  onChange:         (v: string) => void;
  className?:       string;
  fetchSuggestions: (() => Promise<T[]>) | null;
  /** Defaults to `(it) => it as string` — fine when T = string. */
  getKey?:          (item: T) => string;
  /** Defaults to `(it) => it as string` — fine when T = string. */
  getMatchText?:    (item: T) => string;
  /** Defaults to highlighting the item itself (assumes T = string). */
  renderItem?:      (item: T, isSelected: boolean, typed: string) => ReactNode;
  /** Returned by the popup when the user picks an item — defaults to the matchText. */
  toInputValue?:    (item: T) => string;
  onFocus?:         () => void;
  onBlur?:          () => void;
}

export default function SuggestionInput<T = string>({
  value, onChange, className, fetchSuggestions,
  getKey       = (it) => String(it),
  getMatchText = (it) => String(it),
  renderItem,
  toInputValue,
  onFocus, onBlur,
}: Props<T>) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);

  const commit = (item: T) => {
    onChange((toInputValue ?? getMatchText)(item));
    setAnchorRect(null);
  };

  const popup = useSuggestionPopup<T>({
    typed:        value,
    fetchItems:   fetchSuggestions,
    getKey,
    getMatchText,
    onCommit:     commit,
  });

  const defaultRender: (item: T, isSelected: boolean, typed: string) => ReactNode =
    (item, _isSelected, typed) => <HighlightedText text={getMatchText(item)} typed={typed} />;

  const effectiveRender = renderItem ?? defaultRender;

  return (
    <>
      {popup.active && popup.displayed.length > 0 && anchorRect && (
        <SuggestionPopup<T>
          items={popup.displayed}
          selectedIdx={popup.selectedIdx}
          getKey={getKey}
          renderItem={(item, isSelected) => effectiveRender(item, isSelected, value)}
          anchorRect={anchorRect}
          preferred="above"
          onPick={item => { commit(item); popup.close(); }}
          selectedItemRef={popup.selectedItemRef}
        />
      )}
      <input
        ref={inputRef}
        className={className}
        value={value}
        onChange={e => { onChange(e.target.value); popup.onTyped(); }}
        onFocus={e => {
          if (fetchSuggestions) {
            const r = e.currentTarget.getBoundingClientRect();
            setAnchorRect({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
            popup.open();
          }
          onFocus?.();
        }}
        onBlur={() => { popup.close(); setAnchorRect(null); onBlur?.(); }}
        onKeyDown={e => { popup.handleKeyDown(e); }}
      />
    </>
  );
}
