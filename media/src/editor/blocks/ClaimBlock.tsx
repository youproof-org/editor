import { useRef, useEffect } from 'react';
import CodeMirrorField, { type CodeMirrorFieldHandle } from '../CodeMirrorField';
import Field from './Field';
import { useSelectionContext } from '../contexts/SelectionContext';
import { isValidSlug } from '../../shared/slug';
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

  // A malformed slug is refused on save; a missing one is only flagged, because
  // the site falls back to `name` and still renders — in English, on a Hungarian
  // page, which is the thing worth noticing. There is deliberately no derive
  // button here: a claim slug is a translation of the English name, and nothing
  // in this extension can translate. See media/src/shared/slug.ts.
  const slugState =
    block.slug === ''          ? 'warn'
    : !isValidSlug(block.slug) ? 'invalid'
    : 'ok';

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
      <Field label="Slug">
        <input
          className={`field-input${slugState === 'ok' ? '' : ` field-input--${slugState}`}`}
          value={block.slug}
          placeholder="magyar horgony, pl. tartalmazza-a-nullelemet"
          onChange={e => onBlockChange({ ...block, slug: e.target.value })}
        />
        {slugState === 'warn' && (
          <div className="field-hint">
            No slug — this claim is cited in English, as{' '}
            <code>allitasok.{block.name || '…'}</code>. Write the Hungarian one.
          </div>
        )}
        {slugState === 'invalid' && (
          <div className="field-hint">
            Must be lowercase kebab-case — no dot, space or capital. Saving is blocked until it is.
          </div>
        )}
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
