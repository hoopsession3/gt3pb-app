"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { raiseAlertClient } from "@/lib/clientAlerts";
import { authedFetch } from "@/lib/authedFetch";
import { useApp } from "./AppProvider";
import RouteMap, { type RoutePoint } from "./RouteMap";
import { openAddress, fullRouteUrl, geocode } from "@/lib/maps";
import { haptic, HAPTIC } from "@/lib/haptics";
import { type PerfMix } from "@/lib/delivery";
import { etToday } from "@/lib/dates";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";

// DRIVER RUN — the Sunday porch run, built for one hand at the wheel. Stops ordered by ZIP → street
// (a compact-zone route), pinned on the map, each a big card with Navigate / Call / one-tap outcome.
// No window.prompt anywhere — empties log on an inline stepper. Reuses the delivery_orders outcomes
// (swap / fresh / hold) so it stays in lock-step with DeliveryOps and the customer texts. Realtime.
// Fetch state via useAsyncData — a failed load is a real error now, not a silent "No delivery run
// scheduled" that looks identical to a genuinely empty Sunday.

type DOrder = {
  id: string; name: string; phone: string | null;
  address_street: string; address_city: string; address_zip: string; access_instructions: string | null;
  pack_size: number; rise_count: number; flow_count: number; dusk_count: number;
  performance_count: number; performance_mix: PerfMix; refill_count: number; new_count: number;
  total_cents: number; payment_status: string; status: string;
  driver_outcome: string | null; empties_expected: number; empties_collected: number | null; driver_note: string | null;
  delivery_date: string; canceled_at: string | null;
};
type Board = { rows: DOrder[]; date: string | null };

