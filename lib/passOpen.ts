// THE PASS STAYS OPEN THROUGH A RELOAD (R11, 2026-10-16 — the 10/10 audit).
//
// Whether the Pass was open lived only in the page's memory, so anything that reloaded the page — the self-heal after a
// deploy (app/error.tsx), the update banner tapped in another tab, the crash screen's Reload, iOS relaunching an app it
// had closed in the background — put a Pass phone back on Live Ops with the Pass shut and the screen free to lock, and a
// locked phone rings for nobody. The phone keeps the fact now: for PASS_REOPEN_MS after the Pass was last open, the
// console opens it again; Exit, or leaving Live Ops, forgets it. Signing out takes it off the phone (lib/accountWipe).
export const PASS_OPEN_KEY = "gt3-pass-open";
/** As long as the board the Pass saved for no signal is shown (lib/offline snapshotUsable). */
export const PASS_REOPEN_MS = 2 * 60 * 60 * 1000;
/** How often an open Pass says it is still open. */
export const PASS_OPEN_BEAT_MS = 5 * 60 * 1000;

/** Was the Pass open recently enough to open it again? `raw` is what the phone kept: when it was last open. Pure. */
export function passStillOpen(raw: string | null | undefined, nowMs: number): boolean {
  const at = Number(raw);
  return Number.isFinite(at) && at > 0 && nowMs >= at && nowMs - at < PASS_REOPEN_MS;
}

export function keepPassOpen(open: boolean): void {
  try {
    if (open) localStorage.setItem(PASS_OPEN_KEY, String(Date.now()));
    else localStorage.removeItem(PASS_OPEN_KEY);
  } catch { /* storage refused: the Pass is not reopened, as before */ }
}

export function passWasOpen(): boolean {
  try { return passStillOpen(localStorage.getItem(PASS_OPEN_KEY), Date.now()); } catch { return false; }
}
