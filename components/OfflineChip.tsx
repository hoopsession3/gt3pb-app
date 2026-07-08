"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { readQueue, flushQueue, OFFLINE_EVENT } from "./offline";

// OFFLINE CHIP — the crew's truth signal for connectivity. Shows the moment the console goes
// offline ("your taps are being saved"), the queued count, and "syncing" while the queue drains.
// Also OWNS the replay triggers: online event, tab-visible, and a safety-net interval while
// anything is queued. Nothing renders when online with an empty queue — the normal state is quiet.
export default function OfflineChip() {
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine !== false);
    setQueued(readQueue().length);
    let timer: ReturnType<typeof setInterval> | null = null;

    const flush = async () => {
      if (readQueue().length === 0 || navigator.onLine === false) return;
      setSyncing(true);
      const left = await flushQueue(supabase);
      setQueued(left);
      setSyncing(false);
    };
    const onQueue = () => { setQueued(readQueue().length); };
    const onOnline = () => { setOnline(true); flush(); };
    const onOffline = () => setOnline(false);
    const onVis = () => { if (document.visibilityState === "visible") flush(); };

    window.addEventListener(OFFLINE_EVENT, onQueue);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVis);
    timer = setInterval(() => { if (readQueue().length > 0) flush(); }, 20000); // safety net
    flush(); // drain anything left over from a previous session
    return () => {
      window.removeEventListener(OFFLINE_EVENT, onQueue);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVis);
      if (timer) clearInterval(timer);
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
