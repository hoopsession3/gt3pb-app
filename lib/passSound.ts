"use client";

import { devicePref, useDevicePref } from "./devicePref";

// THE PASS'S SOUND HAS ONE HOME (2026-10-06, the settings round). The chime for a new order is muted
// per phone ("kds_muted"). The Pass read it once when it opened and kept its own copy, so it could
// only be changed on the Pass itself. Settings › You › Pass sound changes it too, and the Pass keeps
// its own bell. Both read and write it here, so neither one is ever out of date.

export const PASS_SOUND = devicePref("kds_muted");

/** What a stored value means. Only "1" is muted; the chime is on by default. */
export const passMutedFrom = (raw: string | null | undefined): boolean => raw === "1";

/** Whether the pass is muted on this phone, as this render should draw it. */
export function usePassMuted(): boolean {
  return passMutedFrom(useDevicePref(PASS_SOUND));
}

/** Mute or unmute the pass on this phone. The Pass and Settings both redraw. */
export function setPassMuted(muted: boolean): void {
  PASS_SOUND.write(muted ? "1" : "0");
}

// ONE CHIME PER ORDER (2026-10-11). An admin's phone also hears every new order from components/Notifications,
// wherever it is in the app — a second chime on top of the Pass's own while the Pass was open, and one the pass's mute
// never reached. That chime asks here first. The Pass says when it is up (app/crew/page.tsx Kitchen).
let passUp = false;
export const setPassUp = (up: boolean): void => { passUp = up; };

/** May a new order chime outside the Pass? Not while the Pass is open (it rings its own), and never when muted. */
export const passRings = (): boolean => !passUp && !passMutedFrom(PASS_SOUND.read());
