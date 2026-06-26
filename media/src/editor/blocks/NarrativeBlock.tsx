import CodeMirrorField from '../CodeMirrorField';
import Field from './Field';
import type { ContentNarrativeBlock } from '../../shared/types';

interface Props {
  block: ContentNarrativeBlock;
  onBlockChange: (updated: ContentNarrativeBlock) => void;
}

export default function NarrativeBlock({ block, onBlockChange }: Props) {
  return (
    <Field label="Content">
      <CodeMirrorField value={block.content} bracketAutocomplete
        onChange={v => onBlockChange({ ...block, content: v })} />
    </Field>
  );
}
