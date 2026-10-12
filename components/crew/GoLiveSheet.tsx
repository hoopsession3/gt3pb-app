"use client";

import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useMinute } from "@/lib/useMinute";
import { preflight, stopName, type StopLite } from "@/lib/liveOps";
import { useDevices } from "@/components/crew/DevicesCard";
import Sheet, { CloseButton } from "@/components/Sheet";
import Button from "@/components/Button";

// GO LIVE, CHECKED FIRST (2026-10-12, the Live Ops round — the owner approved the pre-flight). Going live is the one
// thing on Live Ops a guest sees, and the moment the truck's Pass has to be able to hear an order. Go live asked
// nothing when the stop was due and "Go live at X now?" when it was not; it opens this sheet now, for every stop on the
// road and from the Route list's "Go live at this location" too (components/crew/LiveControl). It says, each with a yes
// or a no in words (lib/liveOps preflight): the stop is due now, and its window; a phone is on the Pass (lib/heartbeat,
// read as the Devices card reads it); that phone's order alerts are on; the stop's map pin is set. Then what going live
// does — "Go live and tell 12 people", the people who asked on Find Us to hear when the truck is live, counted by the
// database (live_ping_count, 0385) and never listed. The checks inform; they never block: with one that is not a yes the
// button says "Go live anyway". The go-live haptic plays once, on the confirm (LiveControl's goLive: haptic("live")).
// Owners and admins only reach it: LiveControl draws Go live for them alone (lib/liveOps mayGoLive), and the count
// answers no one else.

async function readHeard(): Promise<number> {
  if (!supabase) throw new Error("No database here");
  const { data, error } = await supabase.rpc("live_ping_count");
  if (error) throw new Error(error.message);   // before 0385 is pasted too (PGRST202): "couldn't count", never 0
  const n = Number(data);
  if (!Number.isFinite(n)) throw new Error("The count did not answer");
  return n;
}

export default function GoLiveSheet({ stop, onClose, onGo }: { stop: StopLite; onClose: () => void; onGo: () => void }) {
  const now = useMinute();
  const devices = useDevices(true);
  const heard = useAsyncData(readHeard, []);
  const pf = preflight({
    stop, nowMs: now,
    phones: devices.failed || devices.data?.missing ? "failed" : devices.phones,
    heard: heard.error ? "failed" : heard.status === "ready" ? heard.data : null,
  });
  const name = stopName(stop);
  return (
    <Sheet open onClose={onClose} label={`Go live at ${name}`}
      header={<div className="flex items-center"><b className="text-subhead font-semibold">Go live at {name}?</b><CloseButton onClick={onClose} /></div>}>
      <ul className="m-0 p-0 list-none" aria-label="Before going live">
        {pf.checks.map((c) => (
          <li key={c.key} className="flex items-start gap-3 py-2.5 border-b border-line last:border-b-0">
            <span className={`k-tag txt shrink-0 mt-0.5${c.ok === true ? " ok" : c.ok === false ? " warn" : ""}`}>{c.word}</span>
            <span className="flex-1 min-w-0">
              <b className="block text-subhead font-semibold text-cream">{c.title}</b>
              {c.says && <span className="block text-footnote text-cream-muted">{c.says}</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 mb-4 text-footnote text-cream-muted" role="status">{pf.tells}</p>
      <div className="flex flex-col items-center gap-3">
        <Button kind="primary" wide onClick={() => { onClose(); onGo(); }}>{pf.confirm}</Button>
        <Button kind="quiet" onClick={onClose}>Not now</Button>
      </div>
    </Sheet>
  );
}
