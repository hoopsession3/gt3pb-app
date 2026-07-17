// Global "Edit copy" mode — owner-only, on-page toggle for EditableCopy (components/EditableCopy.tsx).
// Same localStorage + custom-event pattern as DisplayToggle's gt3-display (components/DisplayToggle.tsx):
// no Context/provider needed, every mounted EditableCopy instance and the EditModeToggle button itself
// just listen for the event and re-read. Off by default and NOT synced anywhere but this browser — an
// owner turns it on when they're about to make a pass on copy, off when they're done browsing normally.
export const EDIT_MODE_KEY = "gt3-copy-edit";

export function readEditMode(): boolean {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(EDIT_MODE_KEY) === "1"; } catch { return false; }
}

export function writeEditMode(on: boolean) {
  try { localStorage.setItem(EDIT_MODE_KEY, on ? "1" : "0"); } catch { /* ignore */ }
  window.dispatchEvent(new Event(EDIT_MODE_KEY)); // live-apply in every mounted EditableCopy
}
