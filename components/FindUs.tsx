"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import AccountPill from "@/components/AccountPill";
import { Masthead, SectionHeader, InfoRow, ClosingBeat } from "@/components/kit";
import { RsvpRow } from "@/components/RsvpRow";
import RouteMap, { type RoutePoint } from "@/components/RouteMap";
import Skeleton from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import { openDirections } from "@/lib/maps";
import { supabase } from "@/lib/supabase";
import { useSiteCopy } from "@/lib/copy";
import { localToday, relativeDay } from "@/lib/dates";
import type { LiveStatus, EventRow } from "@/lib/db";

// FIND US — the one answer to "where's GT3?", on the field_ops spine. Stops and events used to
// live on two strangers of pages; they're one chronological road now, each row self-typing:
// a stop trails a caret (details · directions · pre-order), an event trails the RSVP chip —
// the kit's InfoRow promise, structural. Reads ONE query: field_ops where is_public (0233's
// generated column + policy door serve exactly this surface). Both /truck and /events render
// this component, so every QR code and deep link in the wild keeps working.

type FieldOp = {
  id: string; kind: "event" | "stop"; name: string;
  day: string | null; starts_at: string | null; ends_at: string | null;
  start_time: string | null; end_time: string | null;
  day_label: string | null; when_label: string | null; time_label: string | null;
  location_text: string | null; address: string | null; lat: number | null; lng: number | null;
  member_only: boolean | null; going_count: number | null; capacity: number | null; blurb: string | null;
  menu_tier: string | null; notes: string | null; note: string | null;
  status: string | null; completed_at: string | null; archived_at: string | null;
  is_public: boolean;
};

