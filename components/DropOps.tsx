"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { useAppStable } from "./AppProvider";
import { SectionHeader, InfoRow } from "@/components/kit";
import { FLAVORS, dropDateKey, mixSummary, dollars, type GlassPath, type Mix } from "@/lib/orderAhead";
import { gallonsForBottles, flavorDemand } from "@/lib/brewMath";
import { boardSaturday, nextDropDay } from "@/lib/dropDate";
import { addDays, clockTime, dayKey, dayWithDate, etToday } from "@/lib/dates";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import EmptyState from "./EmptyState";
import Icon from "@/components/Icon";
import { useConfirm } from "@/components/ConfirmSheet";
import { useAuth } from "./AuthProvider";
import { canOf } from "@/lib/roles";
import { canCollect, canUndo, collectPayment, undoCollection, isSettled, paidHow, viaOf, settleOf, VIA_CHIP, VIA_UNDO, type CollectVia, type OnTheHouse } from "@/lib/collect";
import { useCollectSheet } from "./CollectSheet";
import FoldCard from "@/components/crew/FoldCard";
import { dueLead, type PickupFeed } from "@/lib/dueNext";
import ReserveClaims from "./crew/ReserveClaims";
import Said from "./Said";
import { keyed } from "@/lib/dbTypes";
import { plainFailure, failureWords } from "@/lib/failureWords";
import { downloadCsv } from "@/lib/csv";
import { moneyPlain } from "@/lib/money";

// DROP OPS — the order-ahead brew sheet + pickup checklist for Saturday's drop. Lives in the admin
// "Now" section right under the kitchen pass (and pops out of reservation alerts), so walk-up orders
// and reservations are one surface. Realtime like the KDS; staff-gated by RLS (0119).
// Fulfillment: staff can move a reservation to next week's drop or cancel it (canceled rows keep
// their id for the audit trail and drop out of totals; a PAID cancel flags the Square refund).
// Planning: one tap turns the brew sheet into planned brew_batches rows for Friday — sized from the
// bottle counts (production is spec'd in 10-oz servings, 0079), linked to the drop by drop_date, and
// picked up by the existing brew windows/timers from there. Fetch state via useAsyncData — a failed
// load is a real error now, not a silent "No reservations yet for this drop."
type PackStage = "reserved" | "preparing" | "ready" | "en_route" | "picked_up";
type DropOrder = {
  id: string; name: string; phone: string | null; size: number; glass: GlassPath;
  mix: Mix; total_cents: number; paid: boolean; drop_date: string; picked_up: boolean; bottles_returned: boolean;
  stage?: PackStage | null; canceled_at?: string | null;
  batch_id?: string | null;   // recall traceability (0261): which brew filled this pack
  // Money (0341): payment_id = paid online; collected_* = taken at the window, absent before 0341.
  payment_id?: string | null; payment_status?: string | null;
  collected_via?: string | null; collected_at?: string | null; collected_by?: string | null;
};
type PlannedBatch = { id: string; recipe_name: string | null; batch_gal: number; status: string };
// history: null when it was not read — the fold shut, the brief face (R19 review, third pass: never "no past drops" for a read not made).
type Board = { rows: DropOrder[]; batches: PlannedBatch[]; history: DropOrder[] | null; upcoming: DropOrder[] };

// The fulfillment path a reserved pack walks; the crew advances it, the customer sees it live.
const PACK_STAGES: { key: PackStage; label: string; next: string }[] = [
  { key: "reserved", label: "Reserved", next: "Start preparing" },
  { key: "preparing", label: "Preparing", next: "Mark ready" },
  { key: "ready", label: "Ready", next: "Hand off →" },
  { key: "en_route", label: "En route", next: "Mark picked up" },
  { key: "picked_up", label: "Picked up", next: "" },
];
const stageIndex = (s: PackStage | null | undefined) => Math.max(0, PACK_STAGES.findIndex((x) => x.key === (s ?? "reserved")));



