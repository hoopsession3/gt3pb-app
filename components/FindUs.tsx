"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import AccountPill from "@/components/AccountPill";
import EditCopyPill from "@/components/EditCopyPill";
import EditableCopy from "@/components/EditableCopy";
import { Masthead, SectionHeader, InfoRow, ClosingBeat } from "@/components/kit";
import { RsvpRow } from "@/components/RsvpRow";
import RouteMap, { type RoutePoint } from "@/components/RouteMap";
import { openDirections, openAddress } from "@/lib/maps";
import { subscribePush } from "@/lib/push";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabase";
import { useSiteCopy } from "@/lib/copy";
import { marketsPresent, rowInMarket, shouldOfferMarketChoice, MARKET_LABEL } from "@/lib/markets";
import { useViewerMarket } from "@/components/useViewerMarket";
import { useOrderingOpen } from "@/components/useOrderingOpen";
import { closedWords, readyWords } from "@/lib/ordering";
import { useAvailability } from "@/lib/availability";
import { localToday, relativeDay, fmt12, clockTime } from "@/lib/dates";
import { isStopAhead } from "@/lib/road";
import { clickable } from "@/lib/a11y";
import type { LiveStatus, EventRow } from "@/lib/db";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Icon from "@/components/Icon";
import Skeleton from "@/components/Skeleton";

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
  id: string; kind: "event" | "stop"; name: string; public_title?: string | null; published_at?: string | null; market?: string | null;
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
const NO_OPS: FieldOp[] = [];

