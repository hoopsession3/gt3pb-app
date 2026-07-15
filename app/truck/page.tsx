"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import AccountPill from "@/components/AccountPill";
import { Masthead, SectionHeader, InfoRow, ClosingBeat } from "@/components/kit";
import RouteMap, { type RoutePoint } from "@/components/RouteMap";
import Skeleton from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import { openDirections } from "@/lib/maps";
import { supabase } from "@/lib/supabase";
import { useSiteCopy } from "@/lib/copy";
import type { Stop, LiveStatus } from "@/lib/db";

// TRUCK — the public front door, on the kit (Design System v1). Masthead → eyebrow
// (Live now / Next stop) → hero name + tier tagline → facts strip → ONE red CTA →
// The Route (InfoRows) → The Circuit (map) → closing beat. No demo data anywhere:
// without Supabase this renders the honest empty state.

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
const TIER_KEYS = new Set(["full", "coffee", "nitro", "beer"]);
// One clean description line for a route row: never just echo the stop's own name back. Prefer the
// human note, then the menu-tier tagline — owner-editable copy (site_copy: truck.tier.*), dynamic
// to what's actually on board that day, not hardcoded.
function descFor(s: Stop, t: (k: string) => string): string {
  const note = s.notes?.trim();
  if (note) return note;
  const tier = s.menu_tier && TIER_KEYS.has(s.menu_tier) ? s.menu_tier : "full";
  return t(`truck.tier.${tier}`);
}

export default function TruckScreen() {
  const router = useRouter();
  const t = useSiteCopy();
  const [stops, setStops] = useState<Stop[]>([]);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [openStop, setOpenStop] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) { setLoaded(true); return; }
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

  const heroWhen = liveStop ? [whenDay(liveStop), whenDate(liveStop)].filter(Boolean).join(" ") : "";
  const heroOpen = liveStop ? fmt12(whenTime(liveStop)) ?? "" : "";
  const nextTime = upcoming ? fmt12(whenTime(upcoming)) : null;

  return (
    <section className="screen truck" id="s-truck">
      <Masthead eyebrow={isLive ? "Live now" : "Next stop"} live={isLive} right={<AccountPill />} />

      <h1 className="k-title lg">{liveStop?.name ?? (loaded ? "No stops yet" : "…")}</h1>
      {liveStop && <p className="k-sub">{descFor(liveStop, t)}</p>}

      <div className="k-facts">
        {/* Live: status leads. Not live: the DAY leads — "open 5pm" means nothing without it. */}
        <div className="f"><div className="fk">{isLive ? "Status" : "Day"}</div><div className={`fv${isLive ? " ok" : ""}`}>{isLive ? "Live" : heroWhen || "Soon"}</div></div>
        <div className="f"><div className="fk">Open</div><div className="fv">{heroOpen || "—"}</div></div>
        {/* Only a real, data-backed third fact — no invented "wait" time. */}
        {nextTime && <div className="f"><div className="fk">Next stop</div><div className="fv">{nextTime}</div></div>}
      </div>

      <button type="button" className="btn-pri k-cta" onClick={() => router.push("/menu")}>PRE-ORDER · SKIP THE LINE</button>
      {upcoming && <p className="k-cap" style={{ marginTop: 12 }}>Then · {stopLabel(upcoming)}</p>}

      <SectionHeader label="The Route" annotation="this week" />
      {!loaded && <Skeleton variant="row" count={4} />}
      <div className="k-rows">
        {/* the featured stop is the hero — it never repeats as row one */}
        {stops.filter((s) => s.id !== liveStop?.id).map((s) => {
          const rowLive = isLive && s.id === live?.current_stop_id;
          const isOpen = openStop === s.id;
          return (
            <div key={s.id}>
              <InfoRow
                lead={whenDay(s)}
                leadSub={[whenDate(s), whenTime(s)].filter(Boolean).join(" ")}
                name={s.name}
                sub={descFor(s, t)}
                live={rowLive}
                trailing={<span className={`k-caret${isOpen ? " open" : ""}`} aria-hidden="true">›</span>}
                onClick={() => setOpenStop(isOpen ? null : s.id)}
                ariaLabel={`${s.name}, ${rowLive ? "live now" : "upcoming"} — details`}
                expanded={isOpen}
              />
              {isOpen && (
                <div className="k-detail">
                  <p>{s.notes ?? t("truck.stop_note")}</p>
                  {rowLive && (
                    <button type="button" className="k-chip pri" onClick={() => router.push("/menu")}>Pre-order</button>
                  )}
                  {s.lat != null && s.lng != null && (
                    <button type="button" className="k-chip sec" style={rowLive ? { marginLeft: 8 } : undefined} onClick={() => openDirections(s.lat as number, s.lng as number)}>Get directions</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {loaded && stops.length === 0 && <EmptyState title="No stops scheduled" sub="Check back soon — this week's route posts here." />}

      {points.length >= 2 && (
        <>
          <SectionHeader label="The Circuit" annotation="tap a stop for directions" />
          <RouteMap points={points} truck={truckPos} />
        </>
      )}

      <ClosingBeat />
    </section>
  );
}
