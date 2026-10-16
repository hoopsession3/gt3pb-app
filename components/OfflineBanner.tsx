"use client";

import { useEffect, useState } from "react";
import { announce } from "./Announcer";

// OFFLINE BANNER (blind-spot round, 2026-08-01): the truck's whole register is this app, and truck
// days happen in dead zones. The service worker already keeps the shell + visited pages usable
// offline — this makes the STATE visible instead of letting a stale screen impersonate a live one.
// Orders correctly still need a connection; the banner says so before a customer taps Pay.
//
// IN THE COLUMN, AND SAID (R12 — the 10/10 audit, F22 and F12). It was laid over the top of the window, on the title bar's
// Back and the masthead's account pill — offline, exactly when someone wants to back out — and it was a status region
// inserted already holding its words, which VoiceOver skips. It sits at the top of the app's column now, pushing the
// page down, and going offline (and back) is said through the app's live region.
const OFFLINE_WORDS = "You're offline — showing the last saved view. Ordering needs a connection.";

export default function OfflineBanner() {
  const [off, setOff] = useState(false);
  useEffect(() => {
    let was = typeof navigator !== "undefined" && !navigator.onLine;
    setOff(was);
    if (was) announce(OFFLINE_WORDS);
    const goOn = () => { if (!was) return; was = false; setOff(false); announce("Back online."); };
    const goOff = () => { if (was) return; was = true; setOff(true); announce(OFFLINE_WORDS); };
    window.addEventListener("online", goOn);
    window.addEventListener("offline", goOff);
    return () => { window.removeEventListener("online", goOn); window.removeEventListener("offline", goOff); };
  }, []);
  if (!off) return null;
  return <div className="offline-bar">You&rsquo;re offline — showing the last saved view. Ordering needs a connection.</div>;
}
