"use client";

import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { refusedToast, type Refused } from "@/lib/orderStatus";
import { useAppStable } from "./AppProvider";
import { readQueue, OFFLINE_EVENT } from "./offline";
import { flushQueue, isFlushing, OFFLINE_REFUSED_EVENT, OFFLINE_SYNCING_EVENT } from "./offlineReplay";
import { useOnline } from "@/lib/clientState";

// The queue's length and whether a replay is sending, read as stores (R17): each says itself when it changes — the queue
// on every write (components/offline writeQueue), the replay as it starts and stops — so the chip sets nothing of its
// own as it mounts. Another tab's write is the storage event.
const watchQueue = (change: () => void) => {
  window.addEventListener(OFFLINE_EVENT, change);
  window.addEventListener("storage", change);
  return () => { window.removeEventListener(OFFLINE_EVENT, change); window.removeEventListener("storage", change); };
};
const watchSyncing = (change: () => void) => {
  window.addEventListener(OFFLINE_SYNCING_EVENT, change);
  return () => window.removeEventListener(OFFLINE_SYNCING_EVENT, change);
};
const queuedNow = () => readQueue().length;

// OFFLINE CHIP — the crew's truth signal for connectivity. Shows the moment the console goes
// offline ("your taps are being saved"), the queued count, and "syncing" while the queue drains.
// Also OWNS the replay triggers: online event, tab-visible, and a safety-net interval while
// anything is queued. Nothing renders when online with an empty queue — the normal state is quiet.
export default function OfflineChip() {
  const { toast } = useAppStable();
  const online = useOnline();
  const queued = useSyncExternalStore(watchQueue, queuedNow, () => 0);
  const syncing = useSyncExternalStore(watchSyncing, isFlushing, () => false);

  // WHAT THE REPLAY COULD NOT SAVE IS SAID (2026-10-11, components/offlineReplay): it used to leave the queue without
  // a word. An order somebody else moved first is news, not a fault — the calm toast; anything else is an error.
  useEffect(() => {
    const onRefused = (e: Event) => {
      const list = (e as CustomEvent<Refused[]>).detail ?? [];
      if (list.length > 0) toast(refusedToast(list), list.every((r) => r.now !== null) ? "info" : "error");
    };
    window.addEventListener(OFFLINE_REFUSED_EVENT, onRefused);
    return () => window.removeEventListener(OFFLINE_REFUSED_EVENT, onRefused);
  }, [toast]);

  // The replay's triggers: the signal back, the tab back, a safety net while anything is queued, and once now for what a
  // previous session left. What the chip shows follows from the stores above.
  useEffect(() => {
    const flush = () => { if (readQueue().length > 0 && navigator.onLine !== false) void flushQueue(supabase); };
    const onVis = () => { if (document.visibilityState === "visible") flush(); };
    window.addEventListener("online", flush);
    document.addEventListener("visibilitychange", onVis);
    const timer = setInterval(flush, 20000); // safety net
    flush(); // drain anything left over from a previous session
    return () => {
      window.removeEventListener("online", flush);
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(timer);
    };
  }, []);

  if (online && queued === 0) return null;
  return (
    <div className={`offchip${online ? " on" : ""}`} role="status" aria-live="polite">
      <span className="offchip-dot" aria-hidden />
      {!online && <b>Offline</b>}
      {queued > 0 && <span>{syncing && online ? "Syncing" : "Saved"} {queued} update{queued === 1 ? "" : "s"}{!online ? " — will sync" : "…"}</span>}
      {!online && queued === 0 && <span>working locally — taps will sync</span>}
    </div>
  );
}
