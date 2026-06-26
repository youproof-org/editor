import CodeMirrorField from '../CodeMirrorField';
import Field from './Field';
import type { ContentFormulaBlock } from '../../shared/types';

interface Props {
  block: ContentFormulaBlock;
  onBlockChange: (updated: ContentFormulaBlock) => void;
}

export default function FormulaBlock({ block, onBlockChange }: Props) {
  return (
    <>
      <Field label="Lead-in">
        <CodeMirrorField value={block.leadIn ?? ''} bracketAutocomplete
          onChange={v => onBlockChange({ ...block, leadIn: v })} />
      </Field>
      <Field label="Content">
        <CodeMirrorField value={block.content} multiline
          onChange={v => onBlockChange({ ...block, content: v })} />
      </Field>
      <Field label="Lead-out">
        <CodeMirrorField value={block.leadOut ?? ''} bracketAutocomplete
          onChange={v => onBlockChange({ ...block, leadOut: v })} />
      </Field>
    </>
  );
}
