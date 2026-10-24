"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { useEtDay } from "@/lib/useEtDay";
import { etDayStart } from "@/lib/etDay";
import { addDays } from "@/lib/dates";
import { useRealtimeTable } from "@/lib/realtime";
import { money, moneyPlain } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { orderNo } from "@/lib/activeOrder";
import { CHANNELS, CHANNEL_WORD, byDay, dayHead, lineMatches, lineWords, rangeDays, readLedger, type Channel, type Range } from "@/lib/orderLedger";
import AsyncSection from "./AsyncSection";
import EmptyState from "./EmptyState";
import { InfoRow } from "./kit";
import { Segmented } from "./controls";
import { RecordLink } from "./RecordSheet";

// ORDERS, BY THE DAY THEY WERE BOUGHT (R51 — Ryan, 2026-10-24: "pull orders and attach orders based on the date of
// purchase"). Every channel — the truck's cups, drop pickups, deliveries, office orders, the shop — in one list, under
// the day each was bought (lib/orderLedger: created_at, on the business's clock), newest first, each day with its count
// and its total. Narrowed by the days (today, 7, 30, 90, or two dates), the channel and a search; the file takes what
// is shown — the accountant's handoff, every channel at once. A channel that couldn't be read is said, by name.
const RANGES: { key: Range; label: string }[] = [
  { key: "today", label: "Today" }, { key: "7", label: "7 days" }, { key: "30", label: "30 days" }, { key: "90", label: "90 days" }, { key: "custom", label: "Dates" },
];
// Where an order ends: picked up, void, canceled, refunded, delivered, fulfilled.
const ENDS = new Set(["done", "void", "canceled", "refunded", "delivered", "fulfilled"]);
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

export default function OrderLedger() {
  const today = useEtDay();
  const [range, setRange] = useState<Range>("7");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [channel, setChannel] = useState<"" | Channel>("");
  const [q, setQ] = useState("");
  const span = rangeDays(range, today, custom);
  const loader = useCallback(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    // From the start of the first day to the start of the day after the last, on the business's clock.
    return readLedger(supabase, { fromIso: etDayStart(span.from).toISOString(), toIso: etDayStart(addDays(span.through, 1)).toISOString() });
  }, [span.from, span.through]);
  const board = useAsyncData(loader, [span.from, span.through]);
  const lines = useMemo(() => board.data?.lines ?? [], [board.data]);
  // READ AGAIN FOR WHAT CHANGES THE LIST, NOT FOR EVERY TICKET'S MOVE (R38 — PERF F6's rule, kept): a purchase it doesn't
  // show yet, or one it shows reaching its end (picked up, void, canceled, delivered, refunded). New → making → ready on
  // the Pass all service long reads nothing here; the line says where the order was when the list was read.
  const shownIds = useRef<Set<string>>(new Set());
  useEffect(() => { shownIds.current = new Set(lines.map((l) => l.id)); }, [lines]);
  useRealtimeTable(["orders", "drop_orders", "delivery_orders", "shop_orders"].map((table) => ({ table, when: (row: Record<string, unknown>) => {
    if (!shownIds.current.has(String(row.id ?? ""))) return true;
    return ENDS.has(String(row.status ?? row.fulfillment_status ?? "")) || !!row.canceled_at || row.picked_up === true;
  } })), board.reload);
  const shown = lines.filter((l) => (!channel || l.channel === channel) && lineMatches(l, q, moneyPlain));
  const days = byDay(shown);
  const total = shown.filter((l) => !l.canceled).reduce((s, l) => s + l.totalCents, 0);

  return (
    <div className="adm-sec">
      <div className="flex flex-col gap-2 mb-2">
        <Segmented label="Bought" kind="choice" size="sm" value={range} onChange={setRange} options={RANGES} />
        {range === "custom" && (
          <div className="prod-grid stack-sm mt-0">
            <label className="prod-f mt-0"><span>From</span><input type="date" value={custom.from} max={today} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></label>
            <label className="prod-f mt-0"><span>Through</span><input type="date" value={custom.to} max={today} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></label>
          </div>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          <input type="search" className="basis-full min-w-0" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search orders" aria-label="Search the orders" enterKeyHint="search" autoComplete="off" />
          <select className="grow basis-[150px] min-w-0" aria-label="Which channel" value={channel} onChange={(e) => setChannel(e.target.value as "" | Channel)}>
            <option value="">Every channel</option>
            {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_WORD[c]}</option>)}
          </select>
          <button type="button" className="btn-sec btn-sm shrink-0" disabled={!shown.length} onClick={() => void downloadCsv(`gt3-orders-${span.from}-to-${span.through}.csv`, shown.map((l) => ({
            bought: l.day, time: timeOf(l.at), channel: CHANNEL_WORD[l.channel], order: orderNo(l.id), customer: l.who,
            total: moneyPlain(l.totalCents), paid: l.paid, status: l.state,
          })))}>Export CSV</button>
        </div>
      </div>
      <AsyncSection state={board} isEmpty={() => false} emptyTitle="No orders in these days" loadingLabel="Loading orders…" errorTitle="Couldn't load the orders" errorSub="This is not an empty day — we could not read the orders just now.">
        {() => (
          <>
            <p className="m-0 mb-2 text-caption text-cream-muted" role="status">
              {shown.length} order{shown.length === 1 ? "" : "s"} · {money(total)}{span.from === span.through ? "" : ` · ${dayHead(span.from, today)} – ${dayHead(span.through, today)}`}
            </p>
            {board.data && board.data.failed.length > 0 && (
              <p className="cp-line mt-0 mb-2" role="alert">Couldn&apos;t read {board.data.failed.map((c) => CHANNEL_WORD[c].toLowerCase()).join(", ")} orders — they aren&apos;t in this list.</p>
            )}
            {days.map((d) => (
              <section key={d.day} aria-label={dayHead(d.day, today)} className="mb-3">
                <div className="flex items-baseline justify-between gap-2 pt-1 pb-1.5">
                  <h3 className="m-0 font-sans text-footnote font-bold text-cream">{dayHead(d.day, today)}</h3>
                  <span className="text-caption text-cream-muted tabular-nums">{d.count} · {money(d.totalCents)}</span>
                </div>
                <div className="k-rows">
                  {d.lines.map((l) => (
                    <InfoRow key={`${l.channel}-${l.id}`}
                      name={l.customerId ? <RecordLink kind="customer" id={l.customerId}>{l.who}</RecordLink> : l.who}
                      nameExtra={<span className={`adm-substat ${l.canceled ? "past_due" : "active"}`}>{CHANNEL_WORD[l.channel]}</span>}
                      meta={`${orderNo(l.id)} · ${timeOf(l.at)} · ${lineWords(l)}`}
                      trailing={<span className={`tabular-nums font-semibold ${l.canceled ? "line-through text-cream-muted" : "text-cream"}`}>{money(l.totalCents)}</span>} />
                  ))}
                </div>
              </section>
            ))}
            {lines.length === 0 && <EmptyState title="No orders in these days" sub="Pick a longer window, or other dates." />}
            {lines.length > 0 && shown.length === 0 && <EmptyState title="No matches" sub="Clear the search or pick every channel." />}
          </>
        )}
      </AsyncSection>
    </div>
  );
}
