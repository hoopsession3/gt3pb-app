"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth } from "@/components/AuthProvider";
import AccountPill from "@/components/AccountPill";
import Gt3Mark from "@/components/Gt3Mark";
import RouteMap, { type RoutePoint } from "@/components/RouteMap";
import Skeleton from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import { clickable } from "@/lib/a11y";
import { openDirections } from "@/lib/maps";
import { supabase } from "@/lib/supabase";
import type { Stop, LiveStatus } from "@/lib/db";

const DEMO_POINTS: RoutePoint[] = [
  { name: "Duncan Town Square", lat: 34.9382, lng: -82.1426, live: true },
  { name: "Greenville Run Club", lat: 34.8526, lng: -82.394 },
  { name: "Spartanburg Market", lat: 34.9496, lng: -81.932 },
  { name: "Founding First Pour", lat: 34.9387, lng: -82.2271 },
];

// ───────────────────────── editorial dispatch header (no card/tiles/clock) ─────────────────────────
function Dispatch({ live, place, sub, when, openLabel, eta, next, onOrder }: {
  live: boolean; place: string; sub: string; when: string; openLabel: string; eta?: string | null; next: string | null; onOrder: () => void;
}) {
  return (
    <header className="disp">
      <div className={`disp-eye${live ? " live" : ""}`}>{live && <span className="livedot" />}{live ? "Live now" : "Next stop"}</div>
      <h1 className="disp-name">{place}</h1>
      {sub && <p className="disp-sub">{sub}</p>}
      <div className="disp-facts">
        {/* Live: status leads. Not live: the DAY leads — "open 5pm" means nothing without it. */}
        <div className="fact"><span className="fk">{live ? "Status" : "Day"}</span><span className={`fv${live ? " ok" : ""}`}>{live ? "Live" : when || "Soon"}</span></div>
        <div className="fact"><span className="fk">Open</span><span className="fv">{openLabel || "—"}</span></div>
        {/* Only a real, data-backed third fact — no invented "wait" time. */}
        {eta && <div className="fact"><span className="fk">Next stop</span><span className="fv">{eta}</span></div>}
      </div>
      {next && <p className="disp-next">Next · <b>{next}</b></p>}
      <button type="button" className="t-order" onClick={onOrder}>Pre-order · skip the line</button>
    </header>
  );
}

function stopLabel(n: Stop | undefined): string | null {
  if (!n) return null;
  const when = [whenDay(n), whenDate(n), whenTime(n)].filter(Boolean).join(" ");
  return `${n.name}${when ? `, ${when}` : ""}`.trim();
}
// The stop AFTER the one being featured. When live, walk past the live stop; when idle, it's simply
// the second stop on the (date-ordered) road ahead — live_status.current_stop_id can be stale from
// the last session and must not steer this while the truck is offline.
function nextStop(stops: Stop[], isLive: boolean, liveId?: string | null): Stop | undefined {
  if (isLive && liveId) {
    const idx = stops.findIndex((s) => s.id === liveId);
    return (idx >= 0 ? stops.slice(idx + 1) : stops.slice(1)).find((s) => s.id !== liveId);
  }
  return stops[1];
}

