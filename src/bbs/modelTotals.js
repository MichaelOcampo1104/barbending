import { enrichBar, concreteBlockRows, rebarRatioKgM3 } from './csv.js';

// The figures of the standalone viewer's totals line, worked out the same way in the viewer and in the app's export panel, so the panel
// shows what the file will show. rows: one per bar with its copies and steel (rowsOf); volumesM3: the volumes typed for that file (a Map of
// member id → m³, or null). The computed figures count every member, hidden or not, as the app's BBS header does. The typed figures are
// null when no volume was typed.
export function totalsOf(rows, concretes, volumesM3 = null) {
  const bars = rows.reduce((s, r) => s + (r.copies || 1), 0);
  const kg = rows.reduce((s, r) => s + (r.kg || 0), 0);
  const members = concreteBlockRows(concretes, null, volumesM3);
  const computedM3 = members.reduce((s, m) => s + m.computedM3, 0);
  const typedMembers = members.filter((m) => m.source === 'typed');
  const typedM3 = typedMembers.length ? members.reduce((s, m) => s + m.volumeM3, 0) : null;
  return {
    bars, kg, computedM3, ratio: rebarRatioKgM3(kg, computedM3),
    typedM3, typedRatio: typedM3 == null ? null : rebarRatioKgM3(kg, typedM3), typedMembers,
  };
}

// The rows totalsOf reads: one per bar, with its copies and its steel (the values the viewer's own rows carry).
export function rowsOf(bars, concretes) {
  return bars.map((b) => {
    const e = enrichBar(b, concretes);
    return { copies: e._copies, kg: e.Weight_kg };
  });
}
