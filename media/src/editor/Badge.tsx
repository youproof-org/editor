export const BADGE: Record<string, string> = {
  definition: 'D', theorem: 'T', proof: 'P', remark: 'R',
  chapter: 'C', section: 'S', claim: '§', term: '★', external: 'E',
};

export function badgeChar(type: string): string {
  return BADGE[type] ?? type[0].toUpperCase();
}

export const EarthIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none"
    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <circle cx="8" cy="8" r="5.5" />
    <ellipse cx="8" cy="8" rx="2.5" ry="5.5" />
    <line x1="2.5" y1="8" x2="13.5" y2="8" />
  </svg>
);

export default function Badge({ type }: { type: string }) {
  return (
    <span className={`entity-badge badge-${type}`}>
      {type === 'external' ? <EarthIcon /> : badgeChar(type)}
    </span>
  );
}
