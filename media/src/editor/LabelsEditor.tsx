import Field from './blocks/Field';
import type { ContentLabels, ContentLabelCase } from '../shared/types';

interface Props {
  labels: ContentLabels | undefined;
  onChange: (labels: ContentLabels | undefined) => void;
}

export default function LabelsEditor({ labels, onChange }: Props) {
  const canonical = labels?.canonical ?? '';
  const entries: Array<[string, ContentLabelCase]> = labels?.cases ? Object.entries(labels.cases) : [];

  const emit = (newCanonical: string, newEntries: Array<[string, ContentLabelCase]>) => {
    if (!newCanonical && newEntries.length === 0) { onChange(undefined); return; }
    const cases: Record<string, ContentLabelCase> = {};
    for (const [k, v] of newEntries) cases[k] = v;
    onChange({ canonical: newCanonical, cases: newEntries.length ? cases : undefined });
  };

  const setCanonical = (v: string) => {
    if (v === '' && entries.length > 0) return;
    emit(v, entries);
  };

  const renameKey = (i: number, newKey: string) => {
    if (newKey === '') return;
    if (entries.some((e, j) => j !== i && e[0] === newKey)) return;
    const next = entries.map((e, j) => j === i ? [newKey, e[1]] as [string, ContentLabelCase] : e);
    emit(canonical, next);
  };

  const updateCase = (i: number, patch: Partial<ContentLabelCase>) => {
    const next = entries.map((e, j) =>
      j === i ? [e[0], { ...e[1], ...patch }] as [string, ContentLabelCase] : e,
    );
    emit(canonical, next);
  };

  const removeCase = (i: number) => emit(canonical, entries.filter((_, j) => j !== i));

  const addCase = () => {
    const used = new Set(entries.map(([k]) => k));
    let n = 1;
    while (used.has(`case${n}`)) n++;
    emit(canonical, [...entries, [`case${n}`, {}]]);
  };

  return (
    <>
      <Field label="Canonical">
        <input className="field-input" value={canonical}
          onChange={e => setCanonical(e.target.value)} />
      </Field>
      <table className="refs-table refs-table--labels">
        <thead>
          <tr>
            <th>Key</th><th>Base</th><th>Suffix</th><th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, c], i) => (
            <tr key={i}>
              <td>
                <input className="ref-input" value={key}
                  onChange={e => renameKey(i, e.target.value)} />
              </td>
              <td>
                <input className="ref-input" value={c.base ?? ''}
                  onChange={e => updateCase(i, { base: e.target.value || undefined })} />
              </td>
              <td>
                <input className="ref-input" value={c.suffix ?? ''}
                  onChange={e => updateCase(i, { suffix: e.target.value || undefined })} />
              </td>
              <td>
                <button className="block-action-btn" onClick={() => removeCase(i)}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="open-file-btn" onClick={addCase}>Add case</button>
    </>
  );
}
