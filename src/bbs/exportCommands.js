import { useStore } from '../store.js';
import { bbsSchedule, concreteBlockMembers, downloadBbsCsv } from './csv.js';
import { rowsOf, totalsOf } from './modelTotals.js';
import { loadViewerTemplate } from '../standalone/exportViewer.js';
import { packViewerHtml, viewerFileName } from '../standalone/pack.js';

// Every export that writes a file with concrete volumes in it comes through here: the ⤓ BBS CSV buttons and ⤓ Viewer. The volume panel
// (ExportVolumes.jsx) opens first when the file has a member in it, and what is typed there is for that file only. A file without any (a ▦
// group's own bars, the unhosted filter, a model with no concrete) is written at once, as before.

// The ⤓ BBS CSV buttons: the bars, the members whose block the file lists (null = every member), and the file name.
export function startBbsExport(bars, memberIds, filename) {
  const { concretes, openVolumeExport } = useStore.getState();
  if (!concreteBlockMembers(concretes, memberIds).length) {
    downloadBbsCsv(bars, concretes, filename, { memberIds });
    return;
  }
  openVolumeExport({ kind: 'bbs', bars, memberIds, filename, steelKg: bbsSchedule(bars, concretes).steelKg });
}

// ⤓ Viewer, once its title is given: the whole model, every member. The panel's steel total is the viewer's own, so the figures it shows are
// the figures the file shows.
export async function startViewerExport(title) {
  const { bars, concretes, openVolumeExport } = useStore.getState();
  if (!concretes.length) return buildViewerFile(title, null);
  openVolumeExport({ kind: 'viewer', title, bars, memberIds: null, steelKg: totalsOf(rowsOf(bars, concretes), concretes).kg });
}

// Packs the model into the viewer template and downloads it. volumesM3 (a Map of member id → m³, or null) is what the panel typed. It goes
// beside the project data, where the viewer reads it, and only when something was typed.
export async function buildViewerFile(title, volumesM3) {
  const template = await loadViewerTemplate({ url: `${import.meta.env.BASE_URL}viewer-template.html` });
  const project = useStore.getState()._projectData();
  const payload = volumesM3 && volumesM3.size ? { ...project, typedVolumes: Object.fromEntries(volumesM3) } : project;
  const html = await packViewerHtml(template, payload, { title });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = viewerFileName(title, new Date());
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  console.info(`[save] exported viewer file: ${a.download} (${Math.round(html.length / 1024)} KB)`);
}

// The panel's Export: writes the file the panel was opened for, with the volumes typed in it (volumesM3: a Map of member id → m³). A viewer
// file takes a moment to pack, so the panel stays open ("Building…") until it is written. A failure is shown as an alert, as before.
export async function finishVolumeExport(volumesM3) {
  const exp = useStore.getState().volumeExport;
  try {
    if (!exp) return;
    if (exp.kind === 'viewer') await buildViewerFile(exp.title, volumesM3);
    else downloadBbsCsv(exp.bars, useStore.getState().concretes, exp.filename, { memberIds: exp.memberIds, volumesM3 });
  } catch (err) {
    alert(err && err.message ? err.message : String(err));
  } finally {
    useStore.getState().closeVolumeExport();
  }
}
