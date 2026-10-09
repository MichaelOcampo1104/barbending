import { useStore } from '../store.js';
import { addToGroupRows, removeFromGroupRows } from './groups.js';

// The commands behind the group buttons (the table's group header, the Groups list, the Set card): they act on the live selection, ask first
// when a face-sketch group would stop being re-spreadable, and say why when there is nothing to do. The rules are in groups.js, the undoable
// actions in the store; this is only the dialogue. Each returns true when the model changed.

// The question asked before a face-sketch group changes.
export function sketchWarning(ids) {
  const many = ids.length > 1;
  return `${ids.join(', ')} ${many ? 'were drawn from face sketches' : 'was drawn from a face sketch'}. `
    + `Changing which bars are in ${many ? 'them' : 'it'} makes ${many ? 'them ordinary groups' : 'it an ordinary group'}: `
    + `${many ? 'they can' : 'it can'} no longer re-spread from the sketch (lengths, Move and the other group edits keep working). Continue?`;
}

// Add the selected bars to the group (the ones that are not in it yet; a bar in another group moves over).
export function addSelectedToGroup(setId) {
  const s = useStore.getState();
  const sel = s.selectedBars || [];
  const plan = addToGroupRows(s.bars, sel, setId); // a dry run: nothing is applied until the user has agreed
  if (!plan.ok) { window.alert(plan.msg); return false; }
  if (plan.sketchLost.length && !window.confirm(sketchWarning(plan.sketchLost))) return false;
  const r = s.addToGroup(setId, sel);
  if (!r.ok) { window.alert(r.msg); return false; }
  return true;
}

// Take the selected bars that are in the group out of it (they keep all their dimensions and edit solo again).
export function removeSelectedFromGroup(setId) {
  const s = useStore.getState();
  const sel = s.selectedBars || [];
  const plan = removeFromGroupRows(s.bars, sel, setId);
  if (!plan.ok) { window.alert(plan.msg); return false; }
  if (plan.sketchLost.length && !window.confirm(sketchWarning(plan.sketchLost))) return false;
  const r = s.removeFromGroup(setId, sel);
  if (!r.ok) { window.alert(r.msg); return false; }
  return true;
}
