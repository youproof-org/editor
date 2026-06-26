import TargetSelector, { type TargetSelectorProps } from './TargetSelector';

const REF_ALLOWED_TYPES = ['chapter', 'section', 'definition', 'theorem', 'proof', 'remark', 'claim', 'term', 'external'];

type Props = Omit<TargetSelectorProps, 'allowedTypes' | 'target'> & { tgtInfo: TargetSelectorProps['target'] };

export default function RefTargetCell({ tgtInfo, ...rest }: Props) {
  return (
    <td className="ref-target-cell">
      <TargetSelector target={tgtInfo} allowedTypes={REF_ALLOWED_TYPES} {...rest} />
    </td>
  );
}
