// HOW LONG A TOAST STAYS (R12 — the 10/10 audit's accessibility pass, F3). It was three seconds for a success, 4.2 for
// an error and five for one with an Undo, whatever it said: a 90-character error was gone before a slow reader reached
// its end, and an Undo was gone before a VoiceOver user could swipe to it. Now the words set the time — about seventeen
// characters a second and a beat to look — with a floor for each kind: an error longer than news, one with something to
// do longest of all. A finger on it or focus in it stops the clock (AppProvider holdToast), and every toast is said to a
// screen reader the moment it shows (components/Announcer), so nobody has to catch it to hear it.

export type ToastKind = "success" | "error" | "info";

/** Milliseconds a toast saying `msg` stays on screen. */
export function toastHoldMs(msg: string, kind: ToastKind, hasAction: boolean): number {
  const reading = 1500 + 60 * [...String(msg ?? "")].length;
  const floor = hasAction ? 10_000 : kind === "error" ? 6_000 : 4_000;
  const ceiling = hasAction ? 15_000 : 12_000;
  return Math.min(ceiling, Math.max(floor, reading));
}

/** Once let go, what is left — never less than this, so a toast someone just let go of is not gone at once. */
export const TOAST_AFTER_HOLD_MS = 2_000;
