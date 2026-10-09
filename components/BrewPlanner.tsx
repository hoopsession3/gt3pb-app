"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { FLAVORS } from "@/lib/orderAhead";
import { bottlesFor, gallonsForBottles, brewStartOverdue, sizingOptions, primarySizing, gallonsFromIngredient, ingredientForGallons, stepDownGal, stepUpGal, vesselFit, smallestBatch, pourable, scaleIngredients, vesselPlan, cookQuantity, SERVE_OZ, BREW_STEP_GAL, batchIsOver, isCoffee } from "@/lib/brewMath";
import { localToday } from "@/lib/dates";
import { coffeeGrams, defaultLot, lotLabel, lotUse, type BrewLot, type LotUse, type LotValue } from "@/lib/brewLots";
import { MARKET_LABEL, isMarket } from "@/lib/markets";
import CoffeeLotPick from "@/components/CoffeeLotPick";
import AssignTaskSheet from "@/components/AssignTaskSheet";
import Sheet, { CloseButton, LeaveButton } from "@/components/Sheet";
import { edited } from "@/lib/formGuard";
import BrewSteps from "@/components/BrewSteps";
import CookNeedList, { type CookIngredient } from "@/components/CookNeedList";
import ProgressRing from "@/components/ProgressRing";
import { isMissingColumn, writeAcrossSkew } from "@/lib/schemaSkew";
import PersonPick, { usePersonMe, type PersonValue } from "@/components/PersonPick";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import EmptyState from "./EmptyState";
import { useApp } from "./AppProvider";
import { SectionHeader } from "@/components/kit";
import Icon from "@/components/Icon";
import { useConfirm } from "@/components/ConfirmSheet";
import { errorMessage } from "@/lib/errorMessage";
import Button from "./Button";

// BREW — recipes + a back-scheduled batch plan. Pick a recipe, set the batch size in GALLONS (the
// recipe scales exactly to it and hits its OG/Signal-Score spec), tie it to the event it's for, and
// the agent back-schedules the brew so it's ready in time. Batches land on the schedule; log the
// Signal Score when it's done — same high standard. Lives as a Plan sub-tab. Fetch state via
// useAsyncData — a failed load is a real error now, not a silent "No batches scheduled."
/* eslint-disable @typescript-eslint/no-explicit-any */

type Recipe = { id: string; name: string; style: string | null; ratio: string | null; target_spec: string | null; base_water_gal: number; extraction_hours: number; yield_factor: number | null; product_slug: string | null; ingredients: ScaledIng[] | null };
type Vessel = { id: string; name: string; capacity_gal: number; filter_type: string | null; min_gal: number | null };
type ScaledIng = { name: string; qty: number | string; unit?: string | null };
type Batch = { id: string; recipe_id: string | null; recipe_name: string | null; batch_gal: number; brew_date: string | null; ready_at: string | null; event_id: string | null; stop_id: string | null; status: string; og: string | null; signal_score: number | null; target_spec: string | null; extraction_hours: number | null; brew_started_at: string | null; vessel: string | null; coffee_lot: string | null; coffee_lot_id?: string | null; market?: string | null; consumption_logged_at?: string | null; brewer: string | null; taste_notes: string | null; created_at?: string | null; needed_by: string | null; latest_start_at: string | null; drop_date: string | null; hold_hours: number | null; scaled: ScaledIng[] | null };
type InvItem = { name: string; qty: number | null; unit: string | null };
type Ev = { id: string; title: string | null; day: string | null; day_label: string | null; expected_attendance: number | null; going_count: number | null };
type St = { id: string; name: string; starts_at: string | null; status: string | null };
// The coffee a batch was made from (0349): every city's deliveries on file, the read's own failure
// (said in the pick, not passed off as "none"), and whether the database keeps a pick as a link yet.
type LotBoard = { lots: BrewLot[]; lotsErr: string | null; linkable: boolean; use: ReadonlyMap<string, LotUse>; today: string; recipes: Recipe[]; batches: Batch[]; names: ReadonlySet<string> };
type BrewBoard = { recipes: Recipe[]; vessels: Vessel[]; batches: Batch[]; events: Ev[]; stops: St[]; inv: InvItem[]; demand: Record<string, Record<string, number>>; lots: BrewLot[]; lotsErr: string | null; linkable: boolean };
const cityOf = (m: string | null | undefined) => (isMarket(m) ? MARKET_LABEL[m] : m || "this city");
/** What a batch says about its coffee, as the pick starts from it. */
const lotOf = (b: Batch): LotValue => ({ id: b.coffee_lot_id ?? null, text: b.coffee_lot ?? "" });

const STATUS: { key: string; label: string }[] = [
  { key: "planned", label: "Planned" }, { key: "brewing", label: "Brewing" }, { key: "ready", label: "Ready" },
  { key: "kegged", label: "Kegged" }, { key: "served", label: "Served" }, { key: "dumped", label: "Dumped" },
];
const fmtDate = (s: string | null) => s ? new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "—";
const fmtTs = (s: string | null) => s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" }) : "—";
// display-only: target_spec sometimes carries a " · Signal Score 8+" tail — drop it on the card (DB value untouched)
const specLabel = (s: string | null) => (s ?? "").replace(/\s*·\s*Signal Score.*$/, "");

