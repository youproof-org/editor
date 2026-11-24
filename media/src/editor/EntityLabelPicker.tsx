import type { EntityTypeLabels, KbEntityType } from '../shared/types';

export interface EntityLabelProps {
  locale:              string;
  type:                KbEntityType;
  label:               string | undefined;
  hasLabelsBlock:      boolean;
  labelVariants?:      EntityTypeLabels;
  labelRegistryError?: string;
}

function labelState({ label, labelVariants, labelRegistryError }: EntityLabelProps) {
  const variants   = labelVariants?.variants ?? [];
  const defaultKey = labelVariants?.default;
  const isUnknown  = !labelRegistryError && label !== undefined && !variants.some(v => v.key === label);
  const showPicker = !labelRegistryError && (variants.length > 1 || isUnknown);
  return { variants, defaultKey, isUnknown, showPicker };
}

interface PickerProps extends EntityLabelProps {
  onChange: (label: string | undefined) => void;
}

export default function EntityLabelPicker(props: PickerProps) {
  const { label, hasLabelsBlock, onChange } = props;
  const { variants, defaultKey, isUnknown, showPicker } = labelState(props);
  if (!showPicker) return null;

  return (
    <select
      className={`field-input entity-label-picker${isUnknown || hasLabelsBlock ? ' field-input--invalid' : ''}`}
      value={label ?? defaultKey ?? ''}
      onChange={e => onChange(e.target.value === defaultKey ? undefined : e.target.value)}
    >
      {variants.map(v => (
        <option key={v.key} value={v.key}>
          {v.canonical} ({v.key}){v.key === defaultKey ? ', default' : ''}
        </option>
      ))}
      {isUnknown && <option value={label}>{label} (unknown)</option>}
    </select>
  );
}

export function EntityLabelHints(props: EntityLabelProps) {
  const { locale, type, label, hasLabelsBlock, labelVariants, labelRegistryError } = props;
  const { isUnknown } = labelState(props);

  return (
    <>
      {labelRegistryError && (
        <div className="field-hint">The label registry is unavailable: {labelRegistryError}</div>
      )}
      {!labelRegistryError && !labelVariants && (
        <div className="field-hint">
          The editor has no {type} labels for locale <code>{locale}</code>.
        </div>
      )}
      {isUnknown && (
        <div className="field-hint">
          <code>{label}</code> is not a {type} label in <code>{locale}</code>. The site build rejects it.
        </div>
      )}
      {hasLabelsBlock && (
        <div className="field-hint">
          This file still has a <code>labels</code> block, which the site no longer accepts. Saving is
          refused until it is removed from the YAML file and the content is reloaded.
        </div>
      )}
    </>
  );
}
