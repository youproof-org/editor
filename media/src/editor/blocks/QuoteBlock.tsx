import CodeMirrorField from '../CodeMirrorField';
import Field from './Field';
import type { ContentQuoteBlock } from '../../shared/types';

interface Props {
  block: ContentQuoteBlock;
  onBlockChange: (updated: ContentQuoteBlock) => void;
}

export default function QuoteBlock({ block, onBlockChange }: Props) {
  return (
    <>
      <Field label="Lead-in">
        <CodeMirrorField value={block.leadIn ?? ''} bracketAutocomplete
          onChange={v => onBlockChange({ ...block, leadIn: v })} />
      </Field>
      <Field label="Quote">
        <CodeMirrorField value={block.quote}
          onChange={v => onBlockChange({ ...block, quote: v })} />
      </Field>
      <Field label="Author">
        <input className="field-input" value={block.author ?? ''}
          onChange={e => onBlockChange({ ...block, author: e.target.value || undefined })} />
      </Field>
    </>
  );
}