// Two faces: `brief` is the Now screen's prep face (what to brew, what money, one progress line —
// tapping it opens Service mode); full is the working face (checklist, upcoming, history) and
// lives in Service mode only, so the same list never renders on two screens.
// onDue: the drop's day, for Live Ops' Due next to put the runs in order (2026-10-11).
// onRows: the drop's packs as this card read them, for Due next's one list (2026-10-11, the dispatch round).
export default function DropOps({ brief = false, onOpen, canPlan = false, onDue, onRows }: { brief?: boolean; onOpen?: () => void; canPlan?: boolean; onDue?: (day: string | null) => void; onRows?: (feed: PickupFeed) => void } = {}) {
  const confirm = useConfirm();
  const { toast } = useAppStable();
  const { user, profile } = useAuth();
  const me = user?.id ?? null;
  const admin = canOf(profile).admin;
  const [askCollect, collectSheet] = useCollectSheet();
  const [busy, setBusy] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [listOpen, setListOpen] = useState<boolean | null>(null); // null = open on drop day only
  // The drop = the one the board is working (lib/dropDate, shared with the home's number): today's stop all day
  // until it is marked done, else the truck's next scheduled stop, else this week's Saturday.
  // READ AGAIN, NOT ONCE (2026-10-11). It was read when the card mounted and never again, so a board left open kept
  // the day it opened on: through a route edit, past the drop, past midnight. As a loader of `stops` it is read again
  // when the route changes, when the app comes back after a while, on pull to refresh, and when the crew page's day
  // turns over (lib/realtime refreshLive). A read that fails keeps the day on screen rather than guess the cadence.
  // `at` is the stop's start when the drop came from one — Due next says the drop's time (2026-10-11); null on the
  // Saturday rule, which knows the day only.
  const [drop, setDrop] = useState<{ iso: string; label: string; at: string | null }>(() => {
    const s = boardSaturday();
    return { iso: dropDateKey(s), label: s.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), at: null };
  });
  const resolveDrop = useCallback(async () => {
    if (!supabase) return;
    const d = await nextDropDay(supabase);
    if (d.error) return;
    const label = d.at.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const at = d.fromStop ? d.at.toISOString() : null;
    setDrop((cur) => (cur.iso === d.iso && cur.label === label && cur.at === at ? cur : { iso: d.iso, label, at }));
  }, []);
  useRealtimeTable("stops", resolveDrop, { loadOnMount: true });
  const dropISO = drop.iso;
  const satLabel = drop.label;
  useEffect(() => { onDue?.(dropISO); }, [dropISO, onDue]);
  // Humanized, unambiguous drop date for the heading — "This Sat · Jul 18" inside the week, "Sat,
  // Oct 10" outside it (lib/dates dayWithDate). It was `${relativeDay} · ${date}`, which read "Oct 10
  // · Oct 10's drop" the moment the drop was a week out. satLabel stays the raw weekday label the
  // toasts / confirms / alert bodies below already read.
  const dropWhen = dayWithDate(dropISO);

  // The brief face (the Now screen, read again on every change to a pack or a batch during service) draws neither the past
  // drops nor the upcoming ones, so it reads neither: two of its four reads — up to three hundred whole rows — were for
  // folds it never shows (R19 — the 10/10 audit, performance F6). The full face — the Pass rail during service among
  // them — reads the past drops only while their fold is open (R19 review): two hundred rows for a fold that is shut.
  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { rows: [], batches: [], history: null, upcoming: [] };
    const none = Promise.resolve({ data: [] as DropOrder[], error: null });
    const [r, b, h, u] = await Promise.all([
      supabase.from("drop_orders").select("*").eq("drop_date", dropISO).is("canceled_at", null).order("created_at"),
      supabase.from("brew_batches").select("id, recipe_name, batch_gal, status").eq("drop_date", dropISO).order("recipe_name"),
      brief || !histOpen ? none : supabase.from("drop_orders").select("*").lt("drop_date", dropISO).order("drop_date", { ascending: false }).order("created_at").limit(200),
      brief ? none : supabase.from("drop_orders").select("*").gt("drop_date", dropISO).is("canceled_at", null).order("drop_date").order("created_at").limit(100),
    ]);
    const firstErr = [r, b, h, u].find((x) => x.error)?.error;
    if (firstErr) throw new Error(firstErr.message);
    return {
      rows: (r.data as unknown as DropOrder[]) ?? [],   // mix is jsonb to the database; its shape is the app's (Mix)
      batches: (b.data as PlannedBatch[]) ?? [],
      history: brief || !histOpen ? null : (h.data as DropOrder[]) ?? [],
      upcoming: (u.data as DropOrder[]) ?? [],
    };
  }, [dropISO, brief, histOpen]);
  const board = useAsyncData(loader, [dropISO, brief, histOpen]);
  const { reload } = board;
  useRealtimeTable("drop_orders", reload);
  useRealtimeTable("brew_batches", reload);
  // Due next's list is this read — the same drop, the same packs — handed up as it lands (2026-10-11).
  const dropAt = drop.at;
  useEffect(() => {
    onRows?.({ status: board.status, day: dropISO, at: dropAt, rows: board.data?.rows ?? [] });
  }, [board.status, board.data, dropISO, dropAt, onRows]);

  const rows = board.data?.rows ?? [];
  const upcoming = board.data?.upcoming ?? [];
  // The past drops as last read — null while the fold's own read has not answered (a reload that failed keeps the board,
  // and the fold says it couldn't read them: not "No past drops.").
  const history = board.data?.history ?? null;
  const batches = board.data?.batches ?? [];

  // Each of these three used to write and reload without looking at the answer, so a refused write
  // (a dropped signal, a lapsed session) left the board showing the tap as done until the next
  // reload contradicted it. A write that did not land says so.
  const toggle = async (id: string, key: "picked_up" | "bottles_returned", val: boolean) => {
    if (!supabase) return;
    const { error } = await supabase.from("drop_orders").update(keyed(key, val)).eq("id", id);
    if (error) toast(failureWords(error, "Didn't save"), "error");
    reload();
  };
  // ── MONEY AT THE WINDOW (2026-10-04, 0341) ─────────────────────────────────────────────────────
  // A pack reserved "pay at pickup" could never be marked paid — nothing in the app wrote paid but
  // the online reserve — so "still to collect at the window" counted packs paid an hour earlier.
  const takeMoney = async (o: DropOrder, how: CollectVia | OnTheHouse): Promise<boolean> => {
    if (!supabase) return false;
    const { via, reason } = settleOf(how);   // on the house (0432): covered, with an owner's reason
    const res = await collectPayment(supabase, "pickup", o.id, via, reason);
    if (res.error) { toast(`Couldn't record it — ${plainFailure(res.error)}`, "error"); reload(); return false; }
    // Each way said as what it was (R27: covered was said "on the card reader").
    const said = reason ? "on the house" : via === "cash" ? "cash" : via === "card_reader" ? "on the card reader" : "covered by their free cup or credit";
    toast(res.already ? `${o.name} had already paid — nothing taken` : `${o.name} — ${dollars(o.total_cents / 100)} ${said}`);
    reload();
    return true;
  };
  const collect = async (o: DropOrder) => {
    const how = await askCollect({ who: o.name, cents: o.total_cents, house: admin });
    if (how && how !== "unpaid") await takeMoney(o, how);
  };
  const undoTake = async (o: DropOrder) => {
    if (!supabase) return;
    const via = viaOf(o) ?? "card_reader";
    if (!(await confirm({ title: `Undo ${VIA_UNDO[via]} — ${dollars(o.total_cents / 100)} from ${o.name}?`, body: "Only if it wasn't settled that way. You can collect it again after.", confirmLabel: "Undo it" }))) return;
    const res = await undoCollection(supabase, "pickup", o.id);
    if (res.error) toast(`Couldn't undo it — ${plainFailure(res.error)}`, "error");
    else toast(res.already ? "Nothing to undo — it wasn't taken at the window" : `${o.name} — back to unpaid`);
    reload();
  };
  // Advance (or jump) a pack's fulfillment stage. The DB trigger keeps picked_up in sync, and the
  // customer's pack card updates live (drop_orders is realtime). Handing a pack over is when the
  // money is asked about — whichever button got it there.
  const setStage = async (o: DropOrder, stage: PackStage) => {
    if (!supabase) return;
    if (stage === "picked_up" && canCollect(o)) {
      const how = await askCollect({ who: o.name, cents: o.total_cents, handOff: true, house: admin });
      if (!how) return;
      if (how !== "unpaid" && !(await takeMoney(o, how))) return;
    }
    const { error } = await supabase.from("drop_orders").update({ stage }).eq("id", o.id);
    if (error) toast(failureWords(error, "Didn't save"), "error");
    reload();
  };
  // Recall traceability (0261, blind-spot round): stamp WHICH brew filled the pack at pack-out.
  // One tap per pack; "which customers got batch X?" becomes a query instead of a shrug.
  const setBatch = async (id: string, batchId: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("drop_orders").update({ batch_id: batchId || null }).eq("id", id);
    if (error) toast(failureWords(error, "Didn't save"), "error");
    reload();
  };

  // Move a reservation to the NEXT drop (customer can't make it — nothing is lost). "Next" means
  // the truck's next scheduled stop after this drop — route truth, same resolution as the sheet
  // itself — falling back to +7 days only when nothing is on the calendar yet. The moved pack
  // stays visible under "Upcoming drops" below, with a one-tap way back.
  const pushNextWeek = async (o: DropOrder) => {
    if (!supabase) return;
    const { data: st } = await supabase.from("stops").select("starts_at").is("archived_at", null).neq("status", "done")
      .not("starts_at", "is", null).gt("starts_at", `${o.drop_date}T23:59:59`)
      .order("starts_at", { ascending: true }).limit(1).maybeSingle();
    const at = (st as { starts_at?: string | null } | null)?.starts_at;
    let d: Date;
    if (at) { d = new Date(at); } else { d = new Date(`${o.drop_date}T12:00:00`); d.setDate(d.getDate() + 7); }
    const nextISO = dropDateKey(d);
    const nextLabel = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    if (!(await confirm({ title: `Move ${o.name}'s ${o.size}-pack to ${nextLabel}'s drop?`, confirmLabel: "Move it" }))) return;
    const { error } = await supabase.from("drop_orders").update({ drop_date: nextISO }).eq("id", o.id);
    if (error) { toast(failureWords(error, "Couldn't move it"), "error"); reload(); return; }
    toast(`Moved to ${nextLabel} — it's under Upcoming drops`);
    reload();
  };

  // The way back — pull an upcoming pack onto this drop.
  const pullBack = async (o: DropOrder) => {
    if (!supabase) return;
    const { error } = await supabase.from("drop_orders").update({ drop_date: dropISO }).eq("id", o.id);
    if (error) { toast(failureWords(error, "Couldn't move it"), "error"); reload(); return; }
    toast(`Back on ${satLabel}'s drop`);
    reload();
  };

  // Cancel keeps the row (audit trail) and drops it from the sheet; a paid cancel flags the refund.
  // How it was paid decides what the refund is (0341): cash goes back across the window, a card —
  // online or on the reader — is refunded in Square. The flag is the database's (0416, refund_flag_pack): raised by the
  // cancel itself, from the row as it is — a pack another phone just took on the card reader is flagged too, which this
  // screen, judging from the row it drew, could not do. Critical, like the member's own (0242: an 'important' refund alert
  // has no escalation behind it).
  const cancel = async (o: DropOrder) => {
    if (!supabase) return;
    const how = paidHow(o);
    const amt = dollars(o.total_cents / 100);
    if (!(await confirm(
      how === "cash" ? { title: `Cancel ${o.name}'s ${o.size}-pack, paid ${amt} cash?`, body: "Hand the cash back — nothing to refund in Square.", confirmLabel: "Cancel pack", cancelLabel: "Keep it", danger: true }
      : how === "covered" ? { title: `Cancel ${o.name}'s ${o.size}-pack?`, body: "It was covered by a free cup or credit — no money to give back.", confirmLabel: "Cancel pack", cancelLabel: "Keep it", danger: true }
      : how ? { title: `Cancel ${o.name}'s PAID ${o.size}-pack (${amt})?`, body: `${how === "card_reader" ? "Paid on the card reader" : "Paid by card"} — the refund is done in Square, and the crew inbox gets a flag.`, confirmLabel: "Cancel pack", cancelLabel: "Keep it", danger: true }
      : { title: `Cancel ${o.name}'s ${o.size}-pack?`, body: "Pay at pickup — nothing was charged.", confirmLabel: "Cancel pack", cancelLabel: "Keep it", danger: true }))) return;
    // Once: a pack already canceled (another phone, a second tap) is not canceled again.
    const { data: gone, error } = await supabase.from("drop_orders").update({ canceled_at: new Date().toISOString() }).eq("id", o.id).is("canceled_at", null).select("id");
    if (error) { toast(failureWords(error, "Couldn't cancel"), "error"); reload(); return; }
    if (!gone?.length) { toast(`${o.name}'s pack was already canceled`, "info"); reload(); return; }
    toast(how === "cash" ? `Reservation canceled — hand back ${amt} cash` : "Reservation canceled");
    reload();
  };

  // Turn the brew sheet into planned batches for Friday — sized per flavor from bottle counts and
  // each recipe's yield factor, linked to this drop by drop_date. The brew system takes it from there.
  const queueBrew = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    const perF = flavorDemand(rows, FLAVORS);
    const wanted = FLAVORS.filter((f) => perF[f] > 0);
    const { data: recipes } = await supabase.from("brew_recipes")
      .select("id, name, product_slug, yield_factor").in("product_slug", wanted.map((f) => f.toLowerCase())).is("archived_at", null);
    const brewD = new Date(`${dropISO}T12:00:00`); brewD.setDate(brewD.getDate() - 1); // 18h cold extraction → brew the day before the drop
    const brewISO = dayKey(brewD); // local round-trip of the local-parsed date — a UTC slice could shift a day
    const ins = wanted.map((f) => {
      const r = (recipes ?? []).find((x) => x.product_slug === f.toLowerCase());
      const gal = gallonsForBottles(perF[f], r?.yield_factor);
      return {
        recipe_id: r?.id ?? null, recipe_name: r?.name ?? `GT3 ${f}`, batch_gal: gal,
        brew_date: brewISO, status: "planned", drop_date: dropISO, created_by: me,   // who queued it: the brew alarms' fallback (0344)
        notes: `${perF[f]}× ${f} bottles for ${satLabel}'s drop`,
      };
    });
    const { error } = await supabase.from("brew_batches").insert(ins);
    setBusy(false);
    if (error) { toast(failureWords(error, "Couldn't queue the brew"), "error"); return; }
    toast(`Brew plan queued — ${ins.length} ${ins.length === 1 ? "batch" : "batches"} for Friday`);
    reload();
  };

  const bottles = rows.reduce((a, o) => a + o.size, 0);
  const glassBack = rows.filter((o) => o.glass === "return").reduce((a, o) => a + o.size, 0);
  const revenue = rows.reduce((a, o) => a + o.total_cents, 0) / 100;
  const dueAtWindow = rows.filter((o) => !isSettled(o)).reduce((a, o) => a + o.total_cents, 0) / 100;
  const perF: Record<string, number> = flavorDemand(rows, FLAVORS);
  // Under a Saturday rush the queue has to scan fast: unfulfilled float to the top, completed dim
  // out. Progress counters tell the lead where the drop stands at a glance.
  const returns = rows.filter((o) => o.glass === "return");
  const pickedCount = rows.filter((o) => o.picked_up).length;
  const bottlesInCount = returns.filter((o) => o.bottles_returned).length;
  const queue = [...rows].sort((a, b) => Number(a.picked_up) - Number(b.picked_up));
  const allDone = rows.length > 0 && pickedCount === rows.length && bottlesInCount === returns.length;
  // The name-by-name checklist is window work — it matters ON drop day. On prep days it's noise
  // under the brew sheet, so the progress line doubles as a fold: open on the drop's date (or by
  // tap any time), collapsed otherwise. Same pattern as "Past drops" below.
  const isDropDay = rows.length > 0 && rows[0].drop_date === etToday(); // drop_date is an ET business-day key
  const showList = listOpen ?? isDropDay;
  // ITS DAYS (2026-10-10, the Live Ops fold). On Live Ops the drop is one row until it is today's work:
  // the drop itself, and the day before it while the brew isn't queued yet (18h cold extraction — the
  // brew is the day before, queueBrew below). Any other day it says when, how many packs, and how many
  // bottles that makes, and opens on a tap.
  const brewDay = addDays(dropISO, -1);
  const packWords = rows.length > 0 ? `${rows.length} pack${rows.length === 1 ? "" : "s"}` : "no reservations yet";
  const bottleWords = `${bottles} bottle${bottles === 1 ? "" : "s"}`;
  const brewDue = bottles > 0 && batches.length === 0 && etToday() >= brewDay && etToday() <= dropISO;

  return (
    <AsyncSection state={board} isEmpty={() => false} errorTitle="Couldn't load the drop" emptyTitle="Nothing here yet">
      {() => {
        // The card's working face — one body, drawn in the titled panel (Service mode, the drop sheet) or in
        // Live Ops' fold.
        const body = (
          <>
          {/* One sentence with units instead of three bare KPI tiles ("6 BREW" told nobody anything).
              It answers the drop's three questions in reading order: how much to make, what money
              happens at the window, what glass comes back. */}
          {rows.length > 0 && (
            <p className="dops-sum">
              <b>{bottles}</b> bottle{bottles === 1 ? "" : "s"} to brew
              {dueAtWindow > 0
                ? dueAtWindow === revenue
                  ? <> · <b>{dollars(dueAtWindow)}</b> to collect at the window</>
                  : <> · <b>{dollars(Math.round(revenue))}</b> total, <b>{dollars(dueAtWindow)}</b> still to collect at the window</>
                : <> · <b>{dollars(Math.round(revenue))}</b> already paid</>}
              {glassBack > 0 && <> · <b>{glassBack}</b> empties coming back</>}
            </p>
          )}
          {rows.length === 0 ? (
            // brief = the Now screen's compact prep tile (checked repeatedly during service) — keeps its
            // dense one-line note; the full/Service-mode face gets the designed empty state.
            brief ? <div className="dops-empty">No reservations yet for this drop.</div> : <EmptyState title="No reservations yet for this drop" />
          ) : (
            <>
              <div className="dops-brew">Brew sheet: <b>{FLAVORS.map((f) => `${perF[f]}× ${f}`).join(" · ")}</b></div>
              {batches.length > 0 ? (
                <div className="dops-plan queued"><Icon name="jar" /> Brew plan queued: {batches.map((b) => `${b.recipe_name ?? "?"} — ${b.batch_gal} gal (${b.status})`).join(" · ")}</div>
              ) : bottles > 0 ? (
                <div className="dops-plan">
                  <span>Friday&rsquo;s brew: {FLAVORS.filter((f) => perF[f] > 0).map((f) => `${gallonsForBottles(perF[f], null)} gal ${f}`).join(" · ")}</span>
                  {canPlan && <button type="button" className="min-h-11" onClick={queueBrew} disabled={busy}>{busy ? "Queuing…" : "Queue brew batches"}</button>}
                </div>
              ) : null}
              <button type="button" className={`dops-prog min-h-11${allDone ? " done" : ""}`} onClick={() => (brief ? onOpen?.() : setListOpen(!showList))} aria-expanded={brief ? undefined : showList}>
                <span>{allDone ? <><Icon name="check" /> All picked up · bottles in</> : <><b>{pickedCount}/{rows.length}</b> picked up{returns.length > 0 ? <> · <b>{bottlesInCount}/{returns.length}</b> bottles in</> : null}</>}</span>
                <span>{brief ? "checklist in Service ▸" : showList ? "▾" : "▸"}</span>
              </button>
              {/* R50: the rows shown, as a file (the console audit's point 10). */}
              {!brief && (
                <div className="flex justify-end">
                  <button type="button" className="btn-sec btn-sm shrink-0" disabled={!queue.length} onClick={() => void downloadCsv(`gt3-drop-${dropISO}.csv`, queue.map((o) => ({
                    name: o.name, phone: o.phone ?? "", drop: o.drop_date, pack: o.size, glass: o.glass === "return" ? "glass back" : "new glass",
                    mix: mixSummary(o.mix), total: moneyPlain(o.total_cents), paid: isSettled(o) ? (paidHow(o) ?? "paid") : "due",
                    stage: PACK_STAGES[stageIndex(o.stage)].label, picked_up: o.picked_up ? "yes" : "no", bottles_returned: o.glass === "return" ? (o.bottles_returned ? "yes" : "no") : "",
                  })))}>Export CSV</button>
                </div>
              )}
              {!brief && showList && queue.map((o) => (
                <div className={`dops-order${o.picked_up ? " done" : ""}`} key={`cur-${o.id}`}>
                  {/* Identity line as a kit InfoRow: lead = pack qty, body = name + glass chip + mix +
                      phone, trailing = money/paid. The fulfillment stepper + actions stay below it,
                      inside the same order card. (.k-rows drops the row's own hairline here.) */}
                  <div className="k-rows">
                    <InfoRow
                      lead="Pack"
                      leadSub={`${o.size}`}
                      name={o.name}
                      nameExtra={<span className={`dops-chip ${o.glass === "return" ? "ret" : "new"}`}>{o.glass === "return" ? `GLASS BACK ×${o.size}` : "NEW GLASS"}</span>}
                      meta={<>{mixSummary(o.mix)}{o.phone ? <><br /><a className="dops-tel" href={`tel:${o.phone.replace(/[^\d+]/g, "")}`}>{o.phone}</a></> : null}</>}
                      trailing={<span className="dops-total">{o.total_cents === 0 ? <>on us <Icon name="check" /></> : <>{dollars(o.total_cents / 100)} {isSettled(o) ? <Icon name="check" /> : <em className="dops-owe">due</em>}</>}</span>}
                    />
                  </div>
                  {/* Fulfillment stepper — tap a stage to jump, or the primary button to advance one.
                      Reserved → Preparing → Ready → En route → Picked up; the customer sees it live. */}
                  {(() => {
                    const cur = stageIndex(o.stage);
                    const nextLabel = PACK_STAGES[cur]?.next;
                    return (
                      <>
                        <div className="dops-stages" role="group" aria-label="Pack stage">
                          {PACK_STAGES.slice(1).map((st, i) => {
                            const idx = i + 1; // slice(1) skips 'reserved'
                            const on = cur === idx, done = cur > idx;
                            return (
                              <button key={st.key} type="button" className={`dops-stage${on ? " on" : ""}${done ? " done" : ""}`} aria-current={on} onClick={() => setStage(o, st.key)}>
                                {done ? <><Icon name="check" /> {st.label}</> : st.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="dops-actions">
                          {nextLabel && <button type="button" className="btn-sec btn-sm flex-1" onClick={() => setStage(o, PACK_STAGES[cur + 1].key)}>{nextLabel}</button>}
                          {canCollect(o) && <button type="button" className="btn-sec btn-sm flex-1" onClick={() => collect(o)}>Collect {dollars(o.total_cents / 100)}</button>}
                          {canUndo(o, me, admin) && (
                            <button type="button" className="k-chip sm ok on flex-1" onClick={() => undoTake(o)} aria-label={`Undo ${VIA_UNDO[viaOf(o) ?? "card_reader"]} from ${o.name}`}>
                              {VIA_CHIP[viaOf(o) ?? "card_reader"]} <Icon name="check" />
                            </button>
                          )}
                          {batches.length > 0 && (
                            <select className={`dops-batchsel${o.batch_id ? " set" : ""}`} value={o.batch_id ?? ""} onChange={(e) => setBatch(o.id, e.target.value)} aria-label="Filled from batch" title="Filled from batch — recall traceability">
                              <option value="">batch?</option>
                              {batches.map((b) => <option key={b.id} value={b.id}>{(b.recipe_name || "Batch")} · {Number(b.batch_gal)} gal</option>)}
                            </select>
                          )}
                          {o.glass === "return" && (
                            <button type="button" className={`k-chip sm ok flex-1${o.bottles_returned ? " on" : ""}`} aria-pressed={!!o.bottles_returned} onClick={() => toggle(o.id, "bottles_returned", !o.bottles_returned)}>{o.bottles_returned ? <><Icon name="check" /> Bottles in</> : "Bottles in"}</button>
                          )}
                          {!o.picked_up && (
                            <>
                              <button type="button" className="btn-sec btn-sm shrink-0" onClick={() => pushNextWeek(o)}><Icon name="arrowRight" /> Next drop</button>
                              <button type="button" className="btn-del shrink-0" onClick={() => cancel(o)}>Cancel</button>
                            </>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              ))}
            </>
          )}
          </>
        );
        return (
        <div className={`dops zone-pickup${brief ? " mt-0" : ""}`}>
          {/* The drop block is a card (the crew console's .mpanel). On Live Ops it is a fold, one row until
              its day (ITS DAYS, above); in Service mode and the drop sheet it is the titled panel, where
              SectionHeader supplies its own top spacing and the card only pads sides + bottom. */}
          {/* A ROW OF DUE NEXT (2026-10-12, the Live Ops round, approved): the drop's card sat under Due next's list, so on a
              quiet day "Nothing due next." stood over "Pickup drop · This Sat · no reservations yet". On Live Ops it is a
              row of that list now (components/crew/DueList places it by its day), its day in the lead column like the
              rows beside it; the same fold opens its working face under it. */}
          {brief ? (
            <FoldCard title="Pickup drop" label="Pickup drop" today={isDropDay || brewDue} id="due-pickup"
              row={{ lead: dueLead(dropISO, etToday()), leadSub: drop.at ? clockTime(drop.at) : undefined, tag: <span className="k-tag txt">Drop</span>,
                says: `Pickup drop, ${dropWhen}${drop.at ? ` at ${clockTime(drop.at)}` : ""} · ${packWords}${bottles > 0 ? ` · ${bottleWords}` : ""}` }}
              sub={packWords}
              value={bottles > 0 ? bottleWords : null}>
              {body}
            </FoldCard>
          ) : (
          <div className="mpanel" style={{ padding: "0 14px 14px" }}>
            <SectionHeader
              label="Pickup · reserves & packs"
              annotation={`${dropWhen}'s drop${rows.length > 0 ? ` · ${rows.length} pack${rows.length === 1 ? "" : "s"}` : ""}`}
            />
            {body}
            {/* The Limited Reserves handed over at this day's stops (0400): who is owed one, and Handed over. */}
            <ReserveClaims day={dropISO} />
          </div>
          )}
          {/* Moved packs land here in the same breath — never off any surface. Grouped by date so a
              glance says what next week already owes. */}
          {!brief && upcoming.length > 0 && (
            <div className="dops-up">
              {Object.entries(upcoming.reduce<Record<string, DropOrder[]>>((m, o) => { (m[o.drop_date] ??= []).push(o); return m; }, {})).map(([d, os]) => (
                <div key={d}>
                  <div className="dops-up-h">Upcoming · {new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {os.reduce((a, o) => a + o.size, 0)} bottles</div>
                  {os.map((o) => (
                    <div className="dops-up-row" key={o.id}>
                      <span><b>{o.name}</b> — {o.size}-pack{isSettled(o) ? <> · paid <Icon name="check" /></> : ""}</span>
                      <span className="dops-up-act">
                        <button type="button" className="btn-sec btn-sm shrink-0" onClick={() => pullBack(o)}>← This drop</button>
                        <button type="button" className="btn-del shrink-0" onClick={() => cancel(o)}>Cancel</button>
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {!brief && (
            <div className="dops-hist">
              <button type="button" className="dops-hist-h" onClick={() => setHistOpen((v) => !v)} aria-expanded={histOpen}>
                Past drops{histOpen && history && history.length > 0 ? ` · ${new Set(history.map((o) => o.drop_date)).size}` : ""} <span>{histOpen ? "▾" : "▸"}</span>
              </button>
              {histOpen && history === null && (board.error && !board.refreshing
                ? <p className="load-failed"><Said as="span" assertive>Couldn&apos;t read past drops — this is not &ldquo;none&rdquo;.</Said> <button type="button" className="btn-ter" onClick={() => void reload()}>Try again</button></p>
                : <p className="cp-line dim">Reading past drops…</p>)}
              {histOpen && history?.length === 0 && <p className="cp-line dim">No past drops.</p>}
              {histOpen && history && Object.entries(history.reduce<Record<string, DropOrder[]>>((m, o) => { (m[o.drop_date] ??= []).push(o); return m; }, {})).map(([d, os]) => {
                const kept = os.filter((o) => !o.canceled_at);
                const rev = kept.reduce((a, o) => a + o.total_cents, 0) / 100;
                const label = new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
                return (
                  <div className="dops-hist-drop" key={d}>
                    <div className="dops-hist-meta"><b>{label}</b> · {kept.length} pack{kept.length === 1 ? "" : "s"} · {kept.reduce((a, o) => a + o.size, 0)} bottles · {dollars(rev)}</div>
                    {os.map((o) => (
                      <div className="dops-hist-row" key={o.id}>
                        <span>{o.name} — {o.size}-pack{isSettled(o) ? "" : " · unpaid"}</span>
                        <span className={`dops-hist-st ${o.canceled_at ? "cx" : o.picked_up ? "ok" : "miss"}`}>
                          {o.canceled_at ? "canceled" : o.picked_up ? <><Icon name="check" /> picked up{o.glass === "return" ? (o.bottles_returned ? " · bottles in" : " · bottles out") : ""}</> : "no-show"}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          {collectSheet}
        </div>
        );
      }}
    </AsyncSection>
  );
}
