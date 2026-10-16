"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";
import AccountPill from "@/components/AccountPill";
import EditCopyPill from "@/components/EditCopyPill";
import EditableCopy from "@/components/EditableCopy";
import { Masthead, SectionHeader, InfoRow, ClosingBeat } from "@/components/kit";
import { RsvpRow } from "@/components/RsvpRow";
import { openDirections, openAddress, openStop as goToStop, mapStreet, directionsTo } from "@/lib/maps";
import { supabase } from "@/lib/supabase";
import { useSiteCopy } from "@/lib/copy";
import { marketsPresent, rowInMarket, shouldOfferMarketChoice, MARKET_LABEL } from "@/lib/markets";
import { useViewerMarket } from "@/components/useViewerMarket";
import { useOrderingOpen } from "@/components/useOrderingOpen";
import { closedWords, liveSwitchOn, readyWords, type NamedStop } from "@/lib/ordering";
import { useCupAvailability } from "@/components/useCupAvailability";
import { etToday, etRelativeDay, etWallMs, fmt12, clockTime, etDayKey, weekdayOf } from "@/lib/dates";
import { isStopAhead } from "@/lib/road";
import { canceledLine } from "@/lib/stopLine";   // the line alone: the texts and the crew's words stay out of Find Us
import { clickable } from "@/lib/a11y";
import type { LiveStatus, EventRow } from "@/lib/db";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Icon from "@/components/Icon";
import { useLivePing } from "@/components/useLivePing";
import Skeleton from "@/components/Skeleton";
import { apiUrl } from "@/lib/native";

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
// `named`: the stop the live switch names, as its own row (C1) — see fetchRoad.
type Named = NamedStop & { market?: string | null };
// A stop called off (0391): archived, so off the road, and said here in its place until it would have been over.
type Canceled = { id: string; name: string | null; starts_at: string | null; ends_at: string | null; cancel_reason: string | null; market?: string | null };
type Board = { ops: FieldOp[]; live: LiveStatus | null; named?: Named | null; canceled?: Canceled[] };
const NO_OPS: FieldOp[] = [];

