"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// THE ONE PLACE THE CREW'S VOICE BECOMES TEXT.
//
// Two buttons in this app dictate: Ask GT3's mic and the QuickDock note pad's mic. They were two
// copies of the same twelve lines — the same capability sniff, the same recogniser options, the
// same three handlers — living in two files. Both are reached from the SAME floating dock, because
// QuickDock renders <AskGT3 /> in one tab and QuickNote in the next.
//
// That duplication is not a style complaint; it is why a fix did not land. On 2026-09-12 the Ask
// GT3 mic's emoji 🎙 (rendered in Arial, next to a row of vector icons) was replaced with
// <Icon name="mic" />. The QuickNote mic one tab over kept the emoji, because it was a copy rather
// than the same button. One defect, one fix, and the fix reached half of it.
//
// So: one hook. `supported` is the capability check every caller needs before drawing a button at
// all — the API is Chrome/Safari-only and absent on Firefox, and a mic that does nothing is worse
// than no mic.

// The vendor-prefixed constructor. Typed loosely on purpose: this is a browser API with no DOM lib
// definition, and pretending otherwise would mean hand-writing a type nobody can verify.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Recognizer = any;

function recognizerCtor(): Recognizer | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export type Dictation = {
  /** False on browsers without the API — draw no mic at all rather than a dead one. */
  supported: boolean;
  /** True while the recogniser is live, for aria-pressed and the button's lit state. */
  listening: boolean;
  /** Start listening, or stop if already listening. Safe to call when unsupported. */
  toggle: () => void;
};

/**
 * Dictate one utterance.
 *
 * `onText` receives the final transcript. Single-shot by design (interimResults off, one
 * alternative): both callers want a finished sentence they can send or append, not a live stream.
 * Held in a ref so a caller can pass an inline arrow without restarting the recogniser.
 */
export function useDictation(onText: (text: string) => void): Dictation {
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const cbRef = useRef(onText);
  // In an effect, not during render. Writing a ref while rendering is the react-hooks/refs error,
  // and it is a real rule rather than a style one: React may render without committing, so the
  // latest callback is only safely the committed one after the commit.
  useEffect(() => { cbRef.current = onText; });

  // Both copies leaked a live recogniser when the sheet closed mid-sentence: nothing stopped it on
  // unmount, so the mic stayed hot on a component nobody could see. One hook, one place to fix it.
  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* already stopped */ } }, []);

  const toggle = useCallback(() => {
    const SR = recognizerCtor();
    if (!SR) return;
    if (listening) { recRef.current?.stop(); return; }
    const rec = new SR();
    recRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: Recognizer) => { const t = e?.results?.[0]?.[0]?.transcript; if (t) cbRef.current(t); };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  }, [listening]);

  // Read at render, not once at module load: this file is imported on the server, where there is
  // no window, and a value captured then would say "unsupported" forever.
  return { supported: recognizerCtor() !== null, listening, toggle };
}