// Stock check for a planned batch — match scaled ingredients to inventory by normalized-name
// containment both directions, keyed on the first significant word ("coffee" ties
// "Coffee, coarse grind" to "Whole-bean coffee"). Returns null when there's nothing to say.
const STOCK_STOP = new Set(["the", "and", "for", "with", "fresh", "cold", "whole", "raw", "organic", "filtered"]);
const sigWord = (s: string) => (s.toLowerCase().match(/[a-z]+/g) ?? []).find((w) => w.length > 2 && !STOCK_STOP.has(w)) ?? "";
const nameMatch = (a: string, b: string) => {
  const sa = sigWord(a), sb = sigWord(b);
  return !!sa && !!sb && (a.toLowerCase().includes(sb) || b.toLowerCase().includes(sa));
};
const stockShorts = (scaled: ScaledIng[] | null, inv: InvItem[]): string[] | null => {
  const rows = Array.isArray(scaled) ? scaled.filter((i) => i?.name?.trim()) : [];
  if (!rows.length || !inv.length) return null;
  let matched = 0;
  const shorts: string[] = [];
  const u = (x?: string | null) => (x ?? "").toLowerCase().trim().replace(/s$/, "");
  rows.forEach((ing) => {
    const item = inv.find((i) => nameMatch(i.name, ing.name));
    if (!item) return;
    matched++;
    // only compare quantities when the units agree — a gal-vs-g compare would mislead
    if (u(ing.unit) !== u(item.unit) || item.qty == null || !(Number(ing.qty) > 0)) return;
    const d = Number(ing.qty) - Number(item.qty);
    if (d > 0) shorts.push(`Short ${+d.toFixed(1)}${u(ing.unit) ? ` ${u(ing.unit)}` : ""} ${sigWord(ing.name)}`);
  });
  return matched ? shorts : null;
};
// remaining time to a target, as "12h 04m" / "48m" / "ready"
const remain = (target: string | null, now: number) => {
  if (!target) return "";
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return "ready";
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

export default function BrewPlanner() {
  const confirm = useConfirm();
  const { toast } = useApp();
  const [plan, setPlan] = useState<Recipe | null>(null);
  // Set by PrepDetail's "Plan a brew for this event/stop" (localStorage bridge, same pattern as
  // gt3-plan-tab) — carries the target into the sheet BrewSheet opens next, then clears itself.
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const [pack, setPack] = useState<Batch | null>(null);
  const [logBatch, setLogBatch] = useState<Batch | null>(null);
  // The method sheet — the one place a batch says what to do. See BrewSteps for why it exists.
  const [stepsFor, setStepsFor] = useState<Batch | null>(null);
  const [starting, setStarting] = useState<Batch | null>(null);
  const [adjust, setAdjust] = useState<Batch | null>(null);
  const [view, setView] = useState<"schedule" | "log">("schedule");
  const [now, setNow] = useState(() => Date.now());

  // THE SCHEMA CAN BE ONE MIGRATION BEHIND THIS BUILD (see lib/schemaSkew.isMissingColumn). Ask for
  // min_gal; if the database has not been given 0337 yet, ask again without it and carry on with
  // min_gal absent — which is precisely the state the rest of this component already handles, since
  // an unmeasured vessel is the normal case until somebody goes and measures one.
  //
  // The forgiveness is narrowed to that ONE condition on purpose. A blanket catch here would turn a
  // dropped table, a revoked grant or an RLS refusal into a silent empty list, and "a failed read is
  // not an empty list" is the rule this app keeps re-learning. Every other error still throws.
  const vesselsRead = useCallback(async () => {
    // 0337 (min_gal) is APPLIED as of 2026-10-01, so this no longer carries an `arrives-with:`
    // marker — the column is in the snapshot and the audit checks it like any other. The retry
    // stays because the window it covers is not about this column: a push reaches production
    // before its migration is pasted, every time, so new code always runs against the previous
    // schema for a while. Deleting the retry would buy nothing and re-arm c11e418.
    const full = await supabase!.from("brew_vessels")
      .select("id, name, capacity_gal, filter_type, min_gal").is("archived_at", null).order("sort");
    if (!full.error || !isMissingColumn(full.error)) return full;
    return supabase!.from("brew_vessels")
      .select("id, name, capacity_gal, filter_type").is("archived_at", null).order("sort");
  }, []);

  // 0349 adds brew_batches.coffee_lot_id. Until it is pasted the batches are asked for again without
  // it, and the board knows (linkable: false): the lot pick is still offered and the batch keeps the
  // lot's name, and nothing promises a link or a draw the database cannot make yet. The same narrow
  // forgiveness as vesselsRead — that one condition; every other error still throws.
  const batchesRead = useCallback(async () => {
    // arrives-with: 0349
    const full = await supabase!.from("brew_batches")
      .select("id, recipe_id, recipe_name, batch_gal, brew_date, ready_at, event_id, stop_id, status, og, signal_score, target_spec, extraction_hours, brew_started_at, vessel, coffee_lot, brewer, taste_notes, created_at, needed_by, latest_start_at, drop_date, hold_hours, scaled, market, consumption_logged_at, coffee_lot_id")
      .order("created_at", { ascending: false });
    if (!full.error || !isMissingColumn(full.error)) return { ...full, linkable: true };
    const prior = await supabase!.from("brew_batches")
      .select("id, recipe_id, recipe_name, batch_gal, brew_date, ready_at, event_id, stop_id, status, og, signal_score, target_spec, extraction_hours, brew_started_at, vessel, coffee_lot, brewer, taste_notes, created_at, needed_by, latest_start_at, drop_date, hold_hours, scaled, market, consumption_logged_at")
      .order("created_at", { ascending: false });
    return { ...prior, linkable: false };
  }, []);

  const loader = useCallback(async (): Promise<BrewBoard> => {
    if (!supabase) return { recipes: [], vessels: [], batches: [], events: [], stops: [], inv: [], demand: {}, lots: [], lotsErr: null, linkable: false };
    const [r, b, e, v, st, ii, lt] = await Promise.all([
      supabase.from("brew_recipes").select("id, name, style, ratio, target_spec, base_water_gal, extraction_hours, yield_factor, product_slug, ingredients").is("archived_at", null).order("sort"),
      batchesRead(),
      supabase.from("events").select("id, title, day, day_label, expected_attendance, going_count").is("archived_at", null).order("day"),
      // Migrations here are pasted BY HAND after the push, so every deploy has a window running new
      // code against the previous schema. Without the fallback in vesselsRead, one column that does
      // not exist yet throws out of this Promise.all and takes the whole Brew board with it:
      // recipes, batches, events, stops and inventory, none of which have anything to do with it.
      vesselsRead(),
      supabase.from("stops").select("id, name, starts_at, status").is("archived_at", null).order("starts_at", { ascending: true, nullsFirst: false }),
      supabase.from("inventory_items").select("name, qty, unit"),
      // The deliveries a batch can name (0347's lots, with their supplier). Not in the throwing set:
      // a failed read here is said inside the coffee lot pick, and the rest of the board still loads.
      supabase.from("inventory_lots").select("id, market, item_name, lot_code, received_on, qty_received, unit, created_at, vendors(name)")
        .order("received_on", { ascending: false }).limit(500),
    ]);
    const firstErr = [r, b, e, v, st, ii].find((x) => x.error)?.error;
    if (firstErr) throw new Error(firstErr.message);
    const lots: BrewLot[] = ((lt.data as (Omit<BrewLot, "vendor"> & { vendors: { name: string | null } | null })[] | null) ?? [])
      .map(({ vendors, ...l }) => ({ ...l, qty_received: Number(l.qty_received), vendor: vendors?.name ?? null }));
    const bb = (b.data as Batch[]) ?? [];
    const inv = ((ii.data as InvItem[]) ?? []).filter((i) => i.name?.trim());
    // Demand for the drops these batches feed — per drop_date + flavor, same math as DropOps.
    const dates = [...new Set(bb.filter((x) => !batchIsOver(x.status) && x.drop_date).map((x) => x.drop_date!))];
    const demand: Record<string, Record<string, number>> = {};
    if (dates.length) {
      const { data: o, error: oErr } = await supabase.from("drop_orders").select("drop_date, mix, canceled_at").is("canceled_at", null).in("drop_date", dates);
      if (oErr) throw new Error(oErr.message);
      ((o as { drop_date: string; mix: Record<string, number> | null }[]) ?? []).forEach((row) => {
        const d = (demand[row.drop_date] ??= { RISE: 0, FLOW: 0, DUSK: 0 });
        FLAVORS.forEach((f) => { d[f] += row.mix?.[f] || 0; });
      });
    }
    return { recipes: (r.data as Recipe[]) ?? [], vessels: (v.data as Vessel[]) ?? [], batches: bb, events: (e.data as Ev[]) ?? [], stops: (st.data as St[]) ?? [], inv, demand,
      lots, lotsErr: lt.error ? lt.error.message : null, linkable: b.linkable };
    // vesselsRead and batchesRead are themselves useCallback([]) and so stable; naming them here
    // keeps the dependency honest rather than relying on that from a distance.
  }, [vesselsRead, batchesRead]);
  const board = useAsyncData(loader, []);
  const { reload } = board;

  const recipes = board.data?.recipes ?? [];
  const vessels = board.data?.vessels ?? [];
  const batches = board.data?.batches ?? [];
  const events = board.data?.events ?? [];
  const stops = board.data?.stops ?? [];
  const inv = board.data?.inv ?? [];
  const demand = board.data?.demand ?? {};
  // What each lot's brews took, by their recipes (lib/brewLots.lotUse) — for the pick's default and
  // its line. Keyed on the load, so it is worked out once per board, not once per render.
  const brd = board.data;
  const use = useMemo(() => lotUse(brd?.batches ?? [], brd?.recipes ?? []), [brd]);
  // Every lot's own words, so a batch that kept only a lot's name (saved before 0349 was pasted) is
  // still printed as a lot on file, not as "lot Org Ethiopia Coffee (bulk), lot SPROUTS-840214".
  const names = useMemo(() => new Set((brd?.lots ?? []).map(lotLabel)), [brd]);
  const lotBoard: LotBoard = { lots: brd?.lots ?? [], lotsErr: brd?.lotsErr ?? null, linkable: brd?.linkable ?? false, use, today: localToday(), recipes, batches, names };

  // Pick up a jump-in target left by PrepDetail, once recipes are loaded (need one to open the
  // sheet — mirrors the manual "+ Plan a batch" button's own default of recipes[0]).
  useEffect(() => {
    if (!recipes.length) return;
    let pending: string | null = null;
    try { pending = localStorage.getItem("gt3-brew-target"); } catch { /* ignore */ }
    if (!pending) return;
    try { localStorage.removeItem("gt3-brew-target"); } catch { /* ignore */ }
    setPlan(recipes[0]);
    setPendingTarget(pending);
  }, [recipes]);

  // Live clock — ticks while a brew countdown or serve-by window is on screen, so both stay current.
  const ticking = batches.some((b) => b.status === "brewing" || b.status === "ready" || b.status === "kegged");
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [ticking]);

  // Mutations reload() from the server rather than patching local state — the fetched board now lives
  // inside useAsyncData, which has no setter of its own (by design: it's the one place status/error live).
  // Serving or dumping a batch is refused until it says what it drank (0294's guard). That refusal
  // used to vanish: the error was discarded and reload() snapped the dropdown back to its old value
  // with nothing said, which is the worst way for a rule to be enforced. Now the batch offers the
  // one action that satisfies it, and any other failure is shown rather than swallowed.
  const [needsLog, setNeedsLog] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [logResult, setLogResult] = useState<{ id: string; drawn: number; gaps: any[]; items: any[] } | null>(null);
  // useAsyncData owns the LOAD error; a mutation that fails needs somewhere of its own to be seen.
  const [mutErr, setMutErr] = useState<string | null>(null);

  const setStatus = async (id: string, status: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("brew_batches").update({ status }).eq("id", id);
    if (error) {
      if (/log what this batch used/i.test(error.message)) setNeedsLog(id);
      else setMutErr(error.message);
      reload();
      return;
    }
    setNeedsLog(null);
    reload();
  };

  // Draws the batch's ingredients off the shelf through the ingredient map, and reports what it
  // could not draw. A gap is not a failure — it is the list of conversions nobody has worked out
  // yet — so the batch is logged either way and the shortfall is shown.
  const logUsed = async (id: string) => {
    if (!supabase) return;
    setLogging(true);
    const { data, error } = await supabase.rpc("log_batch_consumption", { p_batch_id: id });
    setLogging(false);
    if (error) { setMutErr(error.message); return; }
    const r: any = data ?? {};
    setLogResult({ id, drawn: Number(r.drawn_count) || 0, gaps: Array.isArray(r.gaps) ? r.gaps : [], items: Array.isArray(r.drawn) ? r.drawn : [] });
    setNeedsLog(null);
    reload();
  };
  // Start the brew NOW — stamp the start, set ready_at = now + extraction_hours, capture the coffee
  // lot + brewer for traceability, reset alert flags. The brewer is a PERSON now (0344): the brew
  // alarms ring for brewer_id, and the name stays on `brewer` for the production log. Before 0344
  // is pasted the write goes in without brewer_id (lib/schemaSkew), and a write that fails says so
  // instead of starting a countdown nobody's database knows about.
  //
  // The coffee lot is a delivery on file now (0349): the sheet's pick is what the batch says — its
  // link and its words together, or words alone for a bag that never came in through the app, or
  // nothing. Before 0349 is pasted the link is dropped and the words kept (lib/schemaSkew).
  const startBrew = async (b: Batch, extras?: { lot?: LotValue; brewer?: PersonValue }): Promise<boolean> => {
    if (!supabase) return false;
    const hrs = Number(b.extraction_hours) || 20;
    const startIso = new Date().toISOString();
    const readyIso = new Date(Date.now() + hrs * 3600000).toISOString();
    const lot = extras?.lot ? { coffee_lot: extras.lot.text.trim() || null, coffee_lot_id: extras.lot.id } : {};
    const brewer = extras?.brewer?.name.trim() || b.brewer || null;
    setNow(Date.now());
    // arrives-with: 0344
    // arrives-with: 0349
    const { error } = await writeAcrossSkew((row) => supabase!.from("brew_batches").update(row).eq("id", b.id),
      { status: "brewing", brew_started_at: startIso, ready_at: readyIso, ...lot, brewer, ...(extras?.brewer ? { brewer_id: extras.brewer.id } : {}), alerted_soon: false, alerted_ready: false, alerted_started: false, alerted_overextract: false, alerted_hold_soon: false, alerted_hold_expired: false } as Record<string, unknown>,
      ["brewer_id", "coffee_lot_id"]);
    if (error) { setMutErr(error.message); return false; }
    reload();
    return true;
  };
  // BREW FLEXIBILITY — the real brew rarely starts exactly when you tap Start. Fix the actual start
  // time (ready recomputes from it), stop early to bottle now, or undo a start entirely. Maximum
  // flexibility, inline — no navigating away, no re-planning.
  const saveBrewTime = async (b: Batch, startLocal: string) => {
    if (!supabase || !startLocal) return;
    const hrs = Number(b.extraction_hours) || 20;
    const startIso = new Date(startLocal).toISOString();
    const readyIso = new Date(new Date(startLocal).getTime() + hrs * 3600000).toISOString();
    setNow(Date.now());
    await supabase.from("brew_batches").update({ brew_started_at: startIso, ready_at: readyIso, alerted_soon: false, alerted_ready: false }).eq("id", b.id);
    reload();
  };
  const stopBrew = async (b: Batch) => {
    if (!supabase) return;
    const nowIso = new Date().toISOString();
    await supabase.from("brew_batches").update({ status: "ready", ready_at: nowIso, alerted_ready: true }).eq("id", b.id);
    reload();
  };
  const undoStart = async (b: Batch) => {
    if (!supabase) return;
    await supabase.from("brew_batches").update({ status: "planned", brew_started_at: null, ready_at: null, alerted_soon: false, alerted_ready: false, alerted_started: false }).eq("id", b.id);
    reload();
  };

  // TAKING BACK A BATCH THAT SHOULD NOT EXIST (0308).
  //
  // "Undo start" put a batch back to planned — which is right when you started it early, and wrong
  // when you never meant to log it at all: the phantom sits on the schedule forever. The only real
  // removal was a Delete button inside the batch log, two taps behind a view toggle, nowhere near
  // where the mistake happens.
  //
  // The one thing this must NOT do is decide for itself whether a hard delete is safe. Three tables
  // carry batch_id on delete set null — drop orders, delivery orders, the stock ledger — so
  // deleting a batch something already points at leaves those rows alive and orphaned, which is the
  // exact traceability 0261 exists to provide. discard_batch checks and picks: gone if nothing
  // points at it, kept and marked if something does. The toast says which, because "removed" and
  // "kept but marked" are different facts and the person deserves the real one.
  const removeBatch = async (b: Batch): Promise<boolean> => {
    if (!supabase) return false;
    const name = b.recipe_name || "batch";
    if (!(await confirm({
      title: `Remove this ${name} (${b.batch_gal} gal)?`,
      body: "Use this when the batch was logged by mistake. If anything already points at it — an order, a stock movement — it is kept and marked discarded instead of deleted, so the trail survives.",
      confirmLabel: "Remove it", danger: true,
    }))) return false;
    const { data, error } = await supabase.rpc("discard_batch", { p_batch: b.id, p_reason: null });
    if (error) { setMutErr(error.message); return false; }
    toast(data === "deleted"
      ? `${name} removed.`
      : `${name} marked discarded — orders or stock still point at it, so the record stays.`);
    reload();
    return true;
  };

  // schedule view = what's upcoming / in progress; the log view = every batch ever, the permanent
  // record. What is over — served, dumped, discarded — is lib/brewMath's one list.
  const active = batches.filter((b) => !batchIsOver(b.status))
    .sort((a, b) => (a.ready_at || "9999").localeCompare(b.ready_at || "9999"));

  return (
    <AsyncSection state={board} isEmpty={() => false} errorTitle="Couldn't load brew" emptyTitle="Nothing here yet">
      {() => (
    <div className="adm-sec">
      <SectionHeader label="Brew" />
      <Button kind="primary" wide onClick={() => setPlan(recipes[0] ?? null)} disabled={!recipes.length}>+ Plan a batch</Button>
      <div className="pnl-note" style={{ marginBottom: 8 }}>Recipes scale exactly to the gallons of water you brew and hold the spec. Batches are back-scheduled from the event they&apos;re for, then logged to standard.</div>

      {mutErr && (
        <div className="brew-oprow warn" role="alert">
          {mutErr}
          <button type="button" onClick={() => setMutErr(null)} aria-label="Dismiss">Dismiss</button>
        </div>
      )}

      <div className="brew-toggle">
        {(["schedule", "log"] as const).map((k) => (
          <button key={k} type="button" className={`brew-toggle-b hit-y-44${view === k ? " on" : ""}`} onClick={() => setView(k)}>{k === "schedule" ? "Schedule" : "Production log"}</button>
        ))}
      </div>

      {view === "log" ? (
        batches.length === 0 ? <EmptyState title="No batches logged yet" sub="Plan and brew one." /> : (
          <div className="brew-list">
            {batches.map((b) => (
              <button key={b.id} type="button" className={`brew-logrow st-${b.status}`} onClick={() => setLogBatch(b)}>
                <span className="brew-recipe-main">
                  <b>{b.recipe_name || "Batch"} · {b.batch_gal} gal{b.signal_score != null ? ` · Signal ${b.signal_score}/10` : ""}</b>
                  {/* A lot on file is named by its own words ("…, lot SPROUTS-840214"); typed words get the "lot" they always had. */}
                  <span>{fmtTs(b.brew_started_at || b.ready_at)}{b.vessel ? ` · ${b.vessel}` : ""}{b.coffee_lot ? (b.coffee_lot_id || lotBoard.names.has(b.coffee_lot) ? ` · ${b.coffee_lot}` : ` · lot ${b.coffee_lot}`) : ""} · {b.status}</span>
                </span>
                <span className="brew-recipe-go">Log ›</span>
              </button>
            ))}
          </div>
        )
      ) : (<>
      <div className="brew-sched-h">Brew schedule</div>
      {active.length === 0 ? <EmptyState title="No batches scheduled" sub="Tap + Plan a batch." /> : (
        <div className="brew-list">
          {active.map((b) => {
            const ev = events.find((e) => e.id === b.event_id);
            const tgt = ev ? (ev.title || ev.day_label) : stops.find((s) => s.id === b.stop_id)?.name ?? null;
            const spec = specLabel(b.target_spec);
            return (
              <div key={b.id} className={`brew-card st-${b.status}`}>
                <div className="brew-card-top">
                  <b>{b.recipe_name || "Batch"} · {b.batch_gal} gal</b>
                  <select className="brew-status" value={b.status} onChange={(e) => setStatus(b.id, e.target.value)}>
                    {STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div className="brew-card-meta">
                  {b.vessel ? `${b.vessel} · ` : ""}Brew {fmtDate(b.brew_date)} → ready {fmtTs(b.ready_at)}{tgt ? ` · for ${tgt}` : ""}{spec ? ` · ${spec}` : ""}
                </div>

                {/* The method used to live only in the planning result, so a batch you were actually
                    brewing had nowhere to tell you what to do. This is that door. */}
                <button type="button" className="brew-steps-open" onClick={() => setStepsFor(b)}>
                  <Icon name="clock" /> Brew steps <span aria-hidden="true">›</span>
                </button>

                {(b.status === "planned" || b.status === "brewing") && (() => {
                  // Coverage — will this run cover what's reserved for its drop?
                  const rec = recipes.find((r) => r.id === b.recipe_id);
                  const makes = bottlesFor(b.batch_gal, rec?.yield_factor);
                  const flavor = rec?.product_slug?.toUpperCase(); // 'rise' → mix key 'RISE'
                  const reserved = b.drop_date && flavor ? demand[b.drop_date]?.[flavor] : undefined;
                  const short = reserved != null ? reserved - makes : 0;
                  return (
                    <div className={`brew-oprow${reserved == null ? "" : short > 0 ? " warn" : " ok"}`}>
                      Makes ~{makes} bottles{reserved == null ? "" : ` · ${reserved} reserved — ${short > 0 ? `short ${short}` : "covers it"}`}
                    </div>
                  );
                })()}
                {b.status === "planned" && !b.brew_started_at && (() => {
                  const shorts = stockShorts(b.scaled, inv);
                  if (!shorts) return null;
                  return <div className={`brew-oprow${shorts.length ? " warn" : " ok"}`}>{shorts.length ? shorts.join(" · ") : "Stock covers it"}</div>;
                })()}

                {/* The guard refused a status change: say so plainly and offer the one action that
                    satisfies it, instead of letting the dropdown snap back with no explanation. */}
                {needsLog === b.id && (
                  <div className="brew-oprow warn brew-needslog">
                    <span>Nothing has come off the shelf for this batch yet.</span>
                    <button type="button" onClick={() => logUsed(b.id)} disabled={logging}>
                      {logging ? "Logging…" : "Log what it used"}
                    </button>
                  </div>
                )}
                {logResult?.id === b.id && (() => {
                  // What came off, and what could not — in the database's words for the coffee
                  // (0349). This used to end "Link them to a shelf in Inventory": nothing in the app
                  // can link an ingredient to a shelf, so it sent people looking for a screen that
                  // does not exist. Naming the coffee lot is the one way a line comes off a shelf now.
                  const cup = logResult.items.find((d: any) => d.lot_id && isCoffee(d.ingredient));
                  const cupLot = cup ? lotBoard.lots.find((l) => l.id === cup.lot_id) : null;
                  // Before 0349 the coffee is a gap like any other; after it, the gap says why.
                  const gap = lotBoard.linkable ? logResult.gaps.find((g: any) => isCoffee(g.ingredient)) : undefined;
                  const rest = logResult.gaps.filter((g: any) => g !== gap);
                  const why = !gap ? "" : gap.lot_id ? String(gap.why)
                    : `${b.coffee_lot ? "the lot on this batch is words, not a delivery on file" : "no lot is named on this batch"} — name the coffee lot when you start a brew and its coffee comes off it`;
                  return (
                    <div className={`brew-oprow${logResult.gaps.length ? " warn" : " ok"}`}>
                      {logResult.drawn > 0
                        ? `Drew ${logResult.drawn} ingredient${logResult.drawn === 1 ? "" : "s"} off the shelf${cup ? ` — the coffee off ${cupLot ? lotLabel(cupLot) : b.coffee_lot || "the lot it names"}` : ""}.`
                        : "Nothing could be drawn off the shelf."}
                      {gap && ` The coffee was not: ${why}.`}
                      {rest.length > 0 && ` Not accounted: ${rest.map((g: any) => g.ingredient).join(", ")} — nothing links ${rest.length === 1 ? "it" : "them"} to a shelf yet.`}
                    </div>
                  );
                })()}

                {b.status === "planned" && (
                  <>
                    {b.latest_start_at && (() => {
                      const over = brewStartOverdue(b, now);
                      return <div className={`brew-startby${over ? " over" : ""}`}>{over ? <><Icon name="warning" /> Past the latest start to be ready in time — start now</> : <><Icon name="clock" /> Start by {fmtTs(b.latest_start_at)} to be ready in time</>}</div>;
                    })()}
                    <button type="button" className="brew-start" onClick={() => setStarting(b)}>▶ Start brew ({Number(b.extraction_hours) || 20}h)</button>
                    {/* A planned batch is the cheapest kind of mistake and used to be the hardest to
                        take back — nothing had happened yet, and the only Delete was two taps away
                        in the production log. */}
                    <button type="button" className="brew-remove" onClick={() => removeBatch(b)}>Remove — planned by mistake</button>
                  </>
                )}
                {b.status === "brewing" && b.ready_at && (() => {
                  const ms = new Date(b.ready_at).getTime() - now;
                  const done = ms <= 0; const soon = !done && ms <= 3600000;
                  const startMs = b.brew_started_at ? new Date(b.brew_started_at).getTime() : null;
                  const totalMs = startMs && b.ready_at ? new Date(b.ready_at).getTime() - startMs : null;
                  const pct = done ? 1 : (startMs && totalMs && totalMs > 0 ? (now - startMs) / totalMs : 0);
                  return (
                    <div className={`brew-timer${done ? " done" : soon ? " soon" : ""}`}>
                      <ProgressRing pct={pct} size={50} stroke={4.5} color={done ? "var(--ok)" : soon ? "var(--red-h)" : "var(--gold2)"}>
                        <span className="brew-ring-pct">{done ? "🍾" : `${Math.round(pct * 100)}%`}</span>
                      </ProgressRing>
                      <div className="brew-timer-txt">
                        <b>{done ? <><Icon name="clock" /> Time to bottle</> : remain(b.ready_at, now)}</b>
                        <span>{done ? `${b.recipe_name || "Brew"} · ${b.batch_gal} gal — filter, finish, bottle` : `${b.batch_gal} gal brewing · ready ${fmtTs(b.ready_at)}${soon ? " · almost there" : ""}`}</span>
                      </div>
                    </div>
                  );
                })()}
                {b.status === "brewing" && (
                  <button type="button" className="brew-adjust-link" onClick={() => setAdjust(b)}>Adjust brew time · stop early ›</button>
                )}
                {(b.status === "ready" || b.status === "kegged") && (
                  <>
                    {b.ready_at && (() => {
                      // Serve-by — the same deadline the alert ladder (0084) pushes on; show it here before the push does.
                      const serveBy = new Date(b.ready_at).getTime() + Number(b.hold_hours ?? 72) * 3600000;
                      const ms = serveBy - now;
                      const label = new Date(serveBy).toLocaleString(undefined, { weekday: "short", hour: "numeric" }).replace(",", "");
                      const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
                      return (
                        <div className={`brew-oprow${ms <= 0 ? " over" : ms < 12 * 3600000 ? " warn" : " ok"}`}>
                          {ms <= 0 ? `Serve by ${label} — past its window` : `Serve by ${label} · ${h > 0 ? `${h}h` : `${m}m`} left`}
                          {/* Alarm-fatigue fix (P3, 2026-08-03): a past-window batch used to just sit
                              red while the 0084 ladder kept pushing. Taste it and make the call —
                              "still good" extends the hold 24h (quiets the ladder for a day, on the
                              record), or archive it from the status controls if it's done. */}
                          {ms <= 0 && (
                            <button type="button" className="btn-ter ml-2.5" onClick={async () => {
                              if (!supabase) return;
                              await supabase.from("brew_batches").update({ hold_hours: Number(b.hold_hours ?? 72) + 24 }).eq("id", b.id);
                            }}>Tasted — still good, +24h</button>
                          )}
                        </div>
                      );
                    })()}
                    <Button type="button" kind="secondary" compact wide className="mt-2" onClick={() => setPack(b)}><Icon name="package" /> Plan the bottle loadout</Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Recipes */}
      <div className="brew-sched-h" style={{ marginTop: 18 }}>Recipes</div>
      <div className="brew-list">
        {recipes.map((r) => (
          <button key={r.id} type="button" className="brew-recipe" onClick={() => setPlan(r)}>
            <span className="brew-recipe-main"><b>{r.name}</b><span>{[r.style, r.ratio, specLabel(r.target_spec)].filter(Boolean).join(" · ")}</span></span>
            <span className="brew-recipe-go">Plan ›</span>
          </button>
        ))}
      </div>
      </>)}

      {plan && <BrewSheet recipe={plan} events={events} stops={stops} vessels={vessels} inv={inv} initialTarget={pendingTarget ?? undefined} onClose={() => { setPlan(null); setPendingTarget(null); }} onDone={() => { setPlan(null); setPendingTarget(null); reload(); }} />}
      {pack && <BottleLoadout batch={pack} onClose={() => setPack(null)} />}
      {logBatch && <BatchLog batch={logBatch} events={events} stops={stops} lotBoard={lotBoard} onClose={() => setLogBatch(null)} onSaved={() => { setLogBatch(null); reload(); }} onRemove={removeBatch} />}
      {stepsFor && <BrewSteps batch={stepsFor as any} onClose={() => setStepsFor(null)} onChanged={reload} />}
      {starting && <StartBrewSheet batch={starting} lotBoard={lotBoard} onClose={() => setStarting(null)} onStart={async (extras) => { if (await startBrew(starting, extras)) setStarting(null); }} />}
      {adjust && <BrewAdjust batch={adjust} onClose={() => setAdjust(null)} onSaveTime={saveBrewTime} onStop={stopBrew} onUndo={undoStart} onRemove={removeBatch} />}
    </div>
      )}
    </AsyncSection>
  );
}

// Start-brew sheet — captures the coffee lot + brewer at the moment of brewing (traceability), then
// kicks off the countdown. Lot is the field a recall would hinge on, so it comes first — and it is a
// delivery on file now (0349), opened on the bag this city's last brew named (lib/brewLots.defaultLot).
function StartBrewSheet({ batch, lotBoard, onClose, onStart }: { batch: Batch; lotBoard: LotBoard; onClose: () => void; onStart: (extras: { lot: LotValue; brewer: PersonValue }) => void | Promise<void> }) {
  // What the batch already says, else the bag the city's last brew named, else nothing — ask.
  const [lot, setLot] = useState<LotValue>(() => {
    if (batch.coffee_lot_id || batch.coffee_lot?.trim()) return lotOf(batch);
    const id = defaultLot(lotBoard.lots, batch.market, lotBoard.use);
    const l = id ? lotBoard.lots.find((x) => x.id === id) : null;
    return l ? { id: l.id, text: lotLabel(l) } : { id: null, text: "" };
  });
  // You, unless you say otherwise — the person starting the brew is almost always the one brewing.
  const me = usePersonMe();
  const [brewer, setBrewer] = useState<PersonValue>(batch.brewer ? { id: null, name: batch.brewer } : me);
  const [busy, setBusy] = useState(false);
  const hrs = Number(batch.extraction_hours) || 20;
  return (
    <Sheet open onClose={onClose} label="Start brew" header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>Start brew · {batch.recipe_name}</b><CloseButton onClick={onClose} /></div>}>
          <div className="brew-spec">{batch.batch_gal} gal{batch.vessel ? ` · ${batch.vessel}` : ""} · {hrs}h cold extraction → ready ~{new Date(Date.now() + hrs * 3600000).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</div>
          <CoffeeLotPick label="Coffee lot — the bag this batch is made from" value={lot} onChange={setLot} lots={lotBoard.lots} failed={lotBoard.lotsErr}
                         market={batch.market} cityName={cityOf(batch.market)} use={lotBoard.use} needGrams={coffeeGrams(batch, lotBoard.recipes)}
                         today={lotBoard.today} linkable={lotBoard.linkable} logged={!!batch.consumption_logged_at} />
          <label className="prod-f" style={{ marginTop: 8 }}><span>Brewer — the brew alarms ring for them</span><PersonPick label="Brewer" value={brewer} onChange={setBrewer} /></label>
          <div className="prod-actions" style={{ marginTop: 14 }}>
            <button type="button" className="note-arch" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-pri" onClick={async () => { setBusy(true); await onStart({ lot, brewer }); setBusy(false); }} disabled={busy}>{busy ? "Starting…" : `▶ Start the ${hrs}h brew`}</button>
          </div>
    </Sheet>
  );
}

// Brew production log — the permanent record for one batch. Edit the traceability fields (coffee lot,
// brewer), the Signal Score, taste notes, OG, and status. This is the "GT3 Brew Lab Production" sheet.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Inline brew adjuster — reachable from a brewing card. Fix the real start time, stop & bottle now,
// or undo the start. Uses the qd-sheet popout (bulletproof scroll on all devices).
function BrewAdjust({ batch, onClose, onSaveTime, onStop, onUndo, onRemove }: { batch: Batch; onClose: () => void; onSaveTime: (b: Batch, startLocal: string) => Promise<void>; onStop: (b: Batch) => Promise<void>; onUndo: (b: Batch) => Promise<void>; onRemove: (b: Batch) => Promise<boolean> }) {
  const [start, setStart] = useState(() => toLocalInput(batch.brew_started_at || batch.brew_date));
  const [was] = useState(start);   // the time as it opened — a time moved and not saved asks first
  const [busy, setBusy] = useState(false);
  const hrs = Number(batch.extraction_hours) || 20;
  const readyPreview = start ? new Date(new Date(start).getTime() + hrs * 3600000) : null;
  const run = async (fn: () => Promise<void>) => { setBusy(true); await fn(); onClose(); };
  return (
    <Sheet open onClose={onClose} label="Adjust brew" dirty={start !== was && !busy} header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>Adjust brew · {batch.recipe_name}</b><CloseButton onClick={onClose} /></div>}>
          <label className="prod-f"><span>When it actually started brewing</span><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          {readyPreview && <div className="brew-spec">Ready ~{readyPreview.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })} · {hrs}h extraction</div>}
          <div className="prod-actions" style={{ marginTop: 12 }}>
            <LeaveButton className="note-arch" onClick={onClose}>Cancel</LeaveButton>
            <button type="button" className="btn-pri" disabled={busy || !start} onClick={() => run(() => onSaveTime(batch, start))}>Save brew time</button>
          </div>
          <div className="brew-adjust-sep" />
          <button type="button" className="brew-adjust-danger" disabled={busy} onClick={() => run(() => onStop(batch))}>⏹ Stop &amp; bottle now</button>
          <button type="button" className="brew-adjust-undo" disabled={busy} onClick={() => run(() => onUndo(batch))}>↩ Undo start — back to planned</button>
          {/* The one this sheet was missing. Undo puts a batch back to planned, which is the answer
              when you started it early — not when you never meant to log it, where it just moves the
              phantom from one column to another. */}
          <button type="button" className="brew-adjust-undo" disabled={busy}
                  onClick={() => run(async () => { if (await onRemove(batch)) onClose(); })}>
            ✕ This batch was a mistake — remove it
          </button>
    </Sheet>
  );
}

function BatchLog({ batch, events, stops, lotBoard, onClose, onSaved, onRemove }: { batch: Batch; events: Ev[]; stops: St[]; lotBoard: LotBoard; onClose: () => void; onSaved: () => void; onRemove: (b: Batch) => Promise<boolean> }) {
  const [f, setF] = useState<Batch>(batch);
  // The coffee lot, as the record has it — never filled in after the fact: a guess written into a
  // permanent record is worse than a blank. The link moves only when the lot is changed here (as the
  // brewer's id does): a board read before 0349 was pasted never saw the link, and must not clear it.
  const [lot, setLot] = useState<LotValue>(() => lotOf(batch));
  const [lotSet, setLotSet] = useState(false);
  // What the OTHER brews took from each lot — this batch is not counted against itself in its own log.
  const othersUse = useMemo(() => lotUse(lotBoard.batches.filter((x) => x.id !== batch.id), lotBoard.recipes), [lotBoard.batches, lotBoard.recipes, batch.id]);
  const pickLot = useCallback((v: LotValue) => { setLot(v); setLotSet(true); }, []);
  // The board does not read brewer_id (it arrives with 0344, and a select naming it would fail the
  // whole board until then), so the log knows the brewer by name: a name that is a crew member's is
  // linked by PersonPick. Once the brewer is CHANGED here the id follows the pick — none, or someone
  // off the crew, clears it so the alarms fall back to the planner; left alone, it is not touched.
  const [brewer, setBrewer] = useState<PersonValue>({ id: null, name: batch.brewer ?? "" });
  const [brewerSet, setBrewerSet] = useState(false);
  const pickBrewer = useCallback((v: PersonValue) => { setBrewer(v); setBrewerSet(true); }, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [targets, setTargets] = useState<string[]>([]); // ["e:<id>"|"s:<id>"] this batch serves
  const [firstTargets, setFirstTargets] = useState<string[] | null>(null); // as loaded — what "unsaved" compares
  const set = (k: keyof Batch, v: any) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => {
    supabase?.from("brew_batch_links").select("event_id, stop_id").eq("batch_id", batch.id)
      .then(({ data }) => {
        const t = ((data as { event_id: string | null; stop_id: string | null }[]) ?? []).map((l) => l.stop_id ? `s:${l.stop_id}` : `e:${l.event_id}`);
        setTargets(t); setFirstTargets(t);
      });
  }, [batch.id]);
  const dirty = edited(f, batch, ["status", "og", "signal_score", "taste_notes"]) || lotSet || brewerSet
    || (firstTargets !== null && targets.join("|") !== firstTargets.join("|"));
  const save = async () => {
    if (!supabase || busy) return;
    setBusy(true); setErr(null);
    // arrives-with: 0344
    // arrives-with: 0349
    const { error } = await writeAcrossSkew((row) => supabase!.from("brew_batches").update(row).eq("id", batch.id), {
      status: f.status, og: f.og?.trim() || null, signal_score: f.signal_score,
      coffee_lot: lot.text.trim() || null, brewer: brewer.name.trim() || null, taste_notes: f.taste_notes?.trim() || null,
      ...(brewerSet || brewer.id ? { brewer_id: brewer.id } : {}),
      ...(lotSet || lot.id ? { coffee_lot_id: lot.id } : {}),
      event_id: targets[0]?.startsWith("e:") ? targets[0].slice(2) : null,  // first selection = primary (back-schedule)
      stop_id: targets[0]?.startsWith("s:") ? targets[0].slice(2) : null,
    } as Record<string, unknown>, ["brewer_id", "coffee_lot_id"]);
    if (error) { setErr(error.message); setBusy(false); return; }
    // Re-sync the links to the chosen set (clear + insert).
    await supabase.from("brew_batch_links").delete().eq("batch_id", batch.id);
    if (targets.length) await supabase.from("brew_batch_links").insert(targets.map((t) => { const [k, id] = t.split(":"); return k === "s" ? { batch_id: batch.id, stop_id: id } : { batch_id: batch.id, event_id: id }; }));
    setBusy(false); onSaved();
  };
  // ONE REMOVAL PATH, NOT TWO. This used to be a raw delete that promised "can't be undone" and
  // quietly meant "and anything pointing at this batch loses its reference". It now goes through the
  // same discard_batch every other entry point uses, so the answer does not depend on which screen
  // you happened to be on when you noticed the mistake.
  const del = async () => {
    if (busy) return;
    setBusy(true);
    const removed = await onRemove(batch);
    setBusy(false);
    if (removed) onSaved();
  };
  return (
    <Sheet open onClose={onClose} label="Batch log" dirty={dirty} header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>Batch log · {batch.recipe_name}</b><CloseButton onClick={onClose} /></div>}>
          <div className="brew-spec">{batch.batch_gal} gal{batch.vessel ? ` · ${batch.vessel}` : ""}{batch.target_spec ? ` · ${batch.target_spec}` : ""}<br />Brewed {fmtTs(batch.brew_started_at)} → ready {fmtTs(batch.ready_at)}</div>
          <div className="prod-grid">
            <label className="prod-f"><span>Status</span>
              <select value={f.status} onChange={(e) => set("status", e.target.value)}>{STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
            </label>
            <label className="prod-f"><span>OG / spec</span><input value={f.og ?? ""} onChange={(e) => set("og", e.target.value)} placeholder="e.g. on spec" /></label>
            {/* Full width: a lot's name and the line under it do not fit half a phone. */}
            <CoffeeLotPick label="Coffee lot" value={lot} onChange={pickLot} lots={lotBoard.lots} failed={lotBoard.lotsErr} allowNone noneLabel="Not recorded"
                           market={batch.market} cityName={cityOf(batch.market)} use={othersUse} others needGrams={coffeeGrams(batch, lotBoard.recipes)}
                           today={lotBoard.today} linkable={lotBoard.linkable} logged={!!batch.consumption_logged_at} style={{ gridColumn: "1 / -1" }} />
            <label className="prod-f" style={{ gridColumn: "1 / -1" }}><span>Brewer</span><PersonPick label="Brewer" value={brewer} onChange={pickBrewer} allowNone noneLabel="Not recorded" /></label>
          </div>
          <div className="brew-score" style={{ marginTop: 10 }}>Signal Score
            {[6, 7, 8, 9, 10].map((n) => <button key={n} type="button" className={`brew-score-b${f.signal_score === n ? " on" : ""}`} onClick={() => set("signal_score", n)}>{n}</button>)}
          </div>
          <label className="prod-f" style={{ marginTop: 10 }}><span>Taste / cupping notes</span><textarea className="note-in" rows={3} value={f.taste_notes ?? ""} onChange={(e) => set("taste_notes", e.target.value)} placeholder="Aroma, body, balance, anything off…" /></label>
          <div className="prod-f" style={{ marginTop: 10 }}><span>Serving which events / stops? (first drives the schedule)</span>
            <div className="ts-chips" style={{ marginTop: 4 }}>
              {events.map((ev2) => { const k = `e:${ev2.id}`; const on = targets.includes(k); return <button key={ev2.id} type="button" className={`k-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setTargets((p) => on ? p.filter((x) => x !== k) : [...p, k])}>{on && <><Icon name="check" /> </>}<Icon name="event" /> {ev2.title || ev2.day_label}</button>; })}
              {stops.map((s) => { const k = `s:${s.id}`; const on = targets.includes(k); return <button key={s.id} type="button" className={`k-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setTargets((p) => on ? p.filter((x) => x !== k) : [...p, k])}>{on && <><Icon name="check" /> </>}<Icon name="truck" /> {s.name}</button>; })}
              {events.length === 0 && stops.length === 0 && <span className="dp-hint">No events or stops yet.</span>}
            </div>
          </div>
          {err && <div className="dp-err" role="alert">Couldn&apos;t save the log — {err}</div>}
          <div className="prod-actions" style={{ marginTop: 14, justifyContent: "space-between" }}>
            <button type="button" className="note-arch brew-del" onClick={del} disabled={busy}>Remove batch</button>
            <div style={{ display: "flex", gap: 8 }}>
            <LeaveButton className="note-arch" onClick={onClose}>Cancel</LeaveButton>
            <button type="button" className="btn-pri" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save log"}</button>
            </div>
          </div>
    </Sheet>
  );
}

// Fill `needGal` from the real keg fleet — smallest keg that covers the remainder, else the largest.
function allocKegs(needGal: number, inv: { cap: number; qty: number }[]): { cap: number; count: number }[] {
  if (needGal <= 0.001) return [];
  const pool = (inv.length ? inv : [{ cap: 5, qty: 999 }]).map((k) => ({ ...k }));
  const used: Record<number, number> = {};
  let need = needGal, guard = 0;
  while (need > 0.001 && guard++ < 100) {
    const avail = pool.filter((k) => k.qty > 0);
    if (!avail.length) break;
    const covers = avail.filter((k) => k.cap >= need - 0.001).sort((a, b) => a.cap - b.cap);
    const pick = covers[0] ?? avail.slice().sort((a, b) => b.cap - a.cap)[0];
    pick.qty--; used[pick.cap] = (used[pick.cap] || 0) + 1; need -= pick.cap;
  }
  return Object.entries(used).map(([cap, count]) => ({ cap: Number(cap), count }));
}
const kegLabel = (plan: { cap: number; count: number }[]) => plan.map((k) => `${k.count}× ${k.cap}gal`).join(" + ");

// Bottle loadout — how to pack THIS batch's bottles for the car, and what to pack them in.
function BottleLoadout({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const [oz, setOz] = useState(10);
  const [kegGal, setKegGal] = useState("0"); // gallons of this batch going to keg(s)
  const [vehicle, setVehicle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<any | null>(null);
  const [kegInv, setKegInv] = useState<{ cap: number; qty: number }[]>([]);
  const [assignTask, setAssignTask] = useState(false);

  useEffect(() => {
    supabase?.from("kegs").select("capacity_gal, qty").is("archived_at", null)
      .then(({ data }) => setKegInv(((data as { capacity_gal: number; qty: number }[]) ?? []).map((k) => ({ cap: Number(k.capacity_gal), qty: Number(k.qty) })).filter((k) => k.cap > 0 && k.qty > 0)));
  }, []);

  // live preview of the pack-out split (server recomputes authoritatively)
  const kg = Math.min(Math.max(0, Number(kegGal) || 0), batch.batch_gal);
  const bottleGal = Math.max(0, batch.batch_gal - kg);
  const prevBottles = Math.floor((bottleGal * 128) / oz);
  const prevKegStr = kg > 0 ? kegLabel(allocKegs(kg, kegInv)) : "";

  const planIt = async () => {
    if (!supabase || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await authedFetch("/api/agents/loadout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch_id: batch.id, bottle_oz: oz, keg_gal: kg, vehicle }) });
      const j = await r.json();
      if (!j.ok) setErr(j.error || "Couldn't plan the loadout."); else setRes(j);
    } catch (e) { setErr(errorMessage(e)); }
    setBusy(false);
  };

  return (
    <>
    <Sheet open onClose={onClose} label="Bottle loadout" header={<div style={{ display: "flex", alignItems: "center" }}><div className="dp-head-l"><div className="dp-eyebrow"><Icon name="package" /> Bottle loadout · pack &amp; transport</div><div className="dp-title">{batch.recipe_name || "Batch"} · {batch.batch_gal} gal</div></div><CloseButton onClick={onClose} /></div>}>
          {!res ? (
            <>
              <div className="dp-hint">Split the {batch.batch_gal} gal between keg and bottles — I&apos;ll work out the counts, UVDTF labels, and the pack plan.</div>
              <div className="ts-chips" style={{ marginTop: 12 }}>
                {[10, 16].map((n) => <button key={n} type="button" className={`k-chip${oz === n ? " on" : ""}`} aria-pressed={oz === n} onClick={() => setOz(n)}>{n} oz bottles</button>)}
              </div>
              <div className="prod-grid" style={{ marginTop: 8 }}>
                <label className="prod-f"><span>To keg (gal)</span><input type="number" min="0" step="0.5" max={String(batch.batch_gal)} value={kegGal} onChange={(e) => setKegGal(e.target.value)} /></label>
                <label className="prod-f"><span>Vehicle (optional)</span><input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="SUV, 3-hr drive" /></label>
              </div>
              <div className="brew-spec" style={{ marginTop: 10 }}>Pack-out: <b>{prevBottles}</b> × {oz}oz bottles · <b>{prevBottles}</b> UVDTF labels{prevKegStr ? <> · <b>{prevKegStr}</b></> : ""}</div>
              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="btn-pri" onClick={planIt} disabled={busy}>{busy ? "Planning…" : <><Icon name="package" /> Plan the pack</>}</button>
              </div>
            </>
          ) : (
            <>
              <div className="brew-spec"><b>{res.bottles}</b> × {res.bottle_oz}oz bottles · <b>{res.uvdtf_labels}</b> UVDTF labels{res.label_order > res.uvdtf_labels ? ` (order ~${res.label_order} w/ spares)` : ""}{res.keg_plan?.length ? <> · <b>{res.keg_plan.map((k: any) => `${k.count}× ${k.capacity_gal}gal`).join(" + ")}</b> ({res.keg_gal} gal){res.keg_shortfall_gal > 0.01 ? ` · short ${res.keg_shortfall_gal.toFixed(1)}gal` : ""}</> : res.kegs ? <> · <b>{res.kegs}</b> keg{res.kegs === 1 ? "" : "s"} ({res.keg_gal} gal)</> : ""}</div>
              {res.containers?.length > 0 && (
                <><div className="brew-block-h">Pack them in</div><div className="brew-ing">{res.containers.map((c: any, i: number) => <div key={i} className="brew-ing-row"><b>{c.count}×</b><span>{c.what}{c.note ? ` — ${c.note}` : ""}</span></div>)}</div></>
              )}
              {res.ice && <div className="brew-when">{res.ice}</div>}
              {res.layout?.length > 0 && (<><div className="brew-block-h">How to pack a cooler</div><ol className="ts-steps">{res.layout.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol></>)}
              {res.vehicle && <div className="brew-when"><Icon name="compass" /> {res.vehicle}</div>}
              {res.checklist?.length > 0 && (<><div className="brew-block-h">Before you pull off</div><ul className="brew-checks">{res.checklist.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></>)}
              <Button type="button" kind="secondary" wide className="mt-3" onClick={() => setAssignTask(true)}>Assign this pack-out as a task <Icon name="arrowRight" /></Button>
              <div className="prod-actions" style={{ marginTop: 12 }}>
                <button type="button" className="note-arch" onClick={() => setRes(null)}>‹ Change</button>
                <button type="button" className="btn-pri" onClick={onClose}>Done</button>
              </div>
            </>
          )}
    </Sheet>
      {assignTask && (
        <AssignTaskSheet
          defaultTitle={`Pack out: ${batch.recipe_name || "Batch"} · ${res?.bottles ?? prevBottles}×${res?.bottle_oz ?? oz}oz${res?.uvdtf_labels ? ` + ${res.uvdtf_labels} labels` : ""}`}
          eventId={batch.event_id}
          dueOn={batch.needed_by ? batch.needed_by.slice(0, 10) : null}
          category="ops"
          onClose={() => setAssignTask(false)}
        />
      )}
    </>
  );
}

function BrewSheet({ recipe, events, stops, vessels, inv, initialTarget, onClose, onDone }: { recipe: Recipe; events: Ev[]; stops: St[]; vessels: Vessel[]; inv: InvItem[]; initialTarget?: string; onClose: () => void; onDone: () => void }) {
  // ── THE SHEET ASKS WHAT A COOK KNOWS (2026-10-03) ───────────────────────────────────────────
  // Ryan, from the sheet on his phone: "I had no idea I could select a different metric. Nothing
  // on pages are insightful. From a new operator user experience it's overwhelming, not helpful.
  // I couldn't put in a batch size — or how many drinks you want to serve. Based on questions the
  // metrics should show." 5 out of 10.
  //
  // It asked for a vessel first, then how many of them, then a number of gallons beside a unit
  // menu that was painted as stripes (the day theme's `background` shorthand tiled the chevron),
  // and explained its own rounding under that. The order the code was written in. A cook knows
  // one thing walking up to this sheet: how many drinks are needed. Everything else — gallons,
  // grams, which vessel, how many of them, when to start — is a consequence, and this sheet now
  // treats it as one. One question, one live answer card, one optional "what for".
  //
  // Gallons stay the number the batch is BUILT from (the planner and the saved row take gallons);
  // drinks, gallons and coffee are three ways of saying the same batch, and the one showing is
  // the one the cook chose to think in.
  const y = Number(recipe.yield_factor) || undefined;
  const sizeBy = primarySizing(sizingOptions(recipe.ingredients, recipe.base_water_gal));
  const floor = smallestBatch({ ingredients: recipe.ingredients, baseWaterGal: recipe.base_water_gal, yieldFactor: recipe.yield_factor, vesselMinGal: null });
  const [gal, setGal] = useState<number>(() => Math.max(floor.gal, Number(vessels[0]?.capacity_gal) || floor.gal));
  type Unit = "drinks" | "gal" | "ing";
  const [unit, setUnit] = useState<Unit>("drinks");
  // What is typed, as typed — the number box must not fight the thumb mid-entry ("2." → "2").
  const [typed, setTyped] = useState<string | null>(null);
  const drinks = bottlesFor(gal, y);
  const coffeeG = sizeBy ? Math.round(ingredientForGallons(gal, sizeBy.perGal)) : null;
  const shown = typed ?? (unit === "drinks" ? String(drinks) : unit === "gal" ? String(+gal.toFixed(2)) : String(coffeeG ?? ""));
  const fromTyped = (u: Unit, v: string) => {
    const n = parseFloat(v);
    if (!Number.isFinite(n) || n <= 0) return;
    // Drinks round UP so nobody is short; coffee rounds DOWN so it never asks for a bag that is
    // not on the shelf; gallons are taken to the brewable step.
    if (u === "drinks") setGal(gallonsForBottles(n, y));
    else if (u === "gal") setGal(stepUpGal(n));
    else if (sizeBy) setGal(stepDownGal(gallonsFromIngredient(n, sizeBy.perGal)));
  };
  const nudge = (dir: 1 | -1) => {
    setTyped(null);
    if (unit === "drinks") setGal(gallonsForBottles(Math.max(1, drinks + dir), y));
    else if (unit === "gal") setGal(Math.max(BREW_STEP_GAL, stepUpGal(gal + dir * BREW_STEP_GAL * 5)));   // a quarter gallon a tap; the step itself is too fine for a thumb
    else if (sizeBy && coffeeG !== null) setGal(stepDownGal(gallonsFromIngredient(Math.max(1, coffeeG + dir * 50), sizeBy.perGal)));
  };

  // THE VESSEL FOLLOWS THE BATCH. The fewest vessels that hold it, the best-filled among equals;
  // a tap on another vessel pins it and the count follows the batch from then on.
  const [pinned, setPinned] = useState<string | null>(null);
  const planned = vesselPlan(gal, vessels);
  const vessel = (pinned ? vessels.find((v) => v.id === pinned) : null) ?? planned?.vessel ?? null;
  const vesselCount = vessel ? Math.max(1, Math.ceil(gal / Number(vessel.capacity_gal) - 1e-9)) : 1;
  const vesselLabel = vessel ? `${vesselCount > 1 ? `${vesselCount}× ` : ""}${vessel.name} (${vessel.capacity_gal} gal${vesselCount > 1 ? ` ea` : ""})` : undefined;
  const fit = vessel ? vesselFit(gal, vessel.capacity_gal, vesselCount, vessel.min_gal) : null;
  const capacity = vessel ? Number(vessel.capacity_gal) * vesselCount : 0;
  // The floor WITH the vessel's measured minimum, now that one is chosen.
  const floorHere = smallestBatch({ ingredients: recipe.ingredients, baseWaterGal: recipe.base_water_gal, yieldFactor: recipe.yield_factor, vesselMinGal: vessel?.min_gal != null ? Number(vessel.min_gal) * vesselCount : null });
  const underFloor = gal + 1e-9 < floorHere.gal;

  // What the batch takes, live — the same scaler the planner saves with, so the card and the
  // saved row cannot differ.
  const factor = Number(recipe.base_water_gal) > 0 ? gal / Number(recipe.base_water_gal) : 1;
  const scaled = scaleIngredients(recipe.ingredients, factor);
  const water = pourable(gal);
  const isWater = (n: string) => /\bwater\b/i.test(n);
  const isCoffee = (n: string) => !!sizeBy && n.trim() === sizeBy.name;
  const rest = scaled.filter((i) => !isWater(i.name) && !isCoffee(i.name) && i.scales);
  const fixed = scaled.filter((i) => !i.scales);
  const hours = Number(recipe.extraction_hours) || 0;
  // Coffee on the shelf, beside the coffee this batch takes — the same name match the batch list
  // uses for its "short" flags, and only when the units agree (grams against grams; a bag is not a
  // number). Nothing to say when inventory has no line for it.
  const onHand = (() => {
    if (!sizeBy || coffeeG === null) return null;
    const item = inv.find((i) => nameMatch(i.name, sizeBy.name));
    const u = (x?: string | null) => (x ?? "").toLowerCase().trim().replace(/s$/, "");
    if (!item || item.qty == null || u(item.unit) !== u(sizeBy.unit)) return null;
    const have = Number(item.qty);
    if (!Number.isFinite(have)) return null;
    return { have, batches: coffeeG > 0 ? Math.floor(have / coffeeG) : 0, short: Math.max(0, coffeeG - have) };
  })();

  // Upcoming only, soonest first. Nothing preselected: the first pick drives the back-schedule,
  // so a default would silently decide when to start brewing. A batch opened from an event or a
  // stop arrives with that one chosen, because that IS a choice the person made on the way in.
  const today = localToday();
  const upcomingEvents = events.filter((e) => e.day && e.day >= today);
  const upcomingStops = stops.filter((s) => s.status !== "done");
  const [targets, setTargets] = useState<string[]>(() => initialTarget ? [initialTarget] : []);
  const primaryEvent = (() => { const t = targets[0]; if (!t || !t.startsWith("e:")) return null; return upcomingEvents.find((e) => `e:${e.id}` === t) ?? null; })();
  // A headcount the event already knows is a suggestion, never a default: it sets the chip, not
  // the batch. One drink a head is the starting guess a cook adjusts, not a forecast.
  const expected = primaryEvent ? (Number(primaryEvent.expected_attendance) || Number(primaryEvent.going_count) || 0) : 0;

  // Quick picks: round numbers, plus what a full vessel pours — the number a cook ends up learning
  // anyway, taught here instead of discovered.
  const picks: { label: string; drinks: number; sub?: string }[] = [
    ...(expected > 0 ? [{ label: `${expected}`, drinks: expected, sub: `${primaryEvent?.title || "the event"} expects` }] : []),
    { label: "12", drinks: 12 }, { label: "24", drinks: 24 },
    ...vessels.slice().sort((a, b) => Number(a.capacity_gal) - Number(b.capacity_gal)).map((v) => ({ label: `${bottlesFor(Number(v.capacity_gal), y)}`, drinks: bottlesFor(Number(v.capacity_gal), y), sub: `a full ${v.name}` })),
  ].filter((p, i, a) => p.drinks > 0 && a.findIndex((q) => q.drinks === p.drinks) === i);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<any | null>(null);
  const [saved, setSaved] = useState(false);

  const call = async (payload: any) => {
    const [tt, tid] = (targets[0] || "").split(":"); // primary target drives the back-schedule date
    const owner = targets[0] ? (tt === "s" ? { stop_id: tid } : { event_id: tid }) : {};
    const r = await authedFetch("/api/agents/brew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe_id: recipe.id, batch_gal: +gal.toFixed(2) || 1, ...owner, vessel: vesselLabel, ...payload }) });
    return r.json();
  };
  const planIt = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    const j = await call({}).catch((e) => ({ ok: false, error: errorMessage(e) }));
    if (!j.ok) setErr(j.error || "Couldn't plan the batch."); else setRes(j);
    setBusy(false);
  };
  const save = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    const j = await call({ commit: { og: res?.spec } }).catch((e) => ({ ok: false, error: errorMessage(e) }));
    if (!j.ok) { setErr(j.error || "Couldn't save."); setBusy(false); return; }
    // Link the new batch to EVERY event/stop it serves (many-to-many).
    if (j.batch_id && targets.length && supabase) {
      const links = targets.map((t) => { const [k, id] = t.split(":"); return k === "s" ? { batch_id: j.batch_id, stop_id: id } : { batch_id: j.batch_id, event_id: id }; });
      await supabase.from("brew_batch_links").insert(links);
    }
    setSaved(true);
    setBusy(false);
  };

  // What the floor means to a cook, by the reason that binds — the engineering note stays on the
  // function for the people who need it.
  const floorWords = floorHere.reason === "vessel" && vessel
    ? `${vessel.name} can't brew less than ${floorHere.gal.toFixed(2)} gal — that's ${floorHere.servings} drinks.`
    : floorHere.reason === "measurement"
      ? `Under ${floorHere.servings} drinks the ${floorHere.limiting?.name ?? "coffee"} is too little to weigh on a 1 g scale.`
      : `${floorHere.servings} drinks is the smallest batch worth making.`;
  const unitName = unit === "drinks" ? "drinks" : unit === "gal" ? "gal of water" : `${sizeBy ? sizeBy.unit : "g"} of coffee`;

  return (
    <Sheet open onClose={onClose} label="Plan a brew" header={<div style={{ display: "flex", alignItems: "center" }}><div className="dp-head-l"><div className="dp-eyebrow">Brew</div><div className="dp-title">{recipe.name}</div></div><CloseButton onClick={onClose} /></div>}>
          {saved ? (
            <div className="eg-done">
              <div className="eg-done-h"><Icon name="check" /> Batch added to the brew schedule</div>
              <div className="dp-hint" style={{ marginTop: 8 }}>Find it under Brew — advance its status as you go and log the Signal Score when it&apos;s ready.</div>
              <div className="prod-actions" style={{ marginTop: 12 }}><span /><button type="button" className="btn-pri" onClick={onDone}>Done</button></div>
            </div>
          ) : !res ? (
            <>
              {/* 1. THE QUESTION */}
              <div className="bq">
                <label className="bq-q" htmlFor="bq-n">How many drinks do you need?</label>
                <div className="bq-num">
                  <button type="button" className="k-icon-btn" onClick={() => nudge(-1)} aria-label="Fewer">−</button>
                  <input id="bq-n" type="number" inputMode={unit === "drinks" ? "numeric" : "decimal"} min="0" step={unit === "drinks" ? "1" : unit === "gal" ? String(BREW_STEP_GAL) : "10"}
                         value={shown}
                         onChange={(e) => { setTyped(e.target.value); fromTyped(unit, e.target.value); }}
                         onBlur={() => setTyped(null)} />
                  <button type="button" className="k-icon-btn" onClick={() => nudge(1)} aria-label="More">+</button>
                  <span className="bq-unit">{unitName}</span>
                </div>
                <div className="bq-picks" role="group" aria-label="Quick sizes">
                  {picks.map((p) => (
                    <button key={p.label + (p.sub ?? "")} type="button" className={`k-chip${drinks === p.drinks ? " on" : ""}`} aria-pressed={drinks === p.drinks} onClick={() => { setTyped(null); setGal(gallonsForBottles(p.drinks, y)); }}>
                      <b>{p.label}</b>{p.sub ? <span className="bq-pick-sub">{p.sub}</span> : null}
                    </button>
                  ))}
                </div>
                {/* Three ways to say one batch. Pills, not a menu: a menu looked like a text box with
                    stripes, and nobody knew it opened. */}
                <div className="k-seg bq-units" role="tablist" aria-label="Size it by">
                  {([["drinks", "Drinks"], ["gal", "Gallons"], ...(sizeBy ? [["ing", `Coffee (${sizeBy.unit})`]] : [])] as [Unit, string][]).map(([u, label]) => (
                    <button key={u} type="button" role="tab" aria-selected={unit === u} className={`k-seg-opt${unit === u ? " on" : ""}`} onClick={() => { setTyped(null); setUnit(u); }}>{label}</button>
                  ))}
                </div>
              </div>

              {/* 2. THE ANSWER, LIVE */}
              <div className="brew-spec bq-card" aria-live="polite">
                <div className="bq-card-h">What this batch takes</div>
                <dl className="bq-rows">
                  <div className="bq-row"><dt>Pours</dt><dd><b>{drinks} drink{drinks === 1 ? "" : "s"}</b> <span className="bq-dim">· {SERVE_OZ} oz each</span></dd></div>
                  <div className="bq-row"><dt>Water</dt><dd><b>{water.display}</b> <span className="bq-dim">· {+gal.toFixed(2)} gal{water.withOz.includes("about") ? ", about" : ","} {water.flOz} fl oz</span></dd></div>
                  {sizeBy && coffeeG !== null && (
                    <div className="bq-row"><dt>Coffee</dt><dd>
                      <b>{cookQuantity(coffeeG, sizeBy.unit).display}</b> <span className="bq-dim">· coarse, weighed on a level scale</span>
                      {onHand && (onHand.short > 0
                        ? <span className="bq-short"><br />Only {onHand.have.toLocaleString()} {sizeBy.unit} on hand — short {onHand.short.toLocaleString()} {sizeBy.unit}.</span>
                        : <span className="bq-dim"><br />{onHand.have.toLocaleString()} {sizeBy.unit} on hand — enough for {onHand.batches} batch{onHand.batches === 1 ? "" : "es"} like this.</span>)}
                    </dd></div>
                  )}
                  {rest.length > 0 && (
                    <div className="bq-row"><dt>Also</dt><dd>
                      {rest.map((i, n) => {
                        // "10 sticks · Organic Ceylon cinnamon sticks" says sticks twice and organic once
                        // too often for a line read mid-pour. The quantity leads; the name follows it,
                        // without the prefix and without repeating its own unit; a note in parentheses
                        // ("add after filtration") stays, dimmed — it is the one part that is an instruction.
                        const note = (i.name.match(/\(([^)]*)\)/) || [])[1];
                        const bare = i.name.replace(/\s*\([^)]*\)\s*/g, " ").replace(/^organic\s+/i, "").trim();
                        const q = cookQuantity(i.qty, i.unit);
                        const unitWord = i.unit.trim().toLowerCase();
                        const endsWithUnit = unitWord && bare.toLowerCase().endsWith(unitWord);
                        return <span key={i.name} className="bq-line">{n > 0 && <br />}<b>{endsWithUnit ? String(q.primary).replace(new RegExp(`\\s*${unitWord}$`, "i"), "") : q.display}</b> {bare}{note ? <span className="bq-dim"> · {note}</span> : null}</span>;
                      })}
                    </dd></div>
                  )}
                  {fixed.length > 0 && <div className="bq-row"><dt>Each brew</dt><dd>{fixed.map((i) => `${cookQuantity(i.qty, i.unit).display} ${i.name.replace(/^organic\s+/i, "")}`).join(" · ")}</dd></div>}
                  {hours > 0 && <div className="bq-row"><dt>Time</dt><dd><b>{hours} h</b> <span className="bq-dim">· cold extraction{targets[0] ? ` — scheduled to be ready the morning of ${primaryEvent ? (primaryEvent.title || primaryEvent.day_label || "the event") : upcomingStops.find((st) => `s:${st.id}` === targets[0])?.name || "the stop"}` : ""}</span></dd></div>}
                </dl>
                {underFloor && <p className="bq-note"><Icon name="info" /> {floorWords}</p>}
              </div>

              {/* 3. THE VESSEL, AS A CONSEQUENCE */}
              {vessels.length > 0 && (
                <div className="bq">
                  <div className="bq-q">Brew it in</div>
                  <div className="ts-chips" style={{ marginBottom: 0 }}>
                    {vessels.map((v) => {
                      const n = Math.max(1, Math.ceil(gal / Number(v.capacity_gal) - 1e-9));
                      const on = vessel?.id === v.id;
                      return (
                        <button key={v.id} type="button" className={`k-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setPinned(v.id)}>
                          {on && <><Icon name="check" /> </>}<Icon name="jar" /> {n > 1 ? `${n} × ` : ""}{v.name}<span className="bq-pick-sub">holds {bottlesFor(Number(v.capacity_gal), y)} drinks</span>
                        </button>
                      );
                    })}
                  </div>
                  {vessel && fit && (
                    <p className={`bq-fit${fit.verdict === "over" ? " warn" : fit.verdict === "fits" ? "" : " ask"}`}>
                      {fit.verdict === "fits" && (fit.pct >= 99 ? `Fills ${vesselCount > 1 ? `all ${vesselCount}` : "it"} exactly.` : `Fills ${vesselCount > 1 ? `${vesselCount} × ${vessel.name}` : vessel.name} to ${fit.pct}% — ${+(capacity - gal).toFixed(2)} gal of room.`)}
                      {fit.verdict === "over" && `That's ${fit.overBy} gal more than ${vesselCount > 1 ? `${vesselCount} × ` : ""}${vessel.name} holds.`}
                      {fit.verdict === "under" && `${vessel.name} can't brew less than ${fit.minGal} gal — that's ${bottlesFor(fit.minGal, y)} drinks.`}
                      {fit.verdict === "shallow" && `Only ${fit.pct}% of ${vessel.name} — check the grounds stay under water, and record the real minimum once you know it.`}
                    </p>
                  )}
                </div>
              )}

              {/* 4. WHAT FOR */}
              <div className="bq">
                <div className="bq-q">What&apos;s it for? <span className="bq-opt">optional · the first pick sets when to start</span></div>
                <div className="ts-chips" style={{ marginBottom: 0 }}>
                  {upcomingEvents.map((ev) => { const k = `e:${ev.id}`; const on = targets.includes(k); return <button key={ev.id} type="button" className={`k-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setTargets((p) => on ? p.filter((x) => x !== k) : [...p, k])}>{on && <><Icon name="check" /> </>}<Icon name="event" /> {ev.title || ev.day_label}{ev.day ? <span className="bq-pick-sub">{fmtDate(ev.day)}</span> : null}</button>; })}
                  {upcomingStops.map((s) => { const k = `s:${s.id}`; const on = targets.includes(k); return <button key={s.id} type="button" className={`k-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setTargets((p) => on ? p.filter((x) => x !== k) : [...p, k])}>{on && <><Icon name="check" /> </>}<Icon name="truck" /> {s.name}</button>; })}
                  {upcomingEvents.length === 0 && upcomingStops.length === 0 && <span className="dp-hint">No upcoming events or stops yet.</span>}
                </div>
              </div>
              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="btn-pri" onClick={planIt} disabled={busy || !(gal > 0)}>{busy ? "Scaling…" : "Scale + schedule"}</button>
              </div>
            </>
          ) : (
            <>
              <div className="brew-spec">{res.spec || recipe.target_spec} · <b>{res.batch_gal} gal</b> → ~{res.servings} servings ({res.serve_oz}oz)</div>
              {res.brew_note && <div className="dp-hint" style={{ marginTop: 0 }}>{res.brew_note}</div>}

              <div className="brew-block-h">Exact recipe — scaled ×{res.factor}</div>
              {/* Same component as BrewSteps' "What you need" (2026-10-01). This used to render
                  `{qty}{unit}` straight out of the recipe, so a gram figure never showed ounces and
                  nothing said to level the scale — and BrewSteps had the identical bug written out
                  a second time. One home now states a quantity to a cook. */}
              <CookNeedList ingredients={(res.scaled ?? []) as CookIngredient[]} />

              {res.brew_date && <div className="brew-when">Start brewing <b>{fmtDate(res.brew_date)}</b> · ready <b>{fmtTs(res.ready_at)}</b></div>}

              {Array.isArray(res.steps) && res.steps.length > 0 && (
                <><div className="brew-block-h">Method</div><ol className="ts-steps">{res.steps.map((s: string, n: number) => <li key={n}>{s}</li>)}</ol></>
              )}
              {Array.isArray(res.checks) && res.checks.length > 0 && (
                <><div className="brew-block-h">Quality checks</div><ul className="brew-checks">{res.checks.map((s: string, n: number) => <li key={n}>{s}</li>)}</ul></>
              )}
              {Array.isArray(res.inventory_flags) && res.inventory_flags.length > 0 && (
                <div className="brew-flags"><b>Stock to check:</b> {res.inventory_flags.join(" · ")}</div>
              )}

              {err && <div className="dp-err">{err}</div>}
              <div className="prod-actions" style={{ marginTop: 14 }}>
                <button type="button" className="note-arch" onClick={() => setRes(null)} disabled={busy}>‹ Change</button>
                <button type="button" className="btn-pri" onClick={save} disabled={busy}>{busy ? "Saving…" : "Add to schedule"}</button>
              </div>
            </>
          )}
    </Sheet>
  );
}
