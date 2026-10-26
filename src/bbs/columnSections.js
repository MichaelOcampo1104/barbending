// A box column whose size changes up its height (spec 11). Its concrete volume follows its column schedule: each section runs from its height
// above the member's base to the next section's height, and the last one runs to the top of the member. Heights and sizes are in mm.

// The sections of a schedule's resolved rows (bottom first, as resolveSchedule gives them): a new section wherever the SIZE changes.
export function sectionsOfRows(rows) {
  const out = [];
  for (const r of rows || []) {
    const last = out[out.length - 1];
    if (last && last.lx === r.size.lx && last.ly === r.size.ly) continue;
    out.push({ from: r.h, lx: r.size.lx, ly: r.size.ly });
  }
  return out;
}

// Whether a member carries sections of more than one size. A column of one size uses its box.
export function hasSections(c) {
  return Array.isArray(c?.sections) && c.sections.length > 1;
}

// The volume in m³ of a list of sections up to a height in mm: each section's area times its height.
export function sectionVolumeM3(sections, heightMm) {
  let mm3 = 0;
  sections.forEach((s, i) => {
    const to = i + 1 < sections.length ? sections[i + 1].from : heightMm;
    mm3 += Number(s.lx) * Number(s.ly) * Math.max(0, to - Number(s.from));
  });
  return mm3 / 1e9;
}
