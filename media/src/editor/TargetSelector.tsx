import { useState } from 'react';
import Badge, { EarthIcon } from './Badge';
import type { ContentTargetObject } from '../shared/types';

export interface TargetSelectorProps {
  target:              ContentTargetObject | undefined;
  allowedTypes:        string[];
  settingUrl:          boolean;
  selectingTarget:     boolean;
  anySelecting:        boolean;
  onBeginSelectTarget: () => void;
  onEndSelectTarget:   (result: ContentTargetObject | null) => void;
  onSetUrl:            (url: string) => void;
  onClearTarget:       () => void;
  onStartSettingUrl:   () => void;
  onOpenTarget:        () => void;
}

export default function TargetSelector({
  target, allowedTypes, settingUrl, selectingTarget, anySelecting,
  onBeginSelectTarget, onEndSelectTarget, onSetUrl, onClearTarget, onStartSettingUrl, onOpenTarget,
}: TargetSelectorProps) {
  const [urlInput, setUrlInput] = useState('');
  const allowsExternal = allowedTypes.includes('external');

  if (settingUrl) return (
    <div className="target-selector">
      <EarthIcon />
      <input autoFocus className="ref-url-input"
        value={urlInput}
        onChange={e => setUrlInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && urlInput.trim()) { onSetUrl(urlInput.trim()); setUrlInput(''); }
          else if (e.key === 'Escape') { onClearTarget(); setUrlInput(''); }
        }}
        onBlur={() => { onClearTarget(); setUrlInput(''); }}
      />
    </div>
  );

  if (selectingTarget) return (
    <div className="target-selector">
      <span className="ref-selecting-label">Selecting…</span>
      <button className="ref-cancel-select-btn" onClick={() => onEndSelectTarget(null)}>Cancel</button>
    </div>
  );

  if (target) return (
    <div className="target-selector">
      <div className="ref-target-display">
        <Badge type={target.type} />
        <span className="ref-target-label">{target.label}</span>
        <div className="ref-target-overlay">
          <button className="ref-target-action-btn" onClick={onClearTarget}>Clear</button>
          <button className="ref-target-action-btn" onClick={onOpenTarget}>Open</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="target-selector">
      <button className="ref-select-btn" disabled={anySelecting}
        onClick={onBeginSelectTarget}>Select</button>
      {allowsExternal && (
        <button className="ref-set-url-btn" disabled={anySelecting}
          onClick={onStartSettingUrl}>Set URL</button>
      )}
    </div>
  );
}
