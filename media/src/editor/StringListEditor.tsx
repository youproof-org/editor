import React from 'react';

interface Props {
  items: string[];
  onChange: (items: string[]) => void;
}

export default function StringListEditor({ items, onChange }: Props) {
  if (items.length === 0) {
    return (
      <div className="synonym-cell">
        <input
          className="synonym-insert-input synonym-insert-input--hint"
          placeholder="add item"
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const v = e.currentTarget.value.trim();
              if (v) { onChange([v]); e.currentTarget.value = ''; e.currentTarget.blur(); }
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="synonym-cell">
      {items.map((item, i) => (
        <React.Fragment key={i}>
          <span className="synonym-chip">
            {item}
            <button
              className="synonym-remove"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >×</button>
          </span>
          <input
            className="synonym-insert-input"
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const v = e.currentTarget.value.trim();
                if (v) {
                  onChange([...items.slice(0, i + 1), v, ...items.slice(i + 1)]);
                  e.currentTarget.value = '';
                  e.currentTarget.blur();
                }
              }
            }}
          />
        </React.Fragment>
      ))}
    </div>
  );
}
