"use client";

import { useEffect, useRef } from "react";
import { announce } from "./Announcer";
import { useOnline } from "@/lib/clientState";

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
  // The network read as a store (lib/clientState, R17): online on the server and while hydrating, the browser's answer
  // after. Saying it is outside React, so the effect only speaks — once when the page finds itself offline, and on each
  // change after that.
  const online = useOnline();
  const said = useRef<boolean | null>(null);
  useEffect(() => {
    if (said.current === null) { said.current = online; if (!online) announce(OFFLINE_WORDS); return; }
    if (said.current === online) return;
    said.current = online;
    announce(online ? "Back online." : OFFLINE_WORDS);
  }, [online]);
  if (online) return null;
  return <div className="offline-bar">You&rsquo;re offline — showing the last saved view. Ordering needs a connection.</div>;
}
