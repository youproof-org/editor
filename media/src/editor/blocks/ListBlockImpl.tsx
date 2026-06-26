import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import CodeMirrorField, { type CodeMirrorFieldHandle } from '../CodeMirrorField';
import Field from './Field';

export interface ListItemHandle {
  focusAt(target: 'start' | 'end' | number): void;
  getContent(): string;
  getCursor(): { pos: number; isAtStart: boolean; isAtEnd: boolean };
}

interface ItemRendererProps {
  value:        string;
  onChange:     (v: string) => void;
  onSpecialKey: (k: 'Enter' | 'Backspace' | 'Delete') => boolean;
}

interface Props {
  leadIn:         string | undefined;
  onLeadInChange: (v: string) => void;
  items:          string[];
  onItemsChange:  (items: string[]) => void;
  marker?:        (i: number) => React.ReactNode;
  renderItem:     (props: ItemRendererProps, ref: React.Ref<ListItemHandle>) => React.ReactNode;
}

export default function ListBlockImpl({ leadIn, onLeadInChange, items, onItemsChange, marker, renderItem }: Props) {
  const itemRefs        = useRef<(ListItemHandle | null)[]>([]);
  const pendingFocusRef = useRef<{ idx: number; target: 'start' | 'end' | number } | null>(null);

  useEffect(() => {
    const p = pendingFocusRef.current;
    if (p && itemRefs.current[p.idx]) {
      itemRefs.current[p.idx]!.focusAt(p.target);
      pendingFocusRef.current = null;
    }
  });

  const handleSpecialKey = (i: number, key: 'Enter' | 'Backspace' | 'Delete'): boolean => {
    const handle = itemRefs.current[i];
    if (!handle) return false;
    const content = handle.getContent();
    const { pos, isAtStart, isAtEnd } = handle.getCursor();

    if (key === 'Enter') {
      if (content === '') return true;
      if (isAtStart) {
        onItemsChange([...items.slice(0, i), '', ...items.slice(i)]);
        pendingFocusRef.current = { idx: i + 1, target: 'start' };
      } else if (isAtEnd) {
        onItemsChange([...items.slice(0, i + 1), '', ...items.slice(i + 1)]);
        pendingFocusRef.current = { idx: i + 1, target: 'start' };
      } else {
        const before = content.slice(0, pos);
        const after  = content.slice(pos);
        onItemsChange([...items.slice(0, i), before, after, ...items.slice(i + 1)]);
        pendingFocusRef.current = { idx: i + 1, target: 'start' };
      }
      return true;
    }

    if (key === 'Backspace') {
      if (!isAtStart) return false;
      if (i === 0) return true;
      const prev = items[i - 1];
      if (content === '') {
        onItemsChange([...items.slice(0, i), ...items.slice(i + 1)]);
        pendingFocusRef.current = { idx: i - 1, target: 'end' };
      } else {
        onItemsChange([...items.slice(0, i - 1), prev + content, ...items.slice(i + 1)]);
        pendingFocusRef.current = { idx: i - 1, target: prev.length };
      }
      return true;
    }

    if (key === 'Delete') {
      if (!isAtEnd) return false;
      if (i === items.length - 1) return true;
      const next = items[i + 1];
      if (content === '') {
        onItemsChange([...items.slice(0, i), ...items.slice(i + 1)]);
        pendingFocusRef.current = { idx: i, target: 'start' };
      } else {
        onItemsChange([...items.slice(0, i), content + next, ...items.slice(i + 2)]);
        pendingFocusRef.current = { idx: i, target: content.length };
      }
      return true;
    }

    return false;
  };

  return (
    <>
      <Field label="Lead-in">
        <CodeMirrorField value={leadIn ?? ''} bracketAutocomplete
          onChange={onLeadInChange} />
      </Field>
      <Field label="Items">
        <div className="list-items-frame">
        <table className="list-items-table"><tbody>
          {items.map((item, i) => (
            <tr key={i}>
              {marker && <td className="list-item-marker">{marker(i)}</td>}
              <td className="list-item-cell">
                {renderItem(
                  {
                    value: item,
                    onChange: (v) => onItemsChange(items.map((x, j) => j === i ? v : x)),
                    onSpecialKey: (k) => handleSpecialKey(i, k),
                  },
                  (h) => { itemRefs.current[i] = h; },
                )}
              </td>
            </tr>
          ))}
        </tbody></table>
        </div>
      </Field>
    </>
  );
}

// ─── Item renderers ────────────────────────────────────────────────────────────

export const ListItemCM = forwardRef<ListItemHandle, ItemRendererProps>(
  function ListItemCM({ value, onChange, onSpecialKey }, ref) {
    const cmRef = useRef<CodeMirrorFieldHandle | null>(null);
    useImperativeHandle(ref, () => ({
      focusAt:    (t) => cmRef.current?.focusAt(t),
      getContent: () => cmRef.current?.getContent() ?? '',
      getCursor:  () => cmRef.current?.getCursor() ?? { pos: 0, isAtStart: true, isAtEnd: true },
    }), []);
    return (
      <CodeMirrorField ref={cmRef} value={value} bracketAutocomplete
        onChange={onChange} onSpecialKey={onSpecialKey} />
    );
  },
);

export const ListItemInput = forwardRef<ListItemHandle, ItemRendererProps>(
  function ListItemInput({ value, onChange, onSpecialKey }, ref) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    useImperativeHandle(ref, () => ({
      focusAt: (t) => {
        const el = inputRef.current; if (!el) return;
        el.focus();
        const len = el.value.length;
        const pos = t === 'start' ? 0 : t === 'end' ? len : Math.max(0, Math.min(len, t));
        el.setSelectionRange(pos, pos);
      },
      getContent: () => inputRef.current?.value ?? '',
      getCursor: () => {
        const el = inputRef.current;
        if (!el) return { pos: 0, isAtStart: true, isAtEnd: true };
        const pos = el.selectionStart ?? 0;
        return { pos, isAtStart: pos === 0, isAtEnd: pos === el.value.length };
      },
    }), []);
    return (
      <input ref={inputRef} className="field-input" value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete') {
            if (onSpecialKey(e.key)) e.preventDefault();
          }
        }} />
    );
  },
);