const prettySlug = (s: string) => s.replace(/[-_|]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const packSummary = (o: DOrder) => [
  o.rise_count && `${o.rise_count}× RISE`, o.flow_count && `${o.flow_count}× FLOW`, o.dusk_count && `${o.dusk_count}× DUSK`,
  o.performance_count && (Object.entries(o.performance_mix || {}).map(([k, n]) => `${n}× ${prettySlug(k)}`).join(" · ") || `${o.performance_count}× premium`),
].filter(Boolean).join(" · ");

export default function DriverRun() {
  const { toast } = useApp();
  const [coords, setCoords] = useState<Record<string, { lat: number; lng: number } | null>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [empties, setEmpties] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null); // stop being logged — blocks double-tap → double SMS/update
  const geoOnce = useRef<Set<string>>(new Set());

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { rows: [], date: null };
    const today = etToday(); // delivery_date is an ET business-day key (lib/delivery.ts)
    const { data, error } = await supabase.from("delivery_orders").select("*")
      .gte("delivery_date", today).is("canceled_at", null).order("delivery_date").limit(200);
    if (error) throw new Error(error.message);
    const all = (data ?? []) as DOrder[];
    const d = all[0]?.delivery_date ?? null;
    // ZIP → street ordering = a tight, no-backtrack run across the compact Sunday zone.
    const run = all.filter((o) => o.delivery_date === d)
      .sort((a, b) => a.address_zip.localeCompare(b.address_zip) || a.address_street.localeCompare(b.address_street));
    return { rows: run, date: d };
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  useRealtimeTable("delivery_orders", reload);

  const rows = board.data?.rows ?? [];

  // Geocode each address once, sequentially (Nominatim asks ≤1/sec); results cache in localStorage so
  // every run after the first is instant. The map fills in progressively as pins resolve.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const o of rows) {
        if (cancelled) return;
        if (geoOnce.current.has(o.id)) continue;
        geoOnce.current.add(o.id);
        const c = await geocode(`${o.address_street}, ${o.address_city}, ${o.address_zip}`);
        if (cancelled) return;
        setCoords((prev) => ({ ...prev, [o.id]: c }));
        await new Promise((r) => setTimeout(r, 1100));
      }
    })();
    return () => { cancelled = true; };
  }, [rows]);

  const doneOf = (o: DOrder) => o.status === "delivered" || o.status === "held_for_pickup" || o.status === "issue";
  const firstOpenIdx = rows.findIndex((o) => !doneOf(o));
  const doneCount = rows.filter(doneOf).length;

  const points: RoutePoint[] = useMemo(() => rows.map((o, i) => {
    const c = coords[o.id];
    return c ? { name: o.name.split(" ")[0], lat: c.lat, lng: c.lng, live: i === firstOpenIdx } : null;
  }).filter(Boolean) as RoutePoint[], [rows, coords, firstOpenIdx]);

  const routeHref = useMemo(() => fullRouteUrl(
    rows.filter((o) => !doneOf(o)).map((o) => ({ lat: coords[o.id]?.lat ?? null, lng: coords[o.id]?.lng ?? null, address: `${o.address_street}, ${o.address_city} ${o.address_zip}` }))
  ), [rows, coords]);

  const notifyDelivered = (o: DOrder) => { void (async () => {
    try {
      await authedFetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "delivered", id: o.id }) });
    } catch { /* best-effort */ }
  })(); };

  const swapDone = async (o: DOrder) => {
    if (!supabase || busyId) return; setBusyId(o.id); haptic(HAPTIC.success); notifyDelivered(o);
    const { error } = await supabase.from("delivery_orders").update({ driver_outcome: "swap_completed", status: "delivered", empties_collected: Math.max(0, empties[o.id] ?? o.empties_expected) }).eq("id", o.id);
    if (error) toast("Didn't save — check the stop", "error");
    setBusyId(null); setOpenId(null); reload();
  };
  const deliveredFresh = async (o: DOrder) => {
    if (!supabase || busyId) return; setBusyId(o.id); haptic(HAPTIC.success); notifyDelivered(o);
    const { error } = await supabase.from("delivery_orders").update({ driver_outcome: o.refill_count > 0 ? "delivered_fresh_no_empties" : null, status: "delivered", empties_collected: 0 }).eq("id", o.id);
    setBusyId(null); setOpenId(null); toast(error ? "Didn't save — check the stop" : "Delivered — logged", error ? "error" : undefined); reload();
  };
  const hold = async (o: DOrder) => {
    if (!supabase || busyId) return; setBusyId(o.id); haptic(HAPTIC.alert);
    await supabase.from("delivery_orders").update({ driver_outcome: "held_no_empties", status: "held_for_pickup", empties_collected: 0 }).eq("id", o.id);
    await raiseAlertClient({ severity: "important", category: "order", kind: "delivery_held", subjectId: o.id, title: "Delivery held — pickup queue", body: `${o.name} — no empties out. ${o.pack_size} bottles held at GT3PB for pickup 10 AM – 2 PM. ${o.phone ?? ""}`.trim(), link: "/crew?s=now" });
    setBusyId(null); setOpenId(null); toast("Held for pickup — crew alerted"); reload();
  };
  const notHome = async (o: DOrder) => {
    if (!supabase || busyId) return; setBusyId(o.id); haptic(HAPTIC.alert);
    const at = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    await supabase.from("delivery_orders").update({ status: "issue", driver_outcome: null, empties_collected: 0, driver_note: `Not home — ${at}` }).eq("id", o.id);
    await raiseAlertClient({ severity: "important", category: "order", kind: "delivery_not_home", subjectId: o.id, title: "Delivery — customer not home", body: `${o.name} wasn't home for the ${o.pack_size}-bottle drop${o.refill_count > 0 ? " (swap not completed)" : ""}. ${o.address_street}, ${o.address_city}. ${o.phone ?? ""}`.trim(), link: "/crew?s=now" });
    setBusyId(null); setOpenId(null); toast("Logged — not home; crew alerted"); reload();
  };
  // Roll a stop back to open — undo a mis-tap. Ties to the order: clears the outcome + reopens it.
  const rollback = async (o: DOrder) => {
    if (!supabase) return; haptic(HAPTIC.tap);
    await supabase.from("delivery_orders").update({ status: "out_for_delivery", driver_outcome: null, empties_collected: null, driver_note: null }).eq("id", o.id);
    reload();
  };

  return (
    <AsyncSection
      state={board}
      isEmpty={(data) => data.date === null}
      emptyTitle="No delivery run scheduled"
      emptySub="When Sunday orders land, your route shows up here."
      errorTitle="Couldn't load the run"
    >
      {(data) => {
        const { date } = data;
        if (rows.length === 0) {
          return <div className="driver-empty">No stops on {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })} yet.</div>;
        }
        const dLabel = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
        const remaining = rows.length - doneCount;
        return (
          <div className="driver">
            <div className="driver-head">
              <div><div className="driver-kick">🚚 Sunday porch run</div><b>{dLabel}</b></div>
              <div className="driver-prog"><b>{doneCount}</b>/{rows.length}</div>
            </div>
            <div className="driver-bar"><span style={{ width: `${rows.length ? (doneCount / rows.length) * 100 : 0}%` }} /></div>

            {points.length > 0 && <RouteMap points={points} />}
            {remaining > 0 && routeHref && (
              <a className="driver-route-cta" href={routeHref} target="_blank" rel="noopener noreferrer">🗺️ Navigate the whole run ({remaining} stop{remaining === 1 ? "" : "s"}) →</a>
            )}
            {points.length < rows.length && <div className="driver-geohint">Pinning stops on the map…</div>}

            <div className="driver-list">
              {rows.map((o, i) => {
                const done = doneOf(o);
                const addr = `${o.address_street}, ${o.address_city} ${o.address_zip}`;
                const open = openId === o.id;
                return (
                  <div className={`driver-stop${done ? " done" : ""}${o.status === "issue" ? " issue" : ""}${i === firstOpenIdx ? " next" : ""}`} key={o.id}>
                    <div className="driver-stop-top">
                      <span className="driver-seq">{done ? (o.status === "issue" ? "!" : "✓") : i + 1}</span>
                      <div className="driver-who">
                        <b>{o.name}{o.refill_count > 0 && <span className="driver-swap">SWAP ×{o.refill_count}</span>}{o.status === "held_for_pickup" && <span className="driver-held">HELD</span>}</b>
                        <span>{o.pack_size} bottles · {packSummary(o)}</span>
                      </div>
                    </div>
                    <div className="driver-addr">{addr}{o.access_instructions ? <> · <em>{o.access_instructions}</em></> : null}</div>
                    {!done && (
                      <>
                        <div className="driver-acts">
                          <button type="button" className="driver-nav" onClick={() => { haptic(HAPTIC.tap); openAddress(addr); }}>🧭 Navigate</button>
                          {o.phone && <a className="driver-call" href={`tel:${o.phone.replace(/[^\d+]/g, "")}`}>📞 Call</a>}
                          <button type="button" className="driver-log" onClick={() => { haptic(HAPTIC.tap); setOpenId(open ? null : o.id); setEmpties((e) => ({ ...e, [o.id]: e[o.id] ?? o.empties_expected })); }}>{open ? "Close" : "Log ✓"}</button>
                        </div>
                        {open && (
                          <div className="driver-outcome">
                            {o.refill_count > 0 ? (
                              <>
                                <div className="driver-emp">
                                  <span>Empties picked up <em>(expected {o.empties_expected})</em></span>
                                  <div className="driver-emp-step">
                                    <button type="button" onClick={() => { haptic(HAPTIC.tap); setEmpties((e) => ({ ...e, [o.id]: Math.max(0, (e[o.id] ?? o.empties_expected) - 1) })); }} aria-label="Fewer">−</button>
                                    <b>{empties[o.id] ?? o.empties_expected}</b>
                                    <button type="button" onClick={() => { haptic(HAPTIC.tap); setEmpties((e) => ({ ...e, [o.id]: (e[o.id] ?? o.empties_expected) + 1 })); }} aria-label="More">+</button>
                                  </div>
                                </div>
                                <button type="button" className="driver-out-ok" onClick={() => swapDone(o)} disabled={busyId === o.id}>✓ Swapped &amp; delivered</button>
                                <button type="button" className="driver-out-mid" onClick={() => deliveredFresh(o)} disabled={busyId === o.id}>Delivered fresh — no empties out</button>
                                <button type="button" className="driver-out-nothome" onClick={() => notHome(o)} disabled={busyId === o.id}>🚪 Not home</button>
                                <button type="button" className="driver-out-hold" onClick={() => hold(o)} disabled={busyId === o.id}>⚠ No empties out — hold for pickup</button>
                              </>
                            ) : (
                              <>
                                <button type="button" className="driver-out-ok" onClick={() => deliveredFresh(o)} disabled={busyId === o.id}>✓ Delivered</button>
                                <button type="button" className="driver-out-nothome" onClick={() => notHome(o)} disabled={busyId === o.id}>🚪 Not home</button>
                                <button type="button" className="driver-out-hold" onClick={() => hold(o)} disabled={busyId === o.id}>⚠ Couldn&rsquo;t deliver — hold for pickup</button>
                              </>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {done && (
                      <div className="driver-donerow">
                        <span className="driver-doneline">{o.status === "held_for_pickup" ? "Held for pickup" : o.status === "issue" ? (o.driver_note || "Not home — follow up") : "Delivered"}{o.empties_collected != null && o.refill_count > 0 && o.status === "delivered" ? ` · ${o.empties_collected}/${o.empties_expected} empties` : ""}</span>
                        <button type="button" className="driver-undo" onClick={() => rollback(o)}>↩ Undo</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {remaining === 0 && <div className="driver-wrap">Run complete — all {rows.length} stops handled. Nice driving. 🏁</div>}
          </div>
        );
      }}
    </AsyncSection>
  );
}