// ── stop label helpers (from the truck page — hand-set labels win, else derive) ─────────────────
function whenDay(s: FieldOp): string {
  if (s.when_label?.trim()) return s.when_label;
  if (s.starts_at) return new Date(s.starts_at).toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
  if (s.day) { const [y, m, d] = s.day.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short" }).toUpperCase(); }
  return "TBD";
}
function whenTime(s: FieldOp): string {
  if (s.time_label?.trim()) return s.time_label;
  if (s.starts_at) return new Date(s.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(" ", "").toLowerCase();
  return "";
}
function fmt12(v?: string | null): string | null {
  if (!v) return v ?? null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return v;
  const h = Number(m[1]);
  if (h > 23) return v;
  return `${h % 12 || 12}:${m[2]}${h >= 12 ? "pm" : "am"}`;
}
function whenDate(s: FieldOp): string {
  const iso = s.starts_at ?? (s.day ? `${s.day}T12:00:00` : null);
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
const TIER_KEYS = new Set(["full", "coffee", "nitro", "beer"]);
function descFor(s: FieldOp, t: (k: string) => string): string {
  const note = (s.notes ?? s.note)?.trim();
  if (note) return note;
  const tier = s.menu_tier && TIER_KEYS.has(s.menu_tier) ? s.menu_tier : "full";
  return t(`truck.tier.${tier}`);
}
// The road is read in time order: stops carry a real instant; events carry a day (+ start_time).
function sortKey(r: FieldOp): number {
  if (r.kind === "stop") return r.starts_at ? Date.parse(r.starts_at) : Infinity;
  if (!r.day) return Infinity;
  const t = /^(\d{1,2}):(\d{2})/.exec(r.start_time ?? "");
  return new Date(`${r.day}T${t ? `${String(t[1]).padStart(2, "0")}:${t[2]}` : "12:00"}:00`).getTime();
}
// field_ops event row -> the EventRow shape RsvpRow expects (same UUID as events by construction).
function toEventRow(r: FieldOp): EventRow {
  return { ...(r as unknown as Record<string, unknown>), title: r.name } as unknown as EventRow;
}

export default function FindUs() {
  const router = useRouter();
  const t = useSiteCopy();
  const [ops, setOps] = useState<FieldOp[]>([]);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [openStop, setOpenStop] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) { setLoaded(true); return; }
    // Wrapped so a dropped socket can never reject unhandled; the poll/focus refetch recovers.
    try {
      const [{ data: fo }, { data: l }] = await Promise.all([
        // Explicit display columns only — NOT select("*"): the row carries venue POC contact PII
        // (poc_name/phone/email/service_dates) that this public customer road must never fetch to the
        // browser. Matches the FieldOp type exactly. (Follow-up: revoke those columns from anon at the DB.)
        supabase.from("field_ops").select("id, kind, name, day, starts_at, ends_at, start_time, end_time, day_label, when_label, time_label, location_text, address, lat, lng, member_only, going_count, capacity, blurb, menu_tier, notes, note, status, completed_at, archived_at, is_public").eq("is_public", true),
        supabase.from("live_status").select("*").maybeSingle(),
      ]);
      const lstat = l as LiveStatus | null;
      const liveId = lstat?.is_live ? lstat.current_stop_id : null;
      const nowT = Date.now();
      if (fo) setOps((fo as FieldOp[])
        // the road AHEAD: hide completed/past (8h grace for stops through their evening; events
        // stay through their whole day) — the live stop always shows
        .filter((r) => r.status !== "done" && !r.completed_at
          && (r.id === liveId
            || (r.kind === "stop" ? (!r.starts_at || new Date(r.starts_at).getTime() > nowT - 8 * 3600 * 1000) : true)))
        .sort((a, b) => sortKey(a) - sortKey(b)));
      if (lstat) setLive(lstat);
    } catch { /* keep last-known road */ }
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    if (!supabase) return;
    // The mirrors keep field_ops current on EVERY stop/event write — one realtime subscription
    // covers the whole road. live_status rides along for the hero + truck dot.
    const ch = supabase
      .channel("find-us")
      .on("postgres_changes", { event: "*", schema: "public", table: "field_ops" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "live_status" }, () => load())
      .subscribe();
    const poll = setInterval(load, 20000);
    const onVis = () => { if (typeof document !== "undefined" && document.visibilityState === "visible") load(); };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      try { void Promise.resolve(supabase?.removeChannel(ch)).catch(() => {}); } catch { /* */ }
      clearInterval(poll);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [load]);

  const today = localToday();
  const isLive = Boolean(live?.is_live);
  // past events fold below (stops age out of the query window instead)
  const upcoming = ops.filter((r) => r.kind === "stop" || !r.day || r.day >= today);
  const past = ops.filter((r) => r.kind === "event" && r.day && r.day < today);
  // the hero is the next PLACE TO FIND US — live stop first, else first upcoming stop or event
  const hero = (isLive && upcoming.find((r) => r.id === live?.current_stop_id)) || upcoming[0];
  // Humanize the hero's "when" (the one "where's the truck next" answer): relativeDay returns an
  // unambiguous near-term qualifier — "Today" / "This Sat" / "Next Sat" — which we pair with the
  // numeric date for clarity ("This Sat · 7/18"). Anything past two weeks (or with no date) keeps
  // the original absolute weekday + M/D exactly as before.
  const heroRel = hero ? relativeDay(hero.starts_at ?? (hero.day ? `${hero.day}T12:00:00` : "")) : "";
  const heroWhen = !hero
    ? ""
    : /^(Today|Tomorrow|Yesterday|This |Next )/.test(heroRel) || heroRel.endsWith("d ago")
      ? [heroRel, whenDate(hero)].filter(Boolean).join(" · ")
      : [whenDay(hero), whenDate(hero)].filter(Boolean).join(" ");
  const heroOpen = hero ? (hero.kind === "stop" ? fmt12(whenTime(hero)) ?? "" : fmt12(hero.start_time) ?? "") : "";

  const points: RoutePoint[] = useMemo(() => ops
    .filter((r) => r.lat != null && r.lng != null)
    .map((r) => ({ name: r.name, lat: r.lat as number, lng: r.lng as number, live: isLive && r.id === live?.current_stop_id })), [ops, isLive, live?.current_stop_id]);
  const truckPos = useMemo(
    () => (isLive && live?.truck_lat != null && live?.truck_lng != null ? { lat: live.truck_lat, lng: live.truck_lng } : null),
    [isLive, live?.truck_lat, live?.truck_lng]
  );

  return (
    <section className="screen truck" id="s-find">
      <Masthead
        eyebrow={isLive ? "Live now" : hero?.kind === "event" ? "Next event" : "Next stop"}
        live={isLive}
        right={<AccountPill />}
      />

      <h1 className="k-title lg">{hero?.name ?? (loaded ? "No stops yet" : "…")}</h1>
      {hero && <p className="k-sub">{hero.kind === "stop" ? descFor(hero, t) : (hero.blurb ?? hero.location_text ?? "")}</p>}

      <div className="k-facts">
        <div className="f"><div className="fk">{isLive ? "Status" : "Day"}</div><div className={`fv${isLive ? " ok" : ""}`}>{isLive ? "Live" : heroWhen || "Soon"}</div></div>
        <div className="f"><div className="fk">{hero?.kind === "event" ? "Starts" : "Open"}</div><div className="fv">{heroOpen || "—"}</div></div>
        {hero?.kind === "event" && hero.going_count != null && hero.going_count > 0 && (
          <div className="f"><div className="fk">Going</div><div className="fv">{hero.going_count}</div></div>
        )}
      </div>

      {/* ONE red action per screen: pre-order when the truck is the story. */}
      <button type="button" className="btn-pri k-cta" onClick={() => router.push("/menu")}>PRE-ORDER · SKIP THE LINE</button>


      <SectionHeader label="On The Road" annotation="stops & events, in order" />
      {!loaded && <Skeleton variant="row" count={4} />}
      <div className="k-rows">
        {upcoming.filter((r) => r.id !== hero?.id || r.kind === "event").map((r) => {
          if (r.kind === "event") return <RsvpRow key={r.id} ev={toEventRow(r)} />;
          const rowLive = isLive && r.id === live?.current_stop_id;
          const isOpen = openStop === r.id;
          return (
            <div key={r.id}>
              <InfoRow
                lead={whenDay(r)}
                leadSub={[whenDate(r), whenTime(r)].filter(Boolean).join(" ")}
                name={r.name}
                sub={descFor(r, t)}
                live={rowLive}
                trailing={<span className={`k-caret${isOpen ? " open" : ""}`} aria-hidden="true">›</span>}
                onClick={() => setOpenStop(isOpen ? null : r.id)}
                ariaLabel={`${r.name}, ${rowLive ? "live now" : "upcoming"} — details`}
                expanded={isOpen}
              />
              {isOpen && (
                <div className="k-detail">
                  <p>{(r.notes ?? r.note) ?? t("truck.stop_note")}</p>
                  {rowLive && <button type="button" className="k-chip pri" onClick={() => router.push("/menu")}>Pre-order</button>}
                  {r.lat != null && r.lng != null && (
                    <button type="button" className="k-chip sec" style={rowLive ? { marginLeft: 8 } : undefined} onClick={() => openDirections(r.lat as number, r.lng as number)}>Get directions</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {loaded && upcoming.length === 0 && <EmptyState title="Nothing scheduled yet" sub="This week's stops and events post here — check back soon." />}

      {past.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button type="button" className="btn-ter" onClick={() => setShowPast((s) => !s)} aria-expanded={showPast}>
            Past events · {past.length} <span className={`k-caret${showPast ? " open" : ""}`}>›</span>
          </button>
          {showPast && <div className="k-rows">{past.map((r) => <RsvpRow key={r.id} ev={toEventRow(r)} />)}</div>}
        </div>
      )}

      {points.length >= 2 && (
        <>
          <SectionHeader label="The Circuit" annotation="tap a stop for directions" />
          <RouteMap points={points} truck={truckPos} />
        </>
      )}

      <SectionHeader label="Bring Us To You" annotation="private events" />
      <p style={{ fontSize: 14, color: "var(--cream-m)", margin: "14px 2px 12px" }}>Pours, run clubs, launches — we set up anywhere.</p>
      <button type="button" className="btn-ter" onClick={() => router.push("/book")}>
        Book the bar for your event <b>→</b>
      </button>

      <ClosingBeat />
    </section>
  );
}
