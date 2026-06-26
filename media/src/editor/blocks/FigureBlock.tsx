import CodeMirrorField from '../CodeMirrorField';
import Field from './Field';
import SuggestionInput from '../SuggestionInput';
import { useClient } from '../../shared/clientContext';
import type { ContentFigureBlock, GetSelfReferenceDisplaySuggestionsResponse } from '../../shared/types';

interface Props {
  block: ContentFigureBlock;
  onBlockChange: (updated: ContentFigureBlock) => void;
}

export default function FigureBlock({ block, onBlockChange }: Props) {
  const client = useClient();
  return (
    <>
      <Field label="Self-reference">
        <SuggestionInput
          className="field-input"
          value={block.selfReference?.display ?? ''}
          onChange={v => onBlockChange({
            ...block,
            selfReference: v ? { display: v } : undefined,
          })}
          fetchSuggestions={() => client.request<GetSelfReferenceDisplaySuggestionsResponse>(
            'getSelfReferenceDisplaySuggestions', {}
          ).then(d => d.suggestions)}
        />
      </Field>
      <Field label="Lead-in">
        <CodeMirrorField value={block.leadIn ?? ''} bracketAutocomplete allowSelfReference
          onChange={v => onBlockChange({ ...block, leadIn: v })} />
      </Field>
      <Field label="Alt">
        <input className="field-input" value={block.alt ?? ''}
          onChange={e => onBlockChange({ ...block, alt: e.target.value })} />
      </Field>
      <Field label="Caption">
        <input className="field-input" value={block.caption ?? ''}
          onChange={e => onBlockChange({ ...block, caption: e.target.value })} />
      </Field>
      <Field label="Source">
        <input className="field-input" value={block.src}
          onChange={e => onBlockChange({ ...block, src: e.target.value })} />
      </Field>
      <Field label="Size">
        <select className="field-input" value={block.size ?? ''}
          onChange={e => onBlockChange({ ...block, size: e.target.value || undefined })}>
          <option value="">(default)</option>
          <option value="small">small</option>
          <option value="medium">medium</option>
          <option value="large">large</option>
        </select>
      </Field>
    </>
  );
}
