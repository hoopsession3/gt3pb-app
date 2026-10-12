"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData, type AsyncStatus } from "@/lib/useAsyncData";
import { isMissingFunction } from "@/lib/schemaSkew";
import { DEVICES_POLL_MS, deviceView, passPhones, type DeviceRow, type PassPhones } from "@/lib/heartbeat";
import { InfoRow, SectionHeader } from "@/components/kit";

// WHO IS ON THE PASS, AND CAN THEY HEAR AN ORDER (2026-10-11, the KDS program — devices). Live Ops, for the managers,
// under the truck: each phone or iPad heard from in the last ten minutes (0375 crew_devices), one row each — who is
// signed in on it, the Pass's orders feed in a word, whether it can be pushed an order, and when it last checked in;
// under that its app and build, and whether its screen is kept on. A device that has gone quiet for two beats reads
// "Away", whatever it last said. The feed's word is in the tag, and its tone only repeats it.
//
// Asked every thirty seconds while the screen can be seen, and at once when it comes back — not on realtime (0375 says
// why). "Seen 12 s ago" counts from the database's clock (seen_s) and moves on between asks by this phone's own clock,
// so a phone whose clock is off still reads true. Nothing at all when no device has been seen, and nothing before
// 0375 is pasted (its function not there yet: lib/schemaSkew). A read that fails before any has worked says so.
//
// THE CARD IS WORDS ON THE PASS'S ROW NOW (2026-10-12, the Live Ops round, approved). It stood under the truck as a card
// of its own; Live Ops says "2 phones can ring" or "1 reconnecting" on the Pass's row instead (components/crew/
// LiveOpsRows, lib/liveOps passSays) and these rows are one tap away, in the row's sheet. The read is useDevices, below,
// which the row, this list and Go live's checks (components/crew/GoLiveSheet) each ask: lib/heartbeat stays in this file
// and out of every other screen's code. A read that fails after one has worked is said too — the rows above it are the
// last answer, not this one.

type Read = { rows: DeviceRow[]; at: number; missing: boolean };

async function readDevices(): Promise<Read> {
  if (!supabase) return { rows: [], at: Date.now(), missing: false };
  const { data, error } = await supabase.rpc("crew_devices");
  if (error) {
    if (isMissingFunction(error)) return { rows: [], at: Date.now(), missing: true };
    throw new Error(error.message);
  }
  return { rows: Array.isArray(data) ? (data as DeviceRow[]) : [], at: Date.now(), missing: false };
}
const readNothing = async (): Promise<Read> => ({ rows: [], at: Date.now(), missing: true });

export type Devices = {
  status: AsyncStatus;
  /** The last read did not answer — the first or a later one. */
  failed: boolean;
  /** Seconds since the last answer, by this phone's clock: added to each row's seen_s. */
  since: number;
  data: Read | null;
  /** The Pass's phones, counted (lib/heartbeat passPhones); null until there is an answer, or before 0375. */
  phones: PassPhones | null;
};

/** crew_devices, asked every half minute while the screen is seen and again on coming back. `enabled` false asks
 *  nothing: crew_devices answers the managers (event_manager, admin, owner) and refuses everyone else. */
export function useDevices(enabled: boolean = true): Devices {
  const { status, data, error, reload } = useAsyncData(enabled ? readDevices : readNothing, [enabled]);
  // This phone's clock, ticked while the card is up: how long since the last answer, added to its seen_s.
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const seen = () => document.visibilityState === "visible";
    const tick = window.setInterval(() => { if (seen()) setNow(Date.now()); }, 5_000);
    const ask = window.setInterval(() => { if (seen()) void reload(); }, DEVICES_POLL_MS);
    const back = () => { if (seen()) { setNow(Date.now()); void reload(); } };
    document.addEventListener("visibilitychange", back);
    return () => { window.clearInterval(tick); window.clearInterval(ask); document.removeEventListener("visibilitychange", back); };
  }, [reload, enabled]);
  const since = data ? Math.max(0, (now - data.at) / 1000) : 0;
  return { status, failed: error !== null, since, data, phones: data && !data.missing ? passPhones(data.rows, since) : null };
}

export function DevicesCard() {
  const { status, data, since, failed } = useDevices();

  if (status === "error") {
    return (
      <section aria-label="Devices on the Pass">
        <SectionHeader label="Devices" annotation="seen in the last 10 min" />
        <InfoRow name="Couldn't check the devices" sub="Asking again every half minute." />
      </section>
    );
  }
  if (!data || data.missing || data.rows.length === 0) return null;
  return (
    <section aria-label="Devices on the Pass">
      <SectionHeader label="Devices" annotation="seen in the last 10 min" />
      {failed && <p className="load-failed" role="status">Couldn&rsquo;t check again just now — these are from the last answer.</p>}
      <div className="k-rows">
        {data.rows.map((r) => {
          const v = deviceView(r, r.seen_s + since);
          return (
            <InfoRow key={v.key} name={v.who}
              nameExtra={<span className={`k-tag${v.tone === "ok" ? " ok" : v.tone === "warn" ? " warn" : v.tone === "crit" ? " crit" : ""}`}>{v.feed}</span>}
              sub={v.line} meta={v.meta} />
          );
        })}
      </div>
    </section>
  );
}
