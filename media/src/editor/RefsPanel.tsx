import { useState, useEffect, useRef } from 'react';
import type { ContentReference, ContentTargetObject, GetReferenceDisplaySuggestionsResponse } from '../shared/types';
import { useClient } from '../shared/clientContext';
import RefTargetCell from './RefTargetCell';
import SuggestionInput from './SuggestionInput';

interface Props {
  references:          ContentReference[];
  targetObjects:       Record<string, ContentTargetObject>;
  onRefChange:         (id: string, field: 'name' | 'display', value: string) => void;
  highlightedName?:    string | null;
  onInsert?:           (name: string) => void;
  selectingRefId:      string | null;
  onBeginSelectTarget: (refId: string) => void;
  onEndSelectTarget:   (result: ContentTargetObject | null) => void;
  onSetUrl:            (refId: string, url: string) => void;
  onClearTarget:       (refId: string) => void;
  onOpenTarget:        (targetId: string, targetType: string) => void;
  onSelect?:           (refId: string) => void;
}

export default function RefsPanel({
  references, targetObjects, onRefChange, highlightedName, onInsert,
  selectingRefId, onBeginSelectTarget, onEndSelectTarget, onSetUrl, onClearTarget, onOpenTarget,
  onSelect,
}: Props) {
  const client                                = useClient();
  const [colWidths, setColWidths]             = useState<(number | null)[]>([null, null]);
  const [settingUrlRefId, setSettingUrlRefId] = useState<string | null>(null);
  const resizeState       = useRef<{ col: 0 | 1; startX: number; startW: number } | null>(null);
  const highlightedRowRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    highlightedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [highlightedName]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const rs = resizeState.current;
      if (!rs) return;
      setColWidths(prev => {
        const next = [...prev];
        next[rs.col] = Math.max(50, rs.startW + (e.clientX - rs.startX));
        return next;
      });
    };
    const onUp = () => { resizeState.current = null; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
  }, []);

  return (
    <table className="refs-table refs-table--refs">
      <colgroup>
        <col style={{ width: 28 }} />
        <col style={colWidths[0] != null ? { width: colWidths[0] } : undefined} />
        <col style={colWidths[1] != null ? { width: colWidths[1] } : undefined} />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th className="refs-table-th--icon" />
          <th>Name<span className="col-resizer"
            onMouseDown={e => {
              e.preventDefault();
              const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
              const startW = colWidths[0] ?? th.getBoundingClientRect().width;
              resizeState.current = { col: 0, startX: e.clientX, startW };
            }}
            onDoubleClick={e => { e.preventDefault(); setColWidths(prev => { const next = [...prev]; next[0] = null; return next; }); }} /></th>
          <th>Display<span className="col-resizer"
            onMouseDown={e => {
              e.preventDefault();
              const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
              const startW = colWidths[1] ?? th.getBoundingClientRect().width;
              resizeState.current = { col: 1, startX: e.clientX, startW };
            }}
            onDoubleClick={e => { e.preventDefault(); setColWidths(prev => { const next = [...prev]; next[1] = null; return next; }); }} /></th>
          <th>Target</th>
        </tr>
      </thead>
      <tbody>
        {references.map(r => {
          const isDup   = references.filter(x => x.name === r.name).length > 1;
          const tgtInfo = r.targetId ? targetObjects[r.targetId] : undefined;
          const fetchSuggestions = tgtInfo
            ? () => client.request<GetReferenceDisplaySuggestionsResponse>(
                'getReferenceDisplaySuggestions', { type: tgtInfo.type }
              ).then(d => d.suggestions)
            : null;
          return (
            <tr key={r.id}
              ref={r.name === highlightedName ? highlightedRowRef : null}
              className={r.name === highlightedName ? 'ref-row--active' : undefined}
              onFocus={() => onSelect?.(r.id)}
              onClick={() => onSelect?.(r.id)}>
              <td className="refs-table-td--icon"><button className="row-insert-btn ref-row-icon" onClick={() => onInsert?.(r.name)}>→</button></td>
              <td>
                <input
                  className={`ref-input${isDup ? ' ref-input--dup' : ''}`}
                  value={r.name}
                  onChange={e => {
                    const v = e.target.value;
                    if (!v) return;
                    if (references.some(r2 => r2.id !== r.id && r2.name === v)) return;
                    onRefChange(r.id, 'name', v);
                  }}
                />
              </td>
              <td>
                <SuggestionInput
                  className="ref-input"
                  value={r.display}
                  onChange={v => onRefChange(r.id, 'display', v)}
                  fetchSuggestions={fetchSuggestions}
                />
              </td>
              <RefTargetCell
                tgtInfo={tgtInfo}
                settingUrl={settingUrlRefId === r.id}
                selectingTarget={selectingRefId === r.id}
                anySelecting={selectingRefId !== null}
                onBeginSelectTarget={() => onBeginSelectTarget(r.id)}
                onEndSelectTarget={onEndSelectTarget}
                onSetUrl={url => { onSetUrl(r.id, url); setSettingUrlRefId(null); }}
                onClearTarget={() => { onClearTarget(r.id); setSettingUrlRefId(null); }}
                onStartSettingUrl={() => setSettingUrlRefId(r.id)}
                onOpenTarget={() => onOpenTarget(tgtInfo!.id, tgtInfo!.type)}
              />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
