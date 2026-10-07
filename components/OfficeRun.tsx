"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { useApp } from "./AppProvider";
import { openAddress } from "@/lib/maps";
import { haptic } from "@/lib/haptics";
import { etToday } from "@/lib/dates";
import { useAsyncData } from "@/lib/useAsyncData";
import { mondayLabel, windowHours } from "@/lib/office";
import { isMissingFunction } from "@/lib/schemaSkew";
import Icon from "@/components/Icon";
import RunBar from "@/components/RunBar";

// OFFICE RUN — the office route on the driver's own phone (2026-10-07, the report's defect 11). The
// driver's screen read home deliveries only, so Monday morning's offices lived in a crew panel on
// someone else's phone, with "5–8 AM" hard-coded over Atlanta's 6–9. This is the next office delivery
// day's stops — the earliest window first, then ZIP and street — each with its door notes, its own
// window, the gallons to bring and the empties to collect, Navigate and Call, and one tap to log it.
//
// One write per tap: office_log_delivery (0357) records the outcome, the jugs, the ledger row and the
// account's balance together, the order locked, so the driver and the crew cannot count one swap
// twice — the crew's panel made three writes from the browser. A mis-tap reopens the stop and voids
// its jug entry (office_reopen_delivery). Same classes as the porch run below it: one driver screen,
// one look. Renders nothing when no office delivery is ahead. Before the day it is one line — the
// date, the stops and the gallons to load — so Tuesday's porch run isn't pushed under next Monday's
// offices, and nothing can be logged early (the database refuses that too).
type Stop = {
  id: string; company: string; contact_name: string | null; contact_phone: string | null;
  address_street: string; address_city: string; address_zip: string; access_instructions: string | null;
  delivery_date: string; delivery_window: string | null; gallons: number;
  status: string; driver_outcome: string | null; jugs_out: number; jugs_in: number | null; driver_note: string | null;
};
type Board = { rows: Stop[]; date: string | null };

const startOf = (w: string | null) => (/_(\d{4})_/.exec(w ?? "") ?? [])[1] ?? "0500";

