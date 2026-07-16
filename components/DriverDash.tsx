"use client";

import { useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { etToday } from "@/lib/dates";
import { SectionHeader } from "@/components/kit";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Icon from "@/components/Icon";

// The driver's tab — the next run at a glance, one action: open driver mode (map + run list).
// Run OPS (statuses, outcomes, pack-out) stay in Live Ops; this is the wheel view. Fetch state via
// useAsyncData — a failed load is a real error now, not a silent "No delivery run scheduled".
type Row = { id: string; delivery_date: string; status: string | null; address_zip: string | null };

export default function DriverDash({ isLead }: { isLead: boolean }) {
  const loader = useCallback(async (): Promise<Row[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("delivery_orders")
      .select("id, delivery_date, status, address_zip")
      .gte("delivery_date", etToday()).is("canceled_at", null)
      .order("delivery_date", { ascending: true }).limit(200);
    if (error) throw new Error(error.message);
    return (data as Row[]) ?? [];
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  useRealtimeTable("delivery_orders", reload);

  return (
    <div className="adm-sec">
      <SectionHeader label="Your run" />
      <AsyncSection state={board} isEmpty={(data) => data.length === 0} emptyTitle="No delivery run scheduled" emptySub="Runs appear here as Sunday orders land." errorTitle="Couldn't load your run">
        {(rows) => {
          const nextDate = rows[0]?.delivery_date ?? null;
          const run = rows.filter((r) => r.delivery_date === nextDate);
          const zips = [...new Set(run.map((r) => r.address_zip).filter(Boolean))].slice(0, 4).join(" · ");
          const runDay = nextDate === etToday();
          return (
            <div className={`drv-card${runDay ? " today" : ""}`}>
              <div className="drv-top">
                <b>{runDay ? "Today" : new Date(`${nextDate}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</b>
                <span>{run.length} porch{run.length === 1 ? "" : "es"}{zips ? ` · ${zips}` : ""}</span>
              </div>
              <Link href="/driver" className="drv-go"><Icon name="compass" /> Open driver mode — map &amp; run list</Link>
            </div>
          );
        }}
      </AsyncSection>
      {isLead && <div className="h-sub" style={{ marginTop: 10 }}>Run ops — statuses, outcomes &amp; pack-out — live in Live Ops › Delivery.</div>}
    </div>
  );
}
