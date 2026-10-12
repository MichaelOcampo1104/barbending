// The override boxes of the BBS export's concrete-volume panel. A box left blank keeps the member's computed volume; a number typed in it
// (12.5 or 12,5, in m³) replaces that volume for this one export. Pure, so the panel and the tests share the same rules.

// One box's text → { ok, value } (value null when blank), or { ok: false, msg } with the reason to show beside the box.
export function parseVolumeInput(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return { ok: true, value: null };
  if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(s)) return { ok: false, msg: 'Use a number, e.g. 12.5' };
  const value = Number(s.replace(',', '.'));
  if (!(value > 0)) return { ok: false, msg: 'Must be above 0' };
  return { ok: true, value };
}

// The boxes of the members listed in `ids` (text: member id → what is typed in its box): the valid values as a Map (id → m³), and the
// reason for each refused box. `ok` is true when every box is blank or valid.
export function readVolumeInputs(ids, text) {
  const volumesM3 = new Map();
  const errors = {};
  for (const id of ids) {
    const r = parseVolumeInput(text[id]);
    if (!r.ok) errors[id] = r.msg;
    else if (r.value !== null) volumesM3.set(id, r.value);
  }
  return { ok: Object.keys(errors).length === 0, volumesM3, errors };
}