// Day abbrev / time for a stop — prefer the hand-set labels, else derive from the real date (starts_at)
// so every dated stop shows its day, not a blank column.
function whenDay(s: Stop): string {
  if (s.when_label?.trim()) return s.when_label;
  if (s.starts_at) return new Date(s.starts_at).toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
  return "TBD";
}
function whenTime(s: Stop): string {
  if (s.time_label?.trim()) return s.time_label;
  if (s.starts_at) return new Date(s.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(" ", "").toLowerCase();
  return "";
}
// Hand-typed times arrive in any shape; if it's bare 24h ("16:30"), speak it like the rest of the
// page does ("4:30pm"). Anything else passes through untouched.
function fmt12(v?: string | null): string | null {
  if (!v) return v ?? null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return v;
  const h = Number(m[1]);
  if (h > 23) return v;
  return `${h % 12 || 12}:${m[2]}${h >= 12 ? "pm" : "am"}`;
}
// Calendar date "6/27" from the real date — so every dated stop always shows its date, not just a weekday.
function whenDate(s: Stop): string {
  if (!s.starts_at) return "";
  const d = new Date(s.starts_at);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
const TIER_LABEL: Record<string, string> = { full: "Full bar on board", coffee: "Coffee bar", nitro: "Nitro bar", beer: "Beer & wine on board" };
// One clean description line for a route card: never just echo the stop's own name back, and skip
// the stale seed location text ("Saturday Market", "Atlanta, Atlanta, GA"). Prefer the human note,
// then the menu tier — the actual place still lives on the map + Get Directions.
function descFor(s: Stop): string {
  const note = s.notes?.trim();
  if (note) return note;
  return TIER_LABEL[s.menu_tier ?? ""] ?? "Full bar on board";
}

// ───────────────────────── live (Supabase + realtime) ─────────────────────────
function TruckLive() {
  const { toast } = useApp();
  const router = useRouter();
  const [stops, setStops] = useState<Stop[]>([]);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [openStop, setOpenStop] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    // WRAPPED so this can never reject: load() is fired bare from five places (mount, both realtime
    // handlers, the 20s poll, focus/visibility). A dropped socket, an offline fetch, or a realtime
    // error object surfaces as an UNHANDLED promise rejection on /truck (the field-error alert).
    // On failure keep the last-known route; the poll + focus refetch recover on their own.
    try {
      const [{ data: s }, { data: l }] = await Promise.all([
        supabase.from("stops").select("*").order("sort"),
        supabase.from("live_status").select("*").maybeSingle(),
      ]);
      // Guests see the road AHEAD: hide archived, completed, and past-dated stops (a stop stays
      // visible through its evening — 8h grace past its start). The live stop always shows.
      const lstat = l as LiveStatus | null;
      const liveId = lstat?.is_live ? lstat.current_stop_id : null;
      const nowT = Date.now();
      if (s) setStops((s as (Stop & { completed_at?: string | null })[])
        .filter((x) =>
          !x.archived_at && x.status !== "done" && !x.completed_at
          && (x.id === liveId || !x.starts_at || new Date(x.starts_at).getTime() > nowT - 8 * 3600 * 1000)
        )
        // Soonest first: guests read the road in date order (undated stops sink to the end),
        // so the headline is always the next real stop — not whoever sorts first by hand.
        .sort((a, b) => (a.starts_at ? Date.parse(a.starts_at) : Infinity) - (b.starts_at ? Date.parse(b.starts_at) : Infinity))
      );
      if (lstat) setLive(lstat);
    } catch { /* keep last-known route; a later poll/focus refetch recovers */ }
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase
      .channel("truck-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_status" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "stops" }, () => load())
      .subscribe();
    // Self-heal: realtime can be missed on mobile (backgrounded tab, dropped socket),
    // which would leave a closed truck showing a stale "LIVE". Re-fetch the truth on a
    // timer and whenever the page comes back to the foreground.
    const poll = setInterval(load, 20000);
    const onVis = () => { if (typeof document !== "undefined" && document.visibilityState === "visible") load(); };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      // removeChannel returns a promise too — swallow so a teardown race can't reject unhandled.
      try { void Promise.resolve(supabase?.removeChannel(ch)).catch(() => {}); } catch { /* */ }
      clearInterval(poll);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [load]);

  const isLive = Boolean(live?.is_live);
  // Single source of truth = live_status.is_live + current_stop_id. Never derive
  // "live" from a stop's own status (it desyncs when the truck goes offline).
  const liveStop = (isLive && stops.find((s) => s.id === live?.current_stop_id)) || stops[0];
  const upcoming = nextStop(stops, isLive, live?.current_stop_id);
  // Memoize on `stops` only, so a realtime position update (which changes `live`, not
  // `stops`) doesn't rebuild the whole map — the truck dot just moves.
  const points: RoutePoint[] = useMemo(() => stops
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ name: s.name, lat: s.lat as number, lng: s.lng as number, live: isLive && s.id === live?.current_stop_id })), [stops, isLive, live?.current_stop_id]);
  // Show the live dot only while the truck is actually live and broadcasting a position.
  const truckPos = useMemo(
    () => (isLive && live?.truck_lat != null && live?.truck_lng != null ? { lat: live.truck_lat, lng: live.truck_lng } : null),
    [isLive, live?.truck_lat, live?.truck_lng]
  );

  return (
    <section className="screen truck" id="s-truck">
      <div className="toprow">
        <div className="mast-brand mast-dark">
          <Gt3Mark tone="cream" />
          <span className="pb">Performance Bar</span>
          <span className="mast-app">Only the best for you</span>
        </div>
        <AccountPill />
      </div>

      <Dispatch
        live={isLive}
        place={liveStop?.name ?? (loaded ? "No stops yet" : "…")}
        sub={liveStop ? descFor(liveStop) : ""}
        when={liveStop ? [whenDay(liveStop), whenDate(liveStop)].filter(Boolean).join(" ") : ""}
        openLabel={liveStop ? fmt12(whenTime(liveStop)) ?? "" : ""}
        eta={upcoming ? fmt12(whenTime(upcoming)) : null}
        next={stopLabel(upcoming)}
        onOrder={() => router.push("/menu")}
      />

      <div className="dchapter"><span className="dchn">The Route</span><span className="dchw">this week</span></div>
      <div className="dchrule" />

      {!loaded && <Skeleton variant="row" count={4} />}
      {/* the featured stop is the header hero — it never repeats as row one */}
      {stops.filter((s) => s.id !== liveStop?.id).map((s) => {
        const rowLive = isLive && s.id === live?.current_stop_id;
        const isOpen = openStop === s.id;
        return (
          <div key={s.id}>
            <div
              className={`stop${rowLive ? " now" : ""}${isOpen ? " open" : ""}`}
              aria-expanded={isOpen}
              aria-label={`${s.name}, ${rowLive ? "live now" : "upcoming"} — details`}
              {...clickable(() => setOpenStop(isOpen ? null : s.id))}
            >
              <div className="when"><b>{whenDay(s)}</b><span>{[whenDate(s), whenTime(s)].filter(Boolean).join(" ")}</span></div>
              <div className="info"><b>{s.name}</b><span>{descFor(s)}</span></div>
              {rowLive && <div className="tag live">Live</div>}
              <span className={`stop-caret${isOpen ? " open" : ""}`} aria-hidden="true">›</span>
            </div>
            {isOpen && (
              <div className="stop-detail">
                <p className="stop-notes">{s.notes ?? "Full bar on board. Order ahead or save a reminder."}</p>
                {rowLive ? (
                  <button className="t-order" style={{ marginTop: 12 }} onClick={() => router.push("/menu")}>Pre-order · skip the line</button>
                ) : (
                  <button className="t-ghost" style={{ marginTop: 12 }} onClick={() => toast("Saved — we'll remind you before this stop")}>Remind me</button>
                )}
                {s.lat != null && s.lng != null && (
                  <button className="t-ghost" style={{ marginTop: 10 }} onClick={() => openDirections(s.lat as number, s.lng as number)}>Get directions</button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {loaded && stops.length === 0 && <EmptyState title="No stops scheduled" sub="Check back soon — this week's route posts here." />}

      {points.length >= 2 && (
        <>
          <div className="dchapter"><span className="dchn">The Circuit</span><span className="dchw">tap a stop for directions</span></div>
          <div className="dchrule" />
          <RouteMap points={points} truck={truckPos} />
        </>
      )}
    </section>
  );
}

// ───────────────────────── demo (Supabase not configured) ─────────────────────────
function TruckDemo() {
  const { toast } = useApp();
  const router = useRouter();
  const rows = [
    { when: "NOW", time: "til 3p", name: "Duncan Town Square", desc: "Saturday Market", live: true, tag: "Live" },
    { when: "SUN", time: "10–2", name: "Greenville Run Club", desc: "Hydrate + Rebuild", live: false, tag: "Sun" },
    { when: "WED", time: "7–11", name: "Spartanburg Market", desc: "Full bar", live: false, tag: "Wed" },
    { when: "SAT", time: "2:30", name: "Founding First Pour", desc: "DUSK winter blend · members", live: false, tag: "Next" },
  ];
  return (
    <section className="screen truck" id="s-truck">
      <div className="toprow">
        <div className="mast-brand mast-dark">
          <Gt3Mark tone="cream" />
          <span className="pb">Performance Bar</span>
          <span className="mast-app">Only the best for you</span>
        </div>
        <AccountPill />
      </div>

      <Dispatch
        live
        place="Duncan Town Square"
        sub="Saturday Market — the full bar on board"
        when="SAT"
        openLabel="til 3p"
        next="Greenville Run Club — Sun 10–2"
        onOrder={() => router.push("/menu")}
      />

      <div className="dchapter"><span className="dchn">The Route</span><span className="dchw">this week</span></div>
      <div className="dchrule" />
      {rows.map((r) => (
        <div
          key={r.name}
          className={`stop${r.live ? " now" : ""}`}
          aria-label={`${r.name}, ${r.live ? "live now — pre-order" : "upcoming — save reminder"}`}
          {...clickable(() => (r.live ? router.push("/menu") : toast("Saved — we'll remind you")))}
        >
          <div className="when"><b>{r.when}</b><span>{r.time}</span></div>
          <div className="info"><b>{r.name}</b><span>{r.desc}</span></div>
          {r.live && <div className="tag live">Live</div>}
          <span className="stop-caret" aria-hidden="true">›</span>
        </div>
      ))}

      <div className="dchapter"><span className="dchn">The Circuit</span><span className="dchw">tap a stop for directions</span></div>
      <div className="dchrule" />
      <RouteMap points={DEMO_POINTS} />
    </section>
  );
}

export default function TruckScreen() {
  const { enabled } = useAuth();
  return enabled ? <TruckLive /> : <TruckDemo />;
}
