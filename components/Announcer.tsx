"use client";

import { useEffect, useState } from "react";

// SAID ONCE, TO A SCREEN READER (R12 — the 10/10 audit's accessibility pass, F12). A live region only speaks when its
// words CHANGE after it is on the page: one inserted already holding its words is skipped by VoiceOver (the rule
// Checkout's own comments wrote down and the rest of the app did not follow), and a role flipped on a region at the
// moment its text changes is announced unreliably (the toast did both). So there are two regions, here, for the whole
// app — one polite, one assertive — always on the page, always empty until something is said, and emptied again after
// a while so a swipe through the page later does not find an old message. announce() puts words in one of them.
//
// What it is for: a change that happens somewhere the person is not looking — a drink added from its row, a step of a
// form that replaced the last, a section of the console opened, a toast. What it is not for: words a screen already
// shows where focus lands (those are read anyway), or anything that needs a decision (that is a dialog).

type Politeness = "polite" | "assertive";
type Say = (text: string, politeness: Politeness) => void;

const listeners = new Set<Say>();
// Said before the regions were on the page (the first paint, a crash screen) — kept for them, the newest only.
let waiting: { text: string; politeness: Politeness } | null = null;
// SAID INSIDE THE DIALOG THAT IS OPEN (R33, 2026-10-18 — the audit's UX11-01). The app's two regions sit outside every
// dialog, and a dialog that is aria-modal makes what is outside it inert: VoiceOver and the browsers leave it out, so
// what was said while a sheet was open — a checkout's held payment, the delete-account code sent, a crew save that
// failed — went unheard. Each modal draws its own pair (ModalAnnouncer), empty from the moment it opens, and what is
// said goes to the top one while any is open.
const modalStack: Say[] = [];

/** Say `text` to a screen reader without moving focus. "assertive" interrupts: errors only. The same words said twice
 *  are said twice. Into the open dialog's own regions while one is open (R33). */
export function announce(text: string, politeness: Politeness = "polite"): void {
  const words = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!words) return;
  const top = modalStack[modalStack.length - 1];
  if (top) { top(words, politeness); return; }
  if (!listeners.size) { waiting = { text: words, politeness }; return; }
  for (const say of listeners) say(words, politeness);
}

/** How long a message stays in its region once said: long enough for a slow voice to finish it, then gone. */
export const HOLD_MS = 7000;

/** A region pair's own saying: one message at a time per region — a newer one cancels what was still on its way in or
 *  waiting to be emptied — emptied first and filled a beat later, so the region changes even for words it last said. */
function useRegions(register: (say: Say) => () => void) {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  useEffect(() => {
    const timers: Record<Politeness, ReturnType<typeof setTimeout>[]> = { polite: [], assertive: [] };
    const say: Say = (text, politeness) => {
      const set = politeness === "assertive" ? setAssertive : setPolite;
      for (const t of timers[politeness]) clearTimeout(t);
      set("");
      timers[politeness] = [setTimeout(() => set(text), 50), setTimeout(() => set(""), 50 + HOLD_MS)];
    };
    const off = register(say);
    return () => {
      off();
      for (const t of [...timers.polite, ...timers.assertive]) clearTimeout(t);
    };
  }, [register]);
  return { polite, assertive };
}

const registerApp = (say: Say) => {
  listeners.add(say);
  if (waiting) { const w = waiting; waiting = null; say(w.text, w.politeness); }
  return () => { listeners.delete(say); };
};
const registerModal = (say: Say) => {
  modalStack.push(say);
  return () => { const i = modalStack.lastIndexOf(say); if (i >= 0) modalStack.splice(i, 1); };
};

export default function Announcer() {
  const { polite, assertive } = useRegions(registerApp);
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-announcer="polite">{polite}</div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true" data-announcer="assertive">{assertive}</div>
    </>
  );
}

/** The regions inside a modal dialog (R33 — UX11-01): drawn by every aria-modal dialog, empty as it opens, and the top one
 *  hears announce() while it is open. */
export function ModalAnnouncer() {
  const { polite, assertive } = useRegions(registerModal);
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-announcer="modal-polite">{polite}</div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true" data-announcer="modal-assertive">{assertive}</div>
    </>
  );
}
