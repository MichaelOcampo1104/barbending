import { useSyncExternalStore } from 'react';
import { fieldStatus } from './fieldStatus.js';

// Small viewport badge: "Building bars… 62%" while the field builds, or a fallback / error notice.
export default function FieldBadge() {
  const s = useSyncExternalStore(fieldStatus.subscribe, fieldStatus.get);
  if (!s.building && !s.message) return null;
  const text = s.message || `Building bars… ${Math.round((s.fraction || 0) * 100)}%`;
  return (
    <div
      style={{
        position: 'absolute', left: 12, bottom: 12, zIndex: 40, padding: '4px 10px', borderRadius: 6,
        fontSize: 12, pointerEvents: 'none', color: '#e2e8f0', border: '1px solid #334155',
        background: s.error ? 'rgba(127,29,29,.85)' : 'rgba(15,23,42,.85)',
      }}
    >
      {text}
    </div>
  );
}