// ── stop label helpers (from the truck page — hand-set labels win, else derive) ─────────────────
// The day, the date and both hours of a stop are read on the truck's clock (Eastern), never the
// phone's: a stop has one real time, where the truck is. The opening hour was pinned in lib/dates'
// clockTime; the day, the date and the closing hour still read the phone's zone, so a stop open
// 11-5 read "11:00am – 9:00pm" to anyone outside Eastern (caught 2026-10-10 taking the App Store
// shot of Find Us on a machine set to UTC).
const etKeyOf = (iso: string) => etDayKey(new Date(iso));
function whenDay(s: FieldOp): string {
  if (s.when_label?.trim()) return s.when_label;
  if (s.starts_at) return weekdayOf(etKeyOf(s.starts_at), "short").toUpperCase();
  if (s.day) return weekdayOf(s.day, "short").toUpperCase();
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
  const key = s.starts_at ? etKeyOf(s.starts_at) : s.day;
  if (!key) return "";
  const [, m, d] = key.slice(0, 10).split("-").map(Number);
  return m && d ? `${m}/${d}` : "";
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
  // Its day and time are the truck's, Eastern — not the phone's zone (R7), so it sorts among the stops' instants truly.
  return etWallMs(r.day, t ? `${String(t[1]).padStart(2, "0")}:${t[2]}` : "12:00");
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
  const [{ data: fo, error: e1 }, { data: l, error: e2 }, { data: cx }] = await Promise.all([
    supabase!.from("field_ops").select("id, kind, name, public_title, day, starts_at, ends_at, start_time, end_time, day_label, when_label, time_label, location_text, address, lat, lng, member_only, going_count, capacity, blurb, menu_tier, notes, note, status, completed_at, archived_at, is_public, published_at, market").eq("is_public", true),
    // Named columns, never * (R6): this page is read signed out, and the switch and its stop are all it needs.
    supabase!.from("live_status").select("id, is_live, current_stop_id").maybeSingle(),
    // Called off lately or ahead (0391; stops are public). An error — 0391 not pasted yet — is no canceled stops,
    // never a page that cannot load.
    // arrives-with: 0391 — until it is pasted this read errors on its own, is not checked, and the road reads as before.
    supabase!.from("stops").select("id, name, starts_at, ends_at, cancel_reason, market").not("canceled_at", "is", null)
      .gte("starts_at", new Date(Date.now() - 36 * 3600 * 1000).toISOString()).order("starts_at", { ascending: true }).limit(5),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  const lstat = l as LiveStatus | null;
  const raw = (fo as FieldOp[]) ?? [];
  // THE STOP THE SWITCH NAMES (C1, 2026-10-12): its own row, closed out or not — this read has every public stop,
  // archived ones included; one that isn't public is read by id. lib/ordering's liveSwitchOn, the rule the order button
  // asks, says whether the switch is still a truck pouring — and only then is that stop on the road "however late it
  // runs" (lib/road). A switch left on at a stop archived outside Live Ops kept this page saying Live, with nobody there.
  const pointed = lstat?.is_live ? lstat.current_stop_id : null;
  let named: Named | null = pointed ? raw.find((r) => r.id === pointed && r.kind === "stop") ?? null : null;
  if (pointed && !named) {
    const { data: s, error: e3 } = await supabase!.from("stops").select("starts_at, ends_at, archived_at, status, completed_at, market").eq("id", pointed).maybeSingle();
    if (e3) throw new Error(e3.message);
    named = (s as Named | null) ?? null;
  }
  const liveId = liveSwitchOn(Date.now(), !!lstat?.is_live, pointed, named) ? pointed : null;
  // the road AHEAD: hide completed/past (8h grace for stops through their evening; events
  // stay through their whole day) — the live stop always shows. Publish gate (0270): RLS already
  // hides unpublished events from guests; this mirrors it client-side so a STAFF preview of Find Us
  // shows exactly what a guest sees. Stops are always public; an event needs published_at.
  // A stop's half of that is lib/stopRecord's isStopAhead — the same rule the crew's Live truck
  // instrument reads, so "next stop" cannot mean one thing to a guest and another to the crew
  // (2026-10-04: this page said "Nothing scheduled yet" while the instrument offered Go live).
  const ops = raw
    .filter((r) => (r.kind === "stop" || r.published_at))
    .map((r) => (r.public_title ? { ...r, name: r.public_title } : r))   // guest-facing name wins on the public road
    .filter((r) => r.kind === "stop"
      ? isStopAhead(r, liveId)
      : r.status !== "done" && !r.completed_at)
    .sort((a, b) => sortKey(a) - sortKey(b));
  return { ops, live: lstat, named, canceled: (cx as Canceled[] | null) ?? [] };
}

export default function FindUs() {
  const router = useRouter();
  const t = useSiteCopy();
  const avail = useCupAvailability();
  const [openStop, setOpenStop] = useState<string | null>(null);

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
    // covers the whole road. live_status rides along for the hero.
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

  // The truck's day (Eastern), not the phone's (R3, 2026-10-13): an event's day is the day it happens where it happens.
  const today = etToday();
  // A stop can carry a close time (stops.ends_at). Two automatic wind-downs hang off it, so the
  // operator never has to remember to flip anything at the end of service:
  //   • online pre-ordering closes 60 min before that close time (stop taking orders you can't fill
  //     before packing up) — lib/ordering's rule now (2026-10-04), because it was true ONLY on this
  //     page: the menu, checkout and /api/checkout went on taking orders through the last hour; and
  //   • the truck stops reading "Live" 45 min before it — this page's own display rule.
  // Ordering closes FIRST, then the truck goes offline — never the reverse. No close time set →
  // both wait for lib/road's 8 hours from the start (C1, 2026-10-12: before, the switch stood for as
  // long as it was left on). Both are computed at render (re-evaluated on the poll), so no cron has
  // to write a flag on the tick.
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
  // IS THE SWITCH A TRUCK POURING HERE (C1): the order button's rule — a switch whose stop is closed out, ended, or
  // another city's is not this city's truck — then this page's own wind-down, 45 minutes before a close time.
  const named = road?.named ?? null;
  const switchOn = liveSwitchOn(nowMs, Boolean(live?.is_live), live?.current_stop_id ?? null, named && rowInMarket(named, viewerMarket) ? named : null);
  const isLive = switchOn && (liveEndsMs == null || nowMs < liveEndsMs - LIVE_OFF_BEFORE_MS);
  // CAN A CUP BE ORDERED — the rule the menu, the drink sheet, checkout and the server ask
  // (lib/ordering). This page used to ask nothing: "PRE-ORDER · SKIP THE LINE" with no stop on the
  // schedule, into a menu whose every drink said the truck was closed. Until the read lands it
  // claims nothing either way (the button it always had, an empty line under it).
  const ordering = useOrderingOpen(true, viewerMarket, `${live?.is_live ?? ""}|${live?.current_stop_id ?? ""}|${roadOps.map((r) => `${r.id}${r.starts_at ?? ""}${r.ends_at ?? ""}`).join()}`).ordering;
  // NO PAST EVENTS (2026-10-10, Ryan: "why the need for past events?"). An event nobody marked done stayed on the
  // public road, and this page folded them under "Past events · 2" — each with a live "I'm in", an RSVP to 7/31 and
  // 8/15. Find Us answers where the truck is and will be; what is over is not on it.
  const upcoming = roadOps.filter((r) => r.kind === "stop" || !r.day || r.day >= today);
  // A STOP UNDER WAY THAT NOBODY FLIPPED LIVE (R7): cup orders are taken for it, made now — lib/ordering's "started",
  // the missed-toggle grace — and Today and checkout said so while this page said "Next stop". It is on now here too.
  const startedId = ordering?.state === "started" ? ordering.stop?.id ?? null : null;
  const liveId = isLive ? live?.current_stop_id ?? null : startedId;
  const onNow = isLive || !!startedId;
  // PACKING UP, SAID AS THAT (R7b): in a stop's last hour the order button is closed (lib/ordering "closing") and the
  // truck is still there. This page said "Next stop" over the stop the truck was at, while Today said Packing up.
  const closingId = !onNow && ordering?.state === "closing" ? ordering.stop?.id ?? null : null;
  // the hero is the next PLACE TO FIND US — the stop on now first, else first upcoming stop or event
  const hero = (liveId && upcoming.find((r) => r.id === liveId)) || (closingId && upcoming.find((r) => r.id === closingId)) || upcoming[0];
  const packingUp = !!closingId && hero?.id === closingId;
  // A CANCELED STOP SAYS SO (H5, 0391): the soonest one called off that would still be on before this page's next
  // stop — not over yet, and starting no later — is said above it, with the reason. It was a row that vanished.
  const heroStartMs = hero?.starts_at ? Date.parse(hero.starts_at) : Number.POSITIVE_INFINITY;
  // FOR ITS DAY (R3, 2026-10-13): one with no close time went at its start — a 7am stop called off was gone by 7:01,
  // before anyone driving to it looked. It stays until its day is over, Eastern; the read keeps a day and a half of them.
  const canceledNext = (road?.canceled ?? []).find((c) => rowInMarket(c, viewerMarket) && !!c.starts_at
    && etDayKey(new Date(c.starts_at)) >= etDayKey(new Date(nowMs)) && Date.parse(c.starts_at) <= heroStartMs) ?? null;
  // THE ROAD STARTS AFTER THE HERO (2026-10-10, round 2: "the next stop is listed twice"). The hero
  // is the next stop — its name, its line (the stop's own note first, descFor), where, when, the menu
  // and directions — and its row under "On the road" said all of it again, one screen down. A hero
  // stop is not listed twice now. A hero EVENT keeps its row: the RSVP lives on it, and the hero has none.
  const rest = hero?.kind === "stop" ? upcoming.filter((r) => r.id !== hero.id) : upcoming;
  // With nothing after the hero, "On the road" would be a heading over nothing.
  const showRoad = board.status === "error" || upcoming.length === 0 || rest.length > 0;
  // Humanize the hero's "when" (the one "where's the truck next" answer): relativeDay returns an
  // unambiguous near-term qualifier — "Today" / "This Sat" — which we pair with the numeric date for
  // clarity ("This Sat · 7/18"). Anything a week or more out (or with no date) keeps the original
  // absolute weekday + M/D — no "Next {wd}", which misread a 12-day-out Friday as the wrong Friday.
  const heroRel = hero ? etRelativeDay(hero.starts_at ?? hero.day ?? "") : "";
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
    ? (hero.ends_at ? fmt12(clockTime(hero.ends_at)) ?? "" : "")
    : (fmt12(hero.end_time) ?? "");
  // ONE WHEN (2026-10-10, Find Us 10): the day and the hours were two cells a third of the row wide each — "Tomorrow ·
  // 10/11" over two lines beside "11:00am – / 2:00pm" over two more. One row says both now. On a phone it can still take
  // two lines (production at 402 wide broke it "…11:00am –" / "2:00pm"), so the hours keep together and the break, when
  // there is one, falls before them: "Tomorrow · 10/11 ·" / "11:00am – 2:00pm".
  const heroHours = heroClose ? `${heroOpen || "—"} – ${heroClose}` : heroOpen;
  const heroDay = heroWhen || t("findus.day_tba");
  // Only the hero copy (below) is a safe EditableCopy target — see the comment on descFor.
  const heroDesc = hero?.kind === "stop" ? descFor(hero, t, avail) : null;
  // THE WHERE (2026-08-01, Ryan's 4/10 audit: "how would a client know where the truck is?").
  // One derivation feeds the hero's Where cell + its Get-directions chip, identically for stops
  // and events (the spine carries location_text/address/lat/lng for both kinds). Nothing set →
  // the cell says "Location TBA" honestly and the chip simply doesn't render.
  const heroWhere = hero ? ((hero.location_text?.trim() || hero.address?.trim()) || null) : null;
  const heroHasCoords = hero?.lat != null && hero?.lng != null;
  // A stop saved without a pin is still mapped where Apple finds its street (lib/maps mapStreet, app/api/map).
  const heroStreet = hero && !heroHasCoords ? mapStreet(hero) : null;
  // The truck on the map breathes only while it is pouring at this stop.
  const heroLive = !!liveId && hero?.id === liveId;
  // Ryan's polish pass ("is it giving 10/10 CSS?"): a raw one-string address wraps wherever it
  // runs out of column — "…Simpsonville, SC / 29681" with an orphaned ZIP. Split it into a
  // DELIBERATE two-line lockup instead: street as the value, city/state as a quiet support line,
  // ZIP off the display entirely (noise to a human; directions still get the full string). A
  // place name with no comma stays one line untouched.
  const whereParts = (heroWhere ?? "").split(/,\s*/);
  const whereLoc = whereParts.length >= 2 ? whereParts.slice(1).join(", ").replace(/\s+\d{5}(?:-\d{4})?\s*$/, "").trim() : "";
  const whereStreet = whereLoc ? whereParts[0] : heroWhere;
  // Directions go to the street first — the place's name is the map's guess (R7, lib/maps directionsTo).
  const heroTo = hero ? directionsTo(hero) : null;
  const goHero = () => { if (heroHasCoords) openDirections(hero!.lat as number, hero!.lng as number); else if (heroTo) openAddress(heroTo); };

  return (
    <section className="screen truck" id="s-find">
      <Masthead
        eyebrow={onNow ? t("findus.eyebrow_live") : packingUp ? "Packing up" : hero?.kind === "event" ? t("findus.eyebrow_event") : t("findus.eyebrow_stop")}
        live={onNow}
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
            <button key={m} type="button" className={`k-chip${m === viewerMarket ? " on" : ""}`}
              aria-pressed={m === viewerMarket} onClick={() => chooseMarket(m)}>
              {MARKET_LABEL[m]}
            </button>
          ))}
        </div>
      )}

      {canceledNext && <p className="k-sub" role="status"><span className="k-tag crit">Canceled</span> {canceledLine(canceledNext)}</p>}
      <h1 className="k-title lg">{hero?.name ?? (board.status === "error" ? "Couldn't load" : board.status === "ready" ? t("findus.no_stops") : "…")}</h1>
      {hero && (
        <p className="k-sub">
          {heroDesc
            ? (heroDesc.key ? <EditableCopy k={heroDesc.key} value={heroDesc.text} as="span" /> : heroDesc.text)
            : (hero.blurb ?? "")   /* the address left this slot for its own Where cell below — no more double-print */}
        </p>
      )}

      {/* THE PLACE, SEEN (2026-10-10, Find Us 10). A page called Find Us had no map since CARTO's tiles began asking for
          a key (the map went the same morning). Apple's picture of the stop's own place now (app/api/map): tap it for
          directions, as the address below. Drawn for a stop with a pin, or with a street Apple can find (lib/maps
          mapStreet — Saturday's stop was saved with no pin, and had no map); if the picture does not come, it is not drawn. */}
      {hero && (heroHasCoords || heroStreet) && (
        <StopMap key={hero.id} id={hero.id} at={heroHasCoords ? `${(hero.lat as number).toFixed(5)},${(hero.lng as number).toFixed(5)}` : `a:${heroStreet}`}
          label={heroWhere ?? hero.name} live={heroLive} onGo={goHero} />
      )}

      <div className="k-facts">
        {/* WHERE leads — it's the page's primary question and it was the one fact this row never
            answered (2026-08-01 audit). Same row for stops and events, the whole width now (Find Us 10): the
            street wrapped to four lines in a third of the row. */}
        {hero && (
          <div className="f"><EditableCopy k="findus.fact_where" value={t("findus.fact_where")} as="div" className="fk" />
            {heroWhere ? (
              /* the address IS the tap target too — same directions handoff as the chip below. One line of street and
                 one of town measure 41 tall in the full-width row (production, 2026-10-10), so the tap reaches up and
                 down to 44 (hit-y-44) and the row's look stays as it is. */
              <div className="fv where go hit-y-44" {...clickable(goHero)} title={t("findus.directions")}>
                {whereStreet}
                {whereLoc && <span className="where-loc">{whereLoc}</span>}
              </div>
            ) : (
              <EditableCopy k="findus.loc_tba" value={t("findus.loc_tba")} as="div" className="fv where tba" />
            )}
          </div>
        )}
        {/* When — the day stays the day even when live (the masthead's eyebrow and dot say "Live now"; a Status cell
            said it twice, 2026-07-30), and the hours ride on its line, kept together (heroHours). */}
        <div className="f"><EditableCopy k="findus.fact_when" value={t("findus.fact_when")} as="div" className="fk" /><div className="fv">{heroDay}{heroHours && <> · <span className="whitespace-nowrap">{heroHours}</span></>}</div></div>
        {hero?.kind === "event" && hero.going_count != null && hero.going_count > 0 && (
          <div className="f"><EditableCopy k="findus.fact_going" value={t("findus.fact_going")} as="div" className="fk" /><div className="fv">{hero.going_count}</div></div>
        )}
      </div>

      {/* ONE red action per screen. While cups can be ordered it is the pre-order; with nothing to
          pre-order it says what it does — the menu — and the line under it says when cups open. In
          the stop's last hour, ordering online is over and we say so instead (lib/ordering). The
          line is always there, one line tall, so the answer arriving moves nothing on the page. The line names its stop
          when it is not the one above it (R3, 2026-10-13): "cup orders open at 4:00pm" sat under an event, or under an
          ended stop, about a place it did not name. */}
      {ordering?.state === "closing"
        ? <EditableCopy k="findus.cta_closed" value={t("findus.cta_closed")} as="p" className="k-sub" style={{ marginTop: 4 }} multiline />
        : <>
            {/* Pre-order only once the read says cups can be ordered (R7): before it, and when it fails, the menu — a claim
                is made once it is true. Open for a stop other than the one above, the line names it. */}
            <button type="button" className="btn-pri btn-wide k-cta" onClick={() => router.push("/menu")}>{t(ordering?.open ? "findus.cta_preorder" : "findus.cta_menu")}</button>
            <p className="k-sub fu-state" role="status">{ordering ? (ordering.open
              ? `${ordering.stop?.name && ordering.stop.id !== hero?.id ? `At ${ordering.stop.name}: ` : ""}${readyWords(ordering)}`
              : closedWords(ordering, { named: !!ordering.stop && ordering.stop.id !== hero?.id })) : " "}</p>
          </>}

      {/* Quiet chip row — never a second red CTA. Get directions is the hero's one-tap "take me
          there": native turn-by-turn off the pin when the stop is geocoded, else a maps handoff on
          the plain address text — so it works the day a stop is created, before anyone pins it.
          Identical for stops and events. LivePing is the push opt-in (0257). */}
      <div className="fu-chips">
        {hero && (heroHasCoords || heroWhere) && (
          <button type="button" className="k-chip mt-2.5" onClick={() => { if (heroHasCoords) openDirections(hero.lat as number, hero.lng as number); else if (heroTo) openAddress(heroTo); }}>
            <Icon name="pin" /> {t("findus.directions")}
          </button>
        )}
        <LivePingButton />
      </div>

      {showRoad && <>
      <SectionHeader label={<EditableCopy k="findus.road_title" value={t("findus.road_title")} />} annotation={<EditableCopy k="findus.road_note" value={t("findus.road_note")} />} />
      {/* emptyTitle/emptySub are typed string (AsyncSection), so plain t() here — not EditableCopy. */}
      <AsyncSection state={board} isEmpty={() => upcoming.length === 0} emptyTitle={t("findus.road_empty_title")} emptySub={t("findus.road_empty_sub")} errorTitle="Couldn't load the schedule" loadingLabel="Loading the schedule…">
        {() => (
          <>
            {rest.length > 0 && <div className="k-rows">
              {rest.map((r) => {
                if (r.kind === "event") return <RsvpRow key={r.id} ev={toEventRow(r)} />;
                const rowLive = !!liveId && r.id === liveId;
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
                            <a href={`https://maps.google.com/?q=${encodeURIComponent((r.address ?? r.location_text) as string)}`} target="_blank" rel="noreferrer"
                              onClick={(e) => { e.preventDefault(); goToStop({ lat: r.lat, lng: r.lng, to: r.address ?? r.location_text }); }}><Icon name="pin" /> {r.location_text ?? r.address}</a>
                          </div>
                        )}
                        <p>{(r.notes ?? r.note) ?? <EditableCopy k="truck.stop_note" value={t("truck.stop_note")} as="span" />}</p>
                        {/* the same rule as the red button: no Pre-order chip in the live stop's last hour */}
                        {rowLive && ordering?.open !== false && <button type="button" className="k-chip pri" onClick={() => router.push("/menu")}>{t("findus.preorder")}</button>}
                        {/* directions works ungecoded too — coords when pinned, else maps handoff on the address text */}
                        {(r.lat != null && r.lng != null) ? (
                          <button type="button" className={`k-chip${rowLive && ordering?.open !== false ? " ml-2" : ""}`} onClick={() => openDirections(r.lat as number, r.lng as number)}>{t("findus.directions")}</button>
                        ) : (r.location_text || r.address) ? (
                          <button type="button" className={`k-chip${rowLive && ordering?.open !== false ? " ml-2" : ""}`} onClick={() => goToStop({ lat: r.lat, lng: r.lng, to: r.address ?? r.location_text })}>{t("findus.directions")}</button>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>}

          </>
        )}
      </AsyncSection>
      </>}

      <FindUsCoda />
      </Fragment>)}
    </section>
  );
}

