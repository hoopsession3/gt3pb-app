"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import AccountPill from "@/components/AccountPill";
import EditCopyPill from "@/components/EditCopyPill";
import EditableCopy from "@/components/EditableCopy";
import { Masthead, SectionHeader, InfoRow, ClosingBeat } from "@/components/kit";
import { RsvpRow } from "@/components/RsvpRow";
import RouteMap, { type RoutePoint } from "@/components/RouteMap";
import { openDirections } from "@/lib/maps";
import { supabase } from "@/lib/supabase";
import { useSiteCopy } from "@/lib/copy";
import { useAvailability } from "@/lib/availability";
import { localToday, relativeDay } from "@/lib/dates";
import type { LiveStatus, EventRow } from "@/lib/db";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Icon from "@/components/Icon";

// FIND US — the one answer to "where's GT3?", on the field_ops spine. Stops and events used to
// live on two strangers of pages; they're one chronological road now, each row self-typing:
// a stop trails a caret (details · directions · pre-order), an event trails the RSVP chip —
// the kit's InfoRow promise, structural. Reads ONE query: field_ops where is_public (0233's
// generated column + policy door serve exactly this surface). Both /truck and /events render
// this component, so every QR code and deep link in the wild keeps working.
//
// Fetch state, split in two on purpose:
//  - The INITIAL load rides useAsyncData/AsyncSection, so a real fetch failure shows a real error
//    with a retry — it used to render "No stops yet" / "Nothing scheduled yet, check back soon,"
//    identical to a truck with a genuinely empty week, which on a public ordering page reads as
//    "this business isn't running" rather than "the request failed."
//  - The BACKGROUND refresh (realtime + 20s poll + focus/visibility) stays deliberately silent,
//    same as before: a dropped socket or a missed poll must never reject unhandled or yank an
//    already-rendered schedule back to a loading/error screen. It just re-populates the same
//    local mirror the initial load fills.

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
type Board = { ops: FieldOp[]; live: LiveStatus | null };

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
// A couple of 86'd items doesn't make "Full bar on board" untrue — the truck genuinely still has
// a full bar. Only override the static tier tagline when the menu is near-empty (Ryan's call:
// lightweight severity flag, not per-item tracking — see truck.tier.limited in lib/copy.ts).
const MENU_DEPLETED_RATIO = 0.75;
// truck.tier.* stays Settings-only for now (2026-07-17): this picks ONE of five keys per stop,
// dynamically, from live sold-out data — and several stops can be on screen at once, each resolving
// independently. Making that inline-editable safely means descFor returning which key it resolved
// (not just the text) so the right stops re-render live, not a mechanical t(key)->EditableCopy swap
// like everywhere else this round. Flagged as a real follow-up, not skipped by oversight.
function descFor(s: FieldOp, t: (k: string) => string, avail: { soldOut: Set<string>; activeTotal: number }): string {
  const note = (s.notes ?? s.note)?.trim();
  if (note) return note;
  if (avail.activeTotal > 0 && avail.soldOut.size / avail.activeTotal >= MENU_DEPLETED_RATIO) {
    return t("truck.tier.limited");
  }
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

// Shared query, used by both the error-aware initial load and the silent background refresh.
async function fetchRoad(): Promise<Board> {
  // Explicit display columns only — NOT select("*"): matches the FieldOp type exactly, so a column
  // added to `field_ops` later doesn't silently reach this public customer road unreviewed. (The
  // venue POC contact columns this comment used to warn about — poc_name/phone/email/service_dates —
  // were dropped from the table entirely in migration 0240; there's nothing left to leak.)
  const [{ data: fo, error: e1 }, { data: l, error: e2 }] = await Promise.all([
    supabase!.from("field_ops").select("id, kind, name, day, starts_at, ends_at, start_time, end_time, day_label, when_label, time_label, location_text, address, lat, lng, member_only, going_count, capacity, blurb, menu_tier, notes, note, status, completed_at, archived_at, is_public").eq("is_public", true),
    supabase!.from("live_status").select("*").maybeSingle(),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  const lstat = l as LiveStatus | null;
  const liveId = lstat?.is_live ? lstat.current_stop_id : null;
  const nowT = Date.now();
  // the road AHEAD: hide completed/past (8h grace for stops through their evening; events
  // stay through their whole day) — the live stop always shows
  const ops = ((fo as FieldOp[]) ?? [])
    .filter((r) => r.status !== "done" && !r.completed_at
      && (r.id === liveId
        || (r.kind === "stop" ? (!r.starts_at || new Date(r.starts_at).getTime() > nowT - 8 * 3600 * 1000) : true)))
    .sort((a, b) => sortKey(a) - sortKey(b));
  return { ops, live: lstat };
}

export default function FindUs() {
  const router = useRouter();
  const t = useSiteCopy();
  const avail = useAvailability();
  const [ops, setOps] = useState<FieldOp[]>([]);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [openStop, setOpenStop] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { ops: [], live: null };
    return fetchRoad();
  }, []);
  const board = useAsyncData(loader, []);

  // Mirror the board into local state for rendering — the silent background refresh below writes
  // into the same mirror, so both paths feed one source of truth for the JSX below.
  useEffect(() => {
    if (board.data) { setOps(board.data.ops); setLive(board.data.live); }
  }, [board.data]);

  // Silent background refresh — realtime + 20s poll + focus/visibility. Deliberately independent
  // of `board`/AsyncSection: a dropped socket or a missed poll must never reject unhandled or flip
  // an already-rendered page back to a loading/error state; it keeps the last-known road instead.
  const refreshQuietly = useCallback(async () => {
    if (!supabase) return;
    try {
      const road = await fetchRoad();
      setOps(road.ops); setLive(road.live);
    } catch { /* keep last-known road */ }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    // The mirrors keep field_ops current on EVERY stop/event write — one realtime subscription
    // covers the whole road. live_status rides along for the hero + truck dot.
    const ch = supabase
      .channel("find-us")
      .on("postgres_changes", { event: "*", schema: "public", table: "field_ops" }, refreshQuietly)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_status" }, refreshQuietly)
      .subscribe();
    const poll = setInterval(refreshQuietly, 20000);
    const onVis = () => { if (typeof document !== "undefined" && document.visibilityState === "visible") refreshQuietly(); };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      try { void Promise.resolve(supabase?.removeChannel(ch)).catch(() => {}); } catch { /* */ }
      clearInterval(poll);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [refreshQuietly]);

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
        right={<div className="mast-right"><EditCopyPill group="Truck" /><AccountPill /></div>}
      />

      <h1 className="k-title lg">{hero?.name ?? (board.status === "error" ? "Couldn't load" : board.status === "ready" ? "No stops yet" : "…")}</h1>
      {hero && <p className="k-sub">{hero.kind === "stop" ? descFor(hero, t, avail) : (hero.blurb ?? hero.location_text ?? "")}</p>}

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
      <AsyncSection state={board} isEmpty={() => upcoming.length === 0} emptyTitle="Nothing scheduled yet" emptySub="This week's stops and events post here — check back soon." errorTitle="Couldn't load the schedule" loadingLabel="Loading the schedule…">
        {() => (
          <>
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
                      sub={descFor(r, t, avail)}
                      live={rowLive}
                      trailing={<span className={`k-caret${isOpen ? " open" : ""}`} aria-hidden="true">›</span>}
                      onClick={() => setOpenStop(isOpen ? null : r.id)}
                      ariaLabel={`${r.name}, ${rowLive ? "live now" : "upcoming"} — details`}
                      expanded={isOpen}
                    />
                    {isOpen && (
                      <div className="k-detail">
                        <p>{(r.notes ?? r.note) ?? <EditableCopy k="truck.stop_note" value={t("truck.stop_note")} as="span" />}</p>
                        {rowLive && <button type="button" className="k-chip pri" onClick={() => router.push("/menu")}>Pre-order</button>}
                        {r.lat != null && r.lng != null && (
                          <button type="button" className="k-chip k-chip-sec" style={rowLive ? { marginLeft: 8 } : undefined} onClick={() => openDirections(r.lat as number, r.lng as number)}>Get directions</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

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
          </>
        )}
      </AsyncSection>

      <SectionHeader label="Bring Us To You" annotation="private events" />
      <p style={{ fontSize: 14, color: "var(--cream-m)", margin: "14px 2px 12px" }}>Pours, run clubs, launches — we set up anywhere.</p>
      <button type="button" className="btn-ter" onClick={() => router.push("/book")}>
        Book the bar for your event <b><Icon name="arrowRight" /></b>
      </button>

      <ClosingBeat />
    </section>
  );
}
