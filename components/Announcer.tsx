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

/** Say `text` to a screen reader without moving focus. "assertive" interrupts: errors only. The same words said twice
 *  are said twice. */
export function announce(text: string, politeness: Politeness = "polite"): void {
  const words = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!words) return;
  if (!listeners.size) { waiting = { text: words, politeness }; return; }
  for (const say of listeners) say(words, politeness);
}

/** How long a message stays in its region once said: long enough for a slow voice to finish it, then gone. */
export const HOLD_MS = 7000;

export default function Announcer() {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  useEffect(() => {
    // One message at a time per region: a newer one cancels what was still on its way in or waiting to be emptied.
    const timers: Record<Politeness, ReturnType<typeof setTimeout>[]> = { polite: [], assertive: [] };
    const say: Say = (text, politeness) => {
      const set = politeness === "assertive" ? setAssertive : setPolite;
      for (const t of timers[politeness]) clearTimeout(t);
      // Emptied first, filled a beat later: the region changes even when the words are the ones it last said.
      set("");
      timers[politeness] = [setTimeout(() => set(text), 50), setTimeout(() => set(""), 50 + HOLD_MS)];
    };
    listeners.add(say);
    if (waiting) { const w = waiting; waiting = null; say(w.text, w.politeness); }
    return () => {
      listeners.delete(say);
      for (const t of [...timers.polite, ...timers.assertive]) clearTimeout(t);
    };
  }, []);
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-announcer="polite">{polite}</div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true" data-announcer="assertive">{assertive}</div>
    </>
  );
}