// THE MAP CARD (Find Us 10): Apple's picture of the stop's place (app/api/map, lib/appleMaps snapshot), its box held at
// 2:1 before the picture arrives so nothing below it moves; the picture's address carries the place (`v`: the pin, or the
// street of a stop saved without one), so a moved stop is a new picture and the CDN's copy of the old one is never shown
// for it. The whole card is the directions button. A picture that does not come (no Maps key, Apple down, a street Apple
// cannot find) takes the card away instead of drawing a hole.
// THE BOTTLE IS THE PIN (2026-10-13, Ryan: "Use the gt3 bottle with the nails as pin picture"; before it, from 2026-10-12,
// the trailer's back door from his Topgolf photo). Apple drew a red pin with a 3. Apple draws the place alone now
// (pin=none), and the pin is a GT3 BREW bottle held up in a hand with painted nails, from Ryan's photo at the truck
// (public/brand/bottle-pin.jpg — a photo, not a mark redrawn), in a cream ring with a point.
// Apple's picture is centred on the stop, so the point sits on the card's centre. While the truck is pouring there the
// ring and point turn the live green, and a ring breathes around it — the live dot's own pulse (lv); with reduced motion
// the pulse holds still and the green still says it.
function StopMap({ id, at, label, live, onGo }: { id: string; at: string; label: string; live: boolean; onGo: () => void }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <button type="button" onClick={onGo} aria-label={`Map of ${label}${live ? ", where the truck is now" : ""} — get directions`}
      className="relative block w-full mt-4 p-0 overflow-hidden rounded-2xl border border-line bg-well aspect-[2/1] cursor-pointer appearance-none">
      {/* eslint-disable-next-line @next/next/no-img-element -- an API image, not a static asset; next/image cannot export */}
      <img src={apiUrl(`/api/map?stop=${encodeURIComponent(id)}&pin=none&v=${encodeURIComponent(at)}`)} alt="" width={600} height={300}
        decoding="async" className="block w-full h-full object-cover" onError={() => setGone(true)} />
      <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-full flex-col items-center">
        <span className={`relative z-1 block size-13 rounded-full p-0.75 shadow-raised ${live ? "bg-ok" : "bg-cream"}`}>
          {live && <span className="absolute inset-0 rounded-full animate-[lv_2s_ease-out_infinite] motion-reduce:animate-none" />}
          {/* eslint-disable-next-line @next/next/no-img-element -- a photo in public/brand; next/image cannot export */}
          <img src="/brand/bottle-pin.jpg" alt="" width={46} height={46} decoding="async" draggable={false} className="relative block size-full rounded-full object-cover" />
        </span>
        <span className={`-mt-2 block size-3 rotate-45 ${live ? "bg-ok" : "bg-cream"}`} />
      </span>
    </button>
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
      {/* One place to go (2026-10-10, Find Us 10): booking the bar. The craft link ("What's really in the cup") stood
          under it since the craft-education audit (2026-07-27); the menu carries its own (menu.craft_link), where the
          cup is, and Find Us keeps to where and when. Plain text, not EditableCopy: the nested-interactive rule. */}
      <button type="button" className="btn-ter" onClick={() => router.push("/book")}>
        {t("findus.book_cta")} <b><Icon name="arrowRight" /></b>
      </button>

      <ClosingBeat />
    </>
  );
}

// "Ping me when the truck goes live" — the public opt-in for the go-live push (0257), as a chip. Its state and its
// device row are components/useLivePing's, shared with the account's Notifications screen (R6), which draws it as a
// switch; it renders only where background push can actually work.
function LivePingButton() {
  const t = useSiteCopy();
  const { state, toggle } = useLivePing();
  if (state === "hidden") return null;
  return (
    <button type="button" className={`k-chip mt-2.5${state === "on" ? " on" : ""}`} onClick={toggle} aria-pressed={state === "on"} disabled={state === "busy"}>
      <Icon name="bell" /> {state === "busy" ? "One sec…" : state === "on" ? t("findus.ping_on") : t("findus.ping_off")}
    </button>
  );
}
