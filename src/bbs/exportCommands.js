import { useStore } from '../store.js';
import { bbsSchedule, concreteBlockMembers, downloadBbsCsv } from './csv.js';

// Every BBS CSV button comes through here. A file with concrete volumes in it opens the volume panel first, and what is typed there is for
// that file only. A file without any (a ▦ group's own bars, the unhosted filter) is written at once, as before.
export function startBbsExport(bars, memberIds, filename) {
  const { concretes, openVolumeExport } = useStore.getState();
  if (!concreteBlockMembers(concretes, memberIds).length) {
    downloadBbsCsv(bars, concretes, filename, { memberIds });
    return;
  }
  openVolumeExport({ bars, memberIds, filename, steelKg: bbsSchedule(bars, concretes).steelKg });
}

// The panel's Export: writes the file it was opened for, with the volumes typed in it (volumesM3: a Map of member id → m³).
export function finishBbsExport(volumesM3) {
  const { volumeExport, concretes, closeVolumeExport } = useStore.getState();
  closeVolumeExport();
  if (volumeExport) downloadBbsCsv(volumeExport.bars, concretes, volumeExport.filename, { memberIds: volumeExport.memberIds, volumesM3 });
}