// ── stop label helpers (from the truck page — hand-set labels win, else derive) ─────────────────
function whenDay(s: FieldOp): string {
  if (s.when_label?.trim()) return s.when_label;
  if (s.starts_at) return new Date(s.starts_at).toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
  if (s.day) { const [y, m, d] = s.day.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short" }).toUpperCase(); }
  return "TBD";
}
function whenTime(s: FieldOp): string {
  if (s.time_label?.trim()) return s.time_label;
  // Keep the minutes ("7:00am", never "7am") — the event rows on the same list always carry
  // minutes (fmt12's "6:00pm"), and the two conventions sat side by side until 2026-07-30
  // (Ryan's screenshot: stop lead said "7AM", event meta said "6:00pm").
  //
  // The formatter itself moved to lib/dates (2026-09-09) when the company calendar needed the same
  // thing and would have made it a fourth copy. Same drift, same fix as fmt12 before it: the
  // implementation moves, the caller keeps its own rule about time_label winning.
  return clockTime(s.starts_at);
}
// fmt12 moved to lib/dates.ts (2026-07-29) — RsvpRow's event time needed the exact same
// normalization and a private copy here couldn't cross the file boundary. See it there for the
// full history; this page now shares one implementation with the event rows instead of drifting.
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
// truck.tier.* (2026-07-17): this picks ONE of five keys per stop, dynamically, from live sold-out
// data — and several stops can be on screen at once, each resolving independently, so descFor
// returns WHICH key it resolved (not just the text) rather than a mechanical t(key)->EditableCopy
// swap like everywhere else this rollout. That unblocks wiring, but doesn't clear every render site:
// the "On The Road" list below renders each stop as a whole-row <button> (tap-to-expand), so an
// EditableCopy there would nest an editable control inside a native button — same excluded case as
// Craft's CTAs. Only the hero line above the list (a plain <p>, no button ancestor) is a safe click
// target, so that's the one instance actually wrapped; the list rows keep reading .text directly.
type StopDesc = { key: string | null; text: string };
function descFor(s: FieldOp, t: (k: string) => string, avail: { soldOut: Set<string>; activeTotal: number }): StopDesc {
  const note = (s.notes ?? s.note)?.trim();
  if (note) return { key: null, text: note };
  if (avail.activeTotal > 0 && avail.soldOut.size / avail.activeTotal >= MENU_DEPLETED_RATIO) {
    return { key: "truck.tier.limited", text: t("truck.tier.limited") };
  }
  const tier = s.menu_tier && TIER_KEYS.has(s.menu_tier) ? s.menu_tier : "full";
  const key = `truck.tier.${tier}`;
  return { key, text: t(key) };
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
    supabase!.from("field_ops").select("id, kind, name, public_title, day, starts_at, ends_at, start_time, end_time, day_label, when_label, time_label, location_text, address, lat, lng, member_only, going_count, capacity, blurb, menu_tier, notes, note, status, completed_at, archived_at, is_public, published_at, market").eq("is_public", true),
    supabase!.from("live_status").select("*").maybeSingle(),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  const lstat = l as LiveStatus | null;
  const liveId = lstat?.is_live ? lstat.current_stop_id : null;
  // the road AHEAD: hide completed/past (8h grace for stops through their evening; events
  // stay through their whole day) — the live stop always shows. Publish gate (0270): RLS already
  // hides unpublished events from guests; this mirrors it client-side so a STAFF preview of Find Us
  // shows exactly what a guest sees. Stops are always public; an event needs published_at.
  // A stop's half of that is lib/stopRecord's isStopAhead — the same rule the crew's Live truck
  // instrument reads, so "next stop" cannot mean one thing to a guest and another to the crew
  // (2026-10-04: this page said "Nothing scheduled yet" while the instrument offered Go live).
  const ops = ((fo as FieldOp[]) ?? [])
    .filter((r) => (r.kind === "stop" || r.published_at))
    .map((r) => (r.public_title ? { ...r, name: r.public_title } : r))   // guest-facing name wins on the public road
    .filter((r) => r.kind === "stop"
      ? isStopAhead(r, liveId)
      : r.status !== "done" && !r.completed_at)
    .sort((a, b) => sortKey(a) - sortKey(b));
  return { ops, live: lstat };
}

export default function FindUs() {
  const router = useRouter();
  const t = useSiteCopy();
  const avail = useAvailability();
  const [openStop, setOpenStop] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { ops: [], live: null };
    return fetchRoad();
  }, []);
  const board = useAsyncData(loader, []);

  // ONE ROAD ON SCREEN: the first read, until the silent refresh below has a newer one. This was a
  // mirror an effect filled from the first read — one render AFTER it landed, so the frame in
  // between drew "nothing scheduled" over an empty road and the next one pushed the real stop in
  // under it (2026-10-04, the layout-shift finding below).
  const [fresh, setFresh] = useState<Board | null>(null);
  const road = fresh ?? board.data ?? null;
  const ops = road?.ops ?? NO_OPS;
  const live = road?.live ?? null;

  // Silent background refresh — realtime + 20s poll + focus/visibility. Deliberately independent
  // of `board`/AsyncSection: a dropped socket or a missed poll must never reject unhandled or flip
  // an already-rendered page back to a loading/error state; it keeps the last-known road instead.
  const refreshQuietly = useCallback(async () => {
    if (!supabase) return;
    try {
      setFresh(await fetchRoad());
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
  // A stop can carry a close time (stops.ends_at). Two automatic wind-downs hang off it, so the
  // operator never has to remember to flip anything at the end of service:
  //   • online pre-ordering closes 60 min before that close time (stop taking orders you can't fill
  //     before packing up) — lib/ordering's rule now (2026-10-04), because it was true ONLY on this
  //     page: the menu, checkout and /api/checkout went on taking orders through the last hour; and
  //   • the truck stops reading "Live" 45 min before it — this page's own display rule.
  // Ordering closes FIRST, then the truck goes offline — never the reverse. No close time set →
  // neither fires (the manual is_live flag stands and ordering stays open). Both are computed at
  // render (re-evaluated on the poll), so no cron has to write a flag on the tick.
  const LIVE_OFF_BEFORE_MS = 45 * 60_000;
  const nowMs = Date.now();
  // MARKET (0279) — the audit's step 02. This road used to be every public stop everywhere, sorted
  // by time, shown to everyone: a Greenville member's "where's the truck next" could answer with a
  // stop four hours away. The QUERY stays unfiltered on purpose, because the screen needs to see
  // which cities are actually running in order to know whether a choice is even worth offering —
  // filtering here costs nothing and keeps it to one round trip.
  //
  // With one city on the road, `present` is ["greenville"], `viewerMarket` is greenville, and every
  // row passes: byte-identical to before. The switcher does not render at all.
  const present = marketsPresent(ops);
  const { market: viewerMarket, choose: chooseMarket } = useViewerMarket(present);
  const roadOps = ops.filter((r) => rowInMarket(r, viewerMarket));
  const liveStop = live?.is_live ? roadOps.find((r) => r.id === live.current_stop_id) : undefined;
  const liveEndsMs = liveStop?.ends_at ? new Date(liveStop.ends_at).getTime() : null;
  const isLive = Boolean(live?.is_live) && (liveEndsMs == null || nowMs < liveEndsMs - LIVE_OFF_BEFORE_MS);
  // CAN A CUP BE ORDERED — the rule the menu, the drink sheet, checkout and the server ask
  // (lib/ordering). This page used to ask nothing: "PRE-ORDER · SKIP THE LINE" with no stop on the
  // schedule, into a menu whose every drink said the truck was closed. Until the read lands it
  // claims nothing either way (the button it always had, an empty line under it).
  const ordering = useOrderingOpen(true, viewerMarket, `${live?.is_live ?? ""}|${live?.current_stop_id ?? ""}|${roadOps.map((r) => `${r.id}${r.starts_at ?? ""}${r.ends_at ?? ""}`).join()}`).ordering;
  // past events fold below (stops age out of the query window instead)
  const upcoming = roadOps.filter((r) => r.kind === "stop" || !r.day || r.day >= today);
  const past = roadOps.filter((r) => r.kind === "event" && r.day && r.day < today);
  // the hero is the next PLACE TO FIND US — live stop first, else first upcoming stop or event
  const hero = (isLive && upcoming.find((r) => r.id === live?.current_stop_id)) || upcoming[0];
  // Humanize the hero's "when" (the one "where's the truck next" answer): relativeDay returns an
  // unambiguous near-term qualifier — "Today" / "This Sat" — which we pair with the numeric date for
  // clarity ("This Sat · 7/18"). Anything a week or more out (or with no date) keeps the original
  // absolute weekday + M/D — no "Next {wd}", which misread a 12-day-out Friday as the wrong Friday.
  const heroRel = hero ? relativeDay(hero.starts_at ?? (hero.day ? `${hero.day}T12:00:00` : "")) : "";
  const heroWhen = !hero
    ? ""
    : /^(Today|Tomorrow|Yesterday|This )/.test(heroRel) || heroRel.endsWith("d ago")
      ? [heroRel, whenDate(hero)].filter(Boolean).join(" · ")
      : [whenDay(hero), whenDate(hero)].filter(Boolean).join(" ");
  // Events used to read start_time only — if that field was never set (even with a perfectly good
  // starts_at timestamp, the same one the Day column above derives from), Starts silently showed
  // "—". whenTime() already has the right fallback chain (label, then derive from starts_at) and
  // stops were already using it; events just weren't falling through to it. now they do.
  const heroOpen = hero ? fmt12(hero.kind === "event" ? hero.start_time || whenTime(hero) : whenTime(hero)) ?? "" : "";
  const heroClose = !hero ? "" : hero.kind === "stop"
    ? (hero.ends_at ? fmt12(`${String(new Date(hero.ends_at).getHours()).padStart(2, "0")}:${String(new Date(hero.ends_at).getMinutes()).padStart(2, "0")}`) ?? "" : "")
    : (fmt12(hero.end_time) ?? "");
  // Only the hero copy (below) is a safe EditableCopy target — see the comment on descFor.
  const heroDesc = hero?.kind === "stop" ? descFor(hero, t, avail) : null;
  // THE WHERE (2026-08-01, Ryan's 4/10 audit: "how would a client know where the truck is?").
  // One derivation feeds the hero's Where cell + its Get-directions chip, identically for stops
  // and events (the spine carries location_text/address/lat/lng for both kinds). Nothing set →
  // the cell says "Location TBA" honestly and the chip simply doesn't render.
  const heroWhere = hero ? ((hero.location_text?.trim() || hero.address?.trim()) || null) : null;
  const heroHasCoords = hero?.lat != null && hero?.lng != null;
  // Ryan's polish pass ("is it giving 10/10 CSS?"): a raw one-string address wraps wherever it
  // runs out of column — "…Simpsonville, SC / 29681" with an orphaned ZIP. Split it into a
  // DELIBERATE two-line lockup instead: street as the value, city/state as a quiet support line,
  // ZIP off the display entirely (noise to a human; directions still get the full string). A
  // place name with no comma stays one line untouched.
  const whereParts = (heroWhere ?? "").split(/,\s*/);
  const whereLoc = whereParts.length >= 2 ? whereParts.slice(1).join(", ").replace(/\s+\d{5}(?:-\d{4})?\s*$/, "").trim() : "";
  const whereStreet = whereLoc ? whereParts[0] : heroWhere;
  const goHero = () => { if (heroHasCoords) openDirections(hero!.lat as number, hero!.lng as number); else if (heroWhere) openAddress(heroWhere); };

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
        eyebrow={isLive ? t("findus.eyebrow_live") : hero?.kind === "event" ? t("findus.eyebrow_event") : t("findus.eyebrow_stop")}
        live={isLive}
        right={<div className="mast-right"><EditCopyPill group="Truck" /><AccountPill /></div>}
      />

      {/* NOTHING BELOW THE MASTHEAD IS DRAWN BEFORE THE ROAD IS READ (2026-10-04).
          The first paint used to be the page with nothing in it — "…", "Day: Soon", "Open: —", the
          red button, "Loading the schedule…" — and then the real stop filled it in: a subtitle, an
          address three lines tall, a second chip row, the list. Everything under the title moved
          ~90px down at once. Production measured layout shift 0.38 on /truck (the gate is 0.04;
          Google calls anything over 0.25 poor), on the page every QR code opens.
          Now a skeleton stands in for the whole page and is REPLACED when the read lands, never
          filled in: layout shift measures things that move, and nodes that are replaced do not
          move. The key makes React swap them rather than reuse them. */}
      {!(board.data || board.status === "error") ? <FindUsSkeleton /> : (<Fragment key="road">

      {/* City switcher — renders ONLY once a second market genuinely has something on the road.
          While Greenville runs alone there is no choice to make, so there is no control to explain,
          no state to get wrong, and the screen is exactly what it was. */}
      {shouldOfferMarketChoice(present) && (
        <div className="mkt-switch" role="group" aria-label="Choose a city">
          {present.map((m) => (
            <button key={m} type="button" className={`mkt-chip${m === viewerMarket ? " on" : ""}`}
              aria-pressed={m === viewerMarket} onClick={() => chooseMarket(m)}>
              {MARKET_LABEL[m]}
            </button>
          ))}
        </div>
      )}

      <h1 className="k-title lg">{hero?.name ?? (board.status === "error" ? "Couldn't load" : board.status === "ready" ? t("findus.no_stops") : "…")}</h1>
      {hero && (
        <p className="k-sub">
          {heroDesc
            ? (heroDesc.key ? <EditableCopy k={heroDesc.key} value={heroDesc.text} as="span" /> : heroDesc.text)
            : (hero.blurb ?? "")   /* the address left this slot for its own Where cell below — no more double-print */}
        </p>
      )}

      <div className="k-facts">
        {/* WHERE leads — it's the page's primary question and it was the one fact this row never
            answered (2026-08-01 audit). Same cell for stops and events; smaller type (.where) so
            a real street address stays presentable in a third of the row. */}
        {hero && (
          <div className="f"><EditableCopy k="findus.fact_where" value={t("findus.fact_where")} as="div" className="fk" />
            {heroWhere ? (
              /* the address IS the tap target too — same directions handoff as the chip below */
              <div className="fv where go" {...clickable(goHero)} title={t("findus.directions")}>
                {whereStreet}
                {whereLoc && <span className="where-loc">{whereLoc}</span>}
              </div>
            ) : (
              <EditableCopy k="findus.loc_tba" value={t("findus.loc_tba")} as="div" className="fv where tba" />
            )}
          </div>
        )}
        {/* Day stays Day even when live — the masthead eyebrow + pulse dot already announce
            "Live now"; a Status:Live cell here said it twice and hid the date to do it
            (2026-07-30 redundancy audit). The "Soon" fallback shares a slot with the live day
            value, so it's plain t() (dynamically-selected slot), not inline. */}
        <div className="f"><EditableCopy k="findus.fact_day" value={t("findus.fact_day")} as="div" className="fk" /><div className="fv">{heroWhen || t("findus.day_tba")}</div></div>
        {/* The third label is chosen dynamically (Starts / Hours / Open) → plain t() per slot. */}
        <div className="f"><div className="fk">{hero?.kind === "event" ? t("findus.fact_starts") : heroClose ? t("findus.fact_hours") : t("findus.fact_open")}</div><div className="fv">{heroClose ? `${heroOpen || "—"} – ${heroClose}` : heroOpen || "—"}</div></div>
        {hero?.kind === "event" && hero.going_count != null && hero.going_count > 0 && (
          <div className="f"><EditableCopy k="findus.fact_going" value={t("findus.fact_going")} as="div" className="fk" /><div className="fv">{hero.going_count}</div></div>
        )}
      </div>

      {/* ONE red action per screen. While cups can be ordered it is the pre-order; with nothing to
          pre-order it says what it does — the menu — and the line under it says when cups open. In
          the stop's last hour, ordering online is over and we say so instead (lib/ordering). The
          line is always there, one line tall, so the answer arriving moves nothing on the page. */}
      {ordering?.state === "closing"
        ? <EditableCopy k="findus.cta_closed" value={t("findus.cta_closed")} as="p" className="k-sub" style={{ marginTop: 4 }} multiline />
        : <>
            <button type="button" className="btn-pri k-cta" onClick={() => router.push("/menu")}>{t(ordering && !ordering.open ? "findus.cta_menu" : "findus.cta_preorder")}</button>
            <p className="k-sub fu-state" role="status">{ordering ? (ordering.open ? readyWords(ordering) : closedWords(ordering, { named: false })) : " "}</p>
          </>}

      {/* Quiet chip row — never a second red CTA. Get directions is the hero's one-tap "take me
          there": native turn-by-turn off the pin when the stop is geocoded, else a maps handoff on
          the plain address text — so it works the day a stop is created, before anyone pins it.
          Identical for stops and events. LivePing is the push opt-in (0257). */}
      <div className="fu-chips">
        {hero && (heroHasCoords || heroWhere) && (
          <button type="button" className="fu-dir" onClick={() => { if (heroHasCoords) openDirections(hero.lat as number, hero.lng as number); else if (heroWhere) openAddress(heroWhere); }}>
            <Icon name="pin" /> {t("findus.directions")}
          </button>
        )}
        <LivePingButton />
      </div>

      <SectionHeader label={<EditableCopy k="findus.road_title" value={t("findus.road_title")} />} annotation={<EditableCopy k="findus.road_note" value={t("findus.road_note")} />} />
      {/* emptyTitle/emptySub are typed string (AsyncSection), so plain t() here — not EditableCopy. */}
      <AsyncSection state={board} isEmpty={() => upcoming.length === 0} emptyTitle={t("findus.road_empty_title")} emptySub={t("findus.road_empty_sub")} errorTitle="Couldn't load the schedule" loadingLabel="Loading the schedule…">
        {() => (
          <>
            <div className="k-rows">
              {/* The hero's own row stays IN the list (2026-08-01) — hero events always did, hero
                  stops were deduped out, which made the next stop's notes + directions the ONE
                  set of details you couldn't reach. Both kinds keep their row now, same rule. */}
              {upcoming.map((r) => {
                if (r.kind === "event") return <RsvpRow key={r.id} ev={toEventRow(r)} />;
                const rowLive = isLive && r.id === live?.current_stop_id;
                const isOpen = openStop === r.id;
                return (
                  <div key={r.id}>
                    <InfoRow
                      lead={whenDay(r)}
                      leadSub={whenDate(r)}
                      name={r.name}
                      sub={descFor(r, t, avail).text}
                      /* Time rides in the meta line — the same slot and lowercase format as the
                         event rows' evTime. It used to sit inside the lead stamp, where the
                         stamp's CSS uppercased it: "8/1 7AM" beside an event's "6:00pm" — two
                         conventions on one list (2026-07-30). Lead = day + date only, both kinds. */
                      meta={whenTime(r) || undefined}
                      live={rowLive}
                      trailing={<span className={`k-caret${isOpen ? " open" : ""}`} aria-hidden="true">›</span>}
                      onClick={() => setOpenStop(isOpen ? null : r.id)}
                      ariaLabel={`${r.name}, ${rowLive ? "live now" : "upcoming"} — details`}
                      expanded={isOpen}
                    />
                    {isOpen && (
                      <div className="k-detail">
                        {/* Where — the same pin-link the event rows carry (RsvpRow), stop/event parity */}
                        {(r.location_text || r.address) && (
                          <div className="k-det-row"><span className="k-det-k">Where</span>
                            <a href={`https://maps.google.com/?q=${encodeURIComponent((r.location_text ?? r.address) as string)}`} target="_blank" rel="noreferrer"><Icon name="pin" /> {r.location_text ?? r.address}</a>
                          </div>
                        )}
                        <p>{(r.notes ?? r.note) ?? <EditableCopy k="truck.stop_note" value={t("truck.stop_note")} as="span" />}</p>
                        {/* the same rule as the red button: no Pre-order chip in the live stop's last hour */}
                        {rowLive && ordering?.open !== false && <button type="button" className="k-chip hit-y-44 pri" onClick={() => router.push("/menu")}>{t("findus.preorder")}</button>}
                        {/* directions works ungecoded too — coords when pinned, else maps handoff on the address text */}
                        {(r.lat != null && r.lng != null) ? (
                          <button type="button" className="k-chip hit-y-44 k-chip-sec" style={rowLive && ordering?.open !== false ? { marginLeft: 8 } : undefined} onClick={() => openDirections(r.lat as number, r.lng as number)}>{t("findus.directions")}</button>
                        ) : (r.location_text || r.address) ? (
                          <button type="button" className="k-chip hit-y-44 k-chip-sec" style={rowLive && ordering?.open !== false ? { marginLeft: 8 } : undefined} onClick={() => openAddress((r.location_text ?? r.address) as string)}>{t("findus.directions")}</button>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {past.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <button type="button" className="btn-ter" onClick={() => setShowPast((s) => !s)} aria-expanded={showPast}>
                  {t("findus.past_events")} · {past.length} <span className={`k-caret${showPast ? " open" : ""}`}>›</span>
                </button>
                {showPast && <div className="k-rows">{past.map((r) => <RsvpRow key={r.id} ev={toEventRow(r)} />)}</div>}
              </div>
            )}

            {/* One pinned stop is a map too (2026-08-01) — RouteMap already frames a single point
                with street context (fitBounds maxZoom cap); requiring 2+ left a one-stop week with
                no map at all, exactly when a new customer most needs the pin. */}
            {points.length >= 1 && (
              <>
                <SectionHeader label={<EditableCopy k="findus.circuit_title" value={t("findus.circuit_title")} />} annotation={<EditableCopy k="findus.circuit_note" value={t("findus.circuit_note")} />} />
                <RouteMap points={points} truck={truckPos} />
              </>
            )}
          </>
        )}
      </AsyncSection>

      <FindUsCoda />
      </Fragment>)}
    </section>
  );
}

// The stand-in for the page while the road is read: the hero's shape (title, a line, the facts,
// the button) and two rows of the road, in the house shimmer. Busy for assistive tech, which hears
// one sentence instead of a pile of empty shapes.
function FindUsSkeleton() {
  return (
    <>
      <div className="fu-skel" aria-busy="true">
        <h1 className="k-title lg">…</h1>
        <Skeleton variant="line" />
        <Skeleton variant="card" />
        <Skeleton variant="row" count={3} />
      </div>
      <FindUsCoda />
    </>
  );
}

// The page's close — booking the bar, the craft link, the sign-off. Nothing in it depends on the
// road, so it is drawn on the server and under the skeleton too; it is rendered in both halves of
// the swap rather than outside them, because anything outside would be pushed down when the road
// lands — the thing this swap exists to stop.
function FindUsCoda() {
  const router = useRouter();
  const t = useSiteCopy();
  return (
    <>
      <SectionHeader label={<EditableCopy k="findus.byo_title" value={t("findus.byo_title")} />} annotation={<EditableCopy k="findus.byo_note" value={t("findus.byo_note")} />} />
      <EditableCopy k="findus.byo_pitch" value={t("findus.byo_pitch")} as="p" style={{ fontSize: 15, color: "var(--cream-m)", margin: "14px 2px 12px" }} multiline />
      <button type="button" className="btn-ter" onClick={() => router.push("/book")}>
        {t("findus.book_cta")} <b><Icon name="arrowRight" /></b>
      </button>

      {/* Placement #2 of the craft-education audit (2026-07-27): this IS the guest home page (see
          the redirect in app/page.tsx), but its one job is "where/when" — so one quiet line at the
          very bottom, not a pitch. Plain text, not EditableCopy: same nested-interactive rule as
          the button above it. */}
      <button type="button" className="btn-ter" onClick={() => router.push("/craft")}>
        {t("truck.craft_link")} <b><Icon name="arrowRight" /></b>
      </button>

      <ClosingBeat />
    </>
  );
}

// "Ping me when the truck goes live" — the public opt-in for the go-live push (0257). Renders
// only where background push can actually work (needs PushManager: installed PWA or desktop —
// an iOS Safari TAB has no PushManager, so the chip simply doesn't appear there rather than
// dead-ending someone). Signed-in visitors keep their user_id/is_admin on the row (the same
// upsert Checkout/ProfileSheet use — wants_live is one more preference on the device row, not a
// second subscription). Anon subscribers can't read their row back (RLS is owner/admin-only),
// so the chip's on/off label rides localStorage — a courtesy memory, not an audit.
function LivePingButton() {
  const { user, profile } = useAuth();
  const t = useSiteCopy();
  // Known on the first render, not one after it (2026-10-04): the chip arrived a frame late and
  // wrapped the chip row onto a second line under everything already drawn — the last 0.018 of the
  // page's layout shift. This mounts only in the browser now (FindUs draws its skeleton on the
  // server and until the road is read), so there is a window to ask.
  const [state, setState] = useState<"hidden" | "off" | "on" | "busy">(() => {
    if (!(typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined")) return "hidden";
    try { return localStorage.getItem("gt3-live-ping") === "1" ? "on" : "off"; } catch { return "off"; }
  });
  const toggle = async () => {
    if (state === "busy" || state === "hidden") return;
    const turningOn = state === "off";
    setState("busy");
    try {
      if (turningOn) {
        const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
        if (p !== "granted") { setState("off"); return; }
      }
      await subscribePush(user?.id ?? null, !!profile?.is_admin, { wantsLive: turningOn });
      try { localStorage.setItem("gt3-live-ping", turningOn ? "1" : "0"); } catch { /* ignore */ }
      setState(turningOn ? "on" : "off");
    } catch {
      setState(turningOn ? "off" : "on");
    }
  };
  if (state === "hidden") return null;
  return (
    <button type="button" className={`fu-ping hit-y-44${state === "on" ? " on" : ""}`} onClick={toggle} aria-pressed={state === "on"} disabled={state === "busy"}>
      <Icon name="bell" /> {state === "busy" ? "One sec…" : state === "on" ? t("findus.ping_on") : t("findus.ping_off")}
    </button>
  );
}
