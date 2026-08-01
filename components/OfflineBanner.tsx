"use client";

import { useEffect, useState } from "react";

// OFFLINE BANNER (blind-spot round, 2026-08-01): the truck's whole register is this app, and truck
// days happen in dead zones. The service worker already keeps the shell + visited pages usable
// offline — this makes the STATE visible instead of letting a stale screen impersonate a live one.
// Orders correctly still need a connection; the banner says so before a customer taps Pay.
export default function OfflineBanner() {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const goOn = () => setOff(false);
    const goOff = () => setOff(true);
    setOff(typeof navigator !== "undefined" && !navigator.onLine);
    window.addEventListener("online", goOn);
    window.addEventListener("offline", goOff);
    return () => { window.removeEventListener("online", goOn); window.removeEventListener("offline", goOff); };
  }, []);
  if (!off) return null;
  return <div className="offline-bar" role="status">You&rsquo;re offline — showing the last saved view. Ordering needs a connection.</div>;
}
