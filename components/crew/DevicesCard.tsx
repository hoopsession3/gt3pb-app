"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { isMissingFunction } from "@/lib/schemaSkew";
import { DEVICES_POLL_MS, deviceView, type DeviceRow } from "@/lib/heartbeat";
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

export function DevicesCard() {
  const { status, data, reload } = useAsyncData(readDevices, []);
  // This phone's clock, ticked while the card is up: how long since the last answer, added to its seen_s.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const seen = () => document.visibilityState === "visible";
    const tick = window.setInterval(() => { if (seen()) setNow(Date.now()); }, 5_000);
    const ask = window.setInterval(() => { if (seen()) void reload(); }, DEVICES_POLL_MS);
    const back = () => { if (seen()) { setNow(Date.now()); void reload(); } };
    document.addEventListener("visibilitychange", back);
    return () => { window.clearInterval(tick); window.clearInterval(ask); document.removeEventListener("visibilitychange", back); };
  }, [reload]);

  if (status === "error") {
    return (
      <section aria-label="Devices on the Pass">
        <SectionHeader label="Devices" annotation="seen in the last 10 min" />
        <InfoRow name="Couldn't check the devices" sub="Asking again every half minute." />
      </section>
    );
  }
  if (!data || data.missing || data.rows.length === 0) return null;
  const since = Math.max(0, (now - data.at) / 1000);
  return (
    <section aria-label="Devices on the Pass">
      <SectionHeader label="Devices" annotation="seen in the last 10 min" />
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
