"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { etToday } from "@/lib/dates";

// The driver's tab — the next run at a glance, one action: open driver mode (map + run list).
// Run OPS (statuses, outcomes, pack-out) stay in Now › Sunday delivery; this is the wheel view.
type Row = { id: string; delivery_date: string; status: string | null; address_zip: string | null };

export default function DriverDash({ isLead }: { isLead: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) { setLoaded(true); return; }
    const { data } = await supabase.from("delivery_orders")
      .select("id, delivery_date, status, address_zip")
      .gte("delivery_date", etToday()).is("canceled_at", null)
      .order("delivery_date", { ascending: true }).limit(200);
    setRows((data as Row[]) ?? []); setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable("delivery_orders", load);

  const nextDate = rows[0]?.delivery_date ?? null;
  const run = rows.filter((r) => r.delivery_date === nextDate);
  const zips = [...new Set(run.map((r) => r.address_zip).filter(Boolean))].slice(0, 4).join(" · ");
  const runDay = nextDate === etToday();

  return (
    <div className="adm-sec">
      <div className="sec">Your run</div>
      {!loaded ? null : !nextDate ? (
        <div className="h-sub">No delivery run scheduled — runs appear here as Sunday orders land.</div>
      ) : (
        <div className={`drv-card${runDay ? " today" : ""}`}>
          <div className="drv-top">
            <b>{runDay ? "Today" : new Date(`${nextDate}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</b>
            <span>{run.length} porch{run.length === 1 ? "" : "es"}{zips ? ` · ${zips}` : ""}</span>
          </div>
          <Link href="/driver" className="drv-go">🧭 Open driver mode — map &amp; run list</Link>
        </div>
      )}
      {isLead && <div className="h-sub" style={{ marginTop: 10 }}>Run ops — statuses, outcomes &amp; pack-out — live in Now › Sunday delivery.</div>}
    </div>
  );
}
