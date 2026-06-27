import BlockSequence from './BlockSequence';
import CodeMirrorField from '../CodeMirrorField';
import Field from './Field';
import type { ContentDetailsBlock } from '../../shared/types';

interface Props {
  block: ContentDetailsBlock;
  onBlockChange: (updated: ContentDetailsBlock) => void;
}

export default function DetailsBlock({ block, onBlockChange }: Props) {
  return (
    <>
      <Field label="Title">
        <CodeMirrorField value={block.title ?? ''} bracketAutocomplete
          onChange={v => onBlockChange({ ...block, title: v || undefined })} />
      </Field>
      <BlockSequence blocks={block.blocks}
        onChange={blocks => onBlockChange({ ...block, blocks })} />
    </>
  );
}