export default function OfficeRun() {
  const { toast } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const [empties, setEmpties] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { rows: [], date: null };
    const { data, error } = await supabase.from("business_orders")
      .select("id, company, contact_name, contact_phone, address_street, address_city, address_zip, access_instructions, delivery_date, delivery_window, gallons, status, driver_outcome, jugs_out, jugs_in, driver_note")
      .gte("delivery_date", etToday()).is("canceled_at", null).order("delivery_date").limit(100);
    if (error) throw new Error(error.message);
    const all = (data ?? []) as Stop[];
    const date = all[0]?.delivery_date ?? null;
    const rows = all.filter((o) => o.delivery_date === date).sort((a, b) =>
      startOf(a.delivery_window).localeCompare(startOf(b.delivery_window)) || a.address_zip.localeCompare(b.address_zip) || a.address_street.localeCompare(b.address_street));
    return { rows, date };
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  useRealtimeTable("business_orders", reload);

  const rows = board.data?.rows ?? [];
  const date = board.data?.date ?? null;
  if (board.status === "error") return <div className="driver-empty">Couldn&rsquo;t load the office route — pull down to try again.</div>;
  if (!date || rows.length === 0) return null;

  const jugsOf = (o: Stop) => Math.round(o.gallons);
  if (date > etToday()) {
    const load = rows.reduce((n, o) => n + jugsOf(o), 0);
    return (
      <div className="driver">
        <div className="driver-head">
          <div><div className="driver-kick"><Icon name="jar" /> Next office route</div><b>{mondayLabel(date)}</b></div>
          <div className="driver-prog"><b>{rows.length}</b> {rows.length === 1 ? "stop" : "stops"} · {load} gal</div>
        </div>
      </div>
    );
  }

  const doneOf = (o: Stop) => o.status === "delivered" || o.status === "issue";
  const firstOpen = rows.findIndex((o) => !doneOf(o));
  const doneCount = rows.filter(doneOf).length;

  const log = async (o: Stop, outcome: "delivered_swapped" | "delivered_no_swap" | "not_available") => {
    if (!supabase || busyId) return; setBusyId(o.id);
    if (outcome === "not_available") haptic("warning"); else haptic("success");
    const { error } = await supabase.rpc("office_log_delivery", {
      p_order: o.id, p_outcome: outcome, p_jugs_in: outcome === "delivered_swapped" ? Math.max(0, empties[o.id] ?? jugsOf(o)) : null,
    });
    setBusyId(null);
    if (error) {
      toast(isMissingFunction(error) ? "Log this one on the crew's office route — the driver's log needs today's database update" : error.message, "error");
      reload(); return;
    }
    setOpenId(null);
    toast(outcome === "not_available" ? `${o.company} — not delivered; the crew is told` : `${o.company} — delivered`);
    reload();
  };
  const reopen = async (o: Stop) => {
    if (!supabase || busyId) return; setBusyId(o.id); haptic("light");
    const { error } = await supabase.rpc("office_reopen_delivery", { p_order: o.id, p_reason: "Mis-tap on the driver's run" });
    setBusyId(null);
    if (error) toast(isMissingFunction(error) ? "Undo it on the crew's office route for now" : error.message, "error");
    reload();
  };

  const remaining = rows.length - doneCount;
  return (
    <div className="driver">
      <div className="driver-head">
        <div><div className="driver-kick"><Icon name="jar" /> Office route</div><b>{mondayLabel(date)}</b></div>
        <div className="driver-prog"><b>{doneCount}</b>/{rows.length}</div>
      </div>
      <RunBar done={doneCount} of={rows.length} />
      <div className="driver-list">
        {rows.map((o, i) => {
          const done = doneOf(o);
          const addr = `${o.address_street}, ${o.address_city} ${o.address_zip}`;
          const open = openId === o.id;
          const n = jugsOf(o);
          return (
            <div className={`driver-stop${done ? " done" : ""}${o.status === "issue" ? " issue" : ""}${i === firstOpen ? " next" : ""}`} key={o.id}>
              <div className="driver-stop-top">
                <span className="driver-seq">{done ? (o.status === "issue" ? "!" : <Icon name="check" />) : i + 1}</span>
                <div className="driver-who">
                  <b>{o.company}</b>
                  <span>{n} gal · {windowHours(o.delivery_window)}{o.contact_name ? ` · ${o.contact_name}` : ""}</span>
                </div>
              </div>
              <div className="driver-addr">{addr}{o.access_instructions ? <> · <em>{o.access_instructions}</em></> : null}</div>
              {!done && (
                <>
                  <div className="driver-acts">
                    <button type="button" className="driver-nav" onClick={() => { haptic("light"); openAddress(addr); }}><Icon name="compass" /> Navigate</button>
                    {o.contact_phone && <a className="driver-call" href={`tel:${o.contact_phone.replace(/[^\d+]/g, "")}`}>Call</a>}
                    <button type="button" className="driver-log" onClick={() => { haptic("light"); setOpenId(open ? null : o.id); setEmpties((e) => ({ ...e, [o.id]: e[o.id] ?? n })); }}>{open ? "Close" : <>Log <Icon name="check" /></>}</button>
                  </div>
                  {open && (
                    <div className="driver-outcome">
                      <div className="driver-emp">
                        <span>Empties collected <em>(bringing {n} full)</em></span>
                        <div className="driver-emp-step">
                          <button type="button" onClick={() => { if ((empties[o.id] ?? n) > 0) haptic("decrease"); else haptic("boundary"); setEmpties((e) => ({ ...e, [o.id]: Math.max(0, (e[o.id] ?? n) - 1) })); }} aria-label="Fewer">−</button>
                          <b>{empties[o.id] ?? n}</b>
                          <button type="button" onClick={() => { haptic("increase"); setEmpties((e) => ({ ...e, [o.id]: (e[o.id] ?? n) + 1 })); }} aria-label="More">+</button>
                        </div>
                      </div>
                      <button type="button" className="driver-out-ok" onClick={() => log(o, "delivered_swapped")} disabled={busyId === o.id}><Icon name="check" /> Delivered &amp; swapped</button>
                      <button type="button" className="driver-out-mid" onClick={() => log(o, "delivered_no_swap")} disabled={busyId === o.id}>Delivered — no empties back</button>
                      <button type="button" className="driver-out-nothome" onClick={() => log(o, "not_available")} disabled={busyId === o.id}>Couldn&rsquo;t deliver</button>
                    </div>
                  )}
                </>
              )}
              {done && (
                <div className="driver-donerow">
                  <span className="driver-doneline">{o.status === "issue" ? (o.driver_note || "Not delivered — the crew is told") : o.driver_outcome === "delivered_swapped" ? `Delivered · ${o.jugs_in ?? 0}/${o.jugs_out} empties back` : "Delivered"}</span>
                  <button type="button" className="driver-undo" onClick={() => reopen(o)} disabled={busyId === o.id}>↩ Undo</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {remaining === 0 && <div className="driver-wrap">Office route done — all {rows.length} delivered or logged.</div>}
    </div>
  );
}
