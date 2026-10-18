"use client";

import { useEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from "react";
import { announce } from "./Announcer";

// A LINE THAT IS SAID WHEN IT APPEARS OR CHANGES (R12 — the 10/10 audit's accessibility pass, F12). Twenty-one status
// regions were put on the page already holding their words — `{done && <div role="status">Free cup given</div>}` — the
// pattern Checkout's own comments say VoiceOver skips, so "Free cup given", "Couldn't use the credit" and "Canceled" went
// unheard. And whole cards were live regions, re-reading their buttons ("Running late ✓", "Canceling…") at each change.
//
// This draws its words where they belong, as plain text, and hands them to the app's live region (components/Announcer)
// whenever they appear or change: a failure assertively, anything else politely. `quietFirst` holds the first reading —
// for a line on a card that was already on the screen when the page came, which the page's own reading covers.
// R25 (the 10/10 audit, A11Y F12 again): `style` passes through, for the few lines drawn with one, and scripts/spoken.audit.mjs
// holds the count of status lines put on the page already holding their words at zero.
export default function Said({
  children, as = "div", className, assertive = false, quietFirst = false, id, style,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  assertive?: boolean;
  quietFirst?: boolean;
  id?: string;
  style?: CSSProperties;
}) {
  const As = as;
  const ref = useRef<HTMLElement>(null);
  const last = useRef<string | null>(null);
  useEffect(() => {
    const words = (ref.current?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (last.current === null && quietFirst) { last.current = words; return; }
    if (!words || words === last.current) return;
    last.current = words;
    announce(words, assertive ? "assertive" : "polite");
  });
  return <As ref={ref} className={className} id={id} style={style}>{children}</As>;
}
