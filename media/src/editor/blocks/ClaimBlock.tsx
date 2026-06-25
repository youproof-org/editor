import { useRef, useEffect } from 'react';
import CodeMirrorField, { type CodeMirrorFieldHandle } from '../CodeMirrorField';
import Field from './Field';
import { useSelectionContext } from '../contexts/SelectionContext';
import type { ContentClaimBlock } from '../../shared/types';

interface Props {
  block: ContentClaimBlock;
  onBlockChange: (updated: ContentClaimBlock) => void;
}

export default function ClaimBlock({ block, onBlockChange }: Props) {
  const { selectedId }   = useSelectionContext();
  const fieldRef         = useRef<CodeMirrorFieldHandle | null>(null);
  const insideFocusedRef = useRef(false);

  useEffect(() => {
    if (selectedId !== block.id) return;
    if (insideFocusedRef.current) return;
    fieldRef.current?.focus();
  }, [selectedId, block.id]);

  return (
    <div
      onFocus={() => { insideFocusedRef.current = true; }}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          insideFocusedRef.current = false;
        }
      }}
    >
      <Field label="Name">
        <input className="field-input" value={block.name}
          onChange={e => onBlockChange({ ...block, name: e.target.value })} />
      </Field>
      <Field label="Content">
        <CodeMirrorField ref={fieldRef} value={block.content} bracketAutocomplete
          onChange={v => onBlockChange({ ...block, content: v })} />
      </Field>
      <Field label="Formula">
        <CodeMirrorField value={block.formula ?? ''} multiline
          onChange={v => onBlockChange({ ...block, formula: v })} />
      </Field>
    </div>
  );
}
