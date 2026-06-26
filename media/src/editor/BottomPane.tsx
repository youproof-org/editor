interface Tab { id: string; label: string; panel: React.ReactNode; }
interface Props {
  tabs: Tab[];
  activeTabId: string;
  onTabChange: (id: string) => void;
}

export default function BottomPane({ tabs, activeTabId, onTabChange }: Props) {
  const active = tabs.find(t => t.id === activeTabId) ?? tabs[0];

  return (
    <div className="node-view-refs">
      {tabs.length > 1 && (
        <div className="bottom-pane-tabs">
          {tabs.map(t => (
            <button
              key={t.id}
              className={`bottom-pane-tab${t.id === active?.id ? ' bottom-pane-tab--active' : ''}`}
              onClick={() => onTabChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="bottom-pane-content">{active?.panel}</div>
    </div>
  );
}
