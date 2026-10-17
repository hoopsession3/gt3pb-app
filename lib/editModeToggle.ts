"use client";

import { devicePref, useDevicePref } from "./devicePref";

// Global "Edit copy" mode — owner-only, on-page toggle for EditableCopy (components/EditableCopy.tsx). Off by default and
// NOT synced anywhere but this browser — an owner turns it on when they're about to make a pass on copy, off when
// they're done browsing normally.
//
// A setting this phone keeps, so it is lib/devicePref's (R17): every reader — each EditableCopy, the rail's toggle, the
// account menu's row — follows the switch the moment it is flipped, here or in another tab, with no effect setting state
// as it mounts and no second store of its own beside the one the shell already carries. Off on the server and while
// hydrating.
export const EDIT_MODE_KEY = "gt3-copy-edit";
const EDIT_MODE = devicePref(EDIT_MODE_KEY);

export function writeEditMode(on: boolean): void {
  EDIT_MODE.write(on ? "1" : "0");
}

export function useEditMode(): boolean {
  return useDevicePref(EDIT_MODE) === "1";
}
