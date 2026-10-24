"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import { type PerfMix } from "@/lib/delivery";
import { dayWithDate, etToday } from "@/lib/dates";
import AssignTaskSheet from "./AssignTaskSheet";
import Sheet, { CloseButton } from "./Sheet";
import { InfoRow } from "@/components/kit";
import FoldCard from "@/components/crew/FoldCard";
import Icon from "@/components/Icon";
import { money, moneyPlain } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { usePrompt } from "@/components/PromptSheet";
import { useConfirm } from "@/components/ConfirmSheet";
import { useAuth } from "./AuthProvider";
import { useAppStable } from "./AppProvider";
import Link from "next/link";
import { OPEN_PANEL_EVENT } from "@/lib/anchors";
import { useMinute } from "@/lib/useMinute";
import { DUE_CARD, dueAnchor, notHome, porchLate, type PorchFeed } from "@/lib/dueNext";
import { markOut, moveToRun, nextRunDay, nextRunFor, outPlan, outWords, runDayWords, undoMove, undoOutWords, unmarkOut, type MissedPorch, type PorchStep } from "@/lib/porchRun";
import { useLatestRead } from "@/lib/useLatestRead";
import Said from "@/components/Said";
import { failureWords, plainFailure } from "@/lib/failureWords";

// SUNDAY DELIVERY OPS — the crew side of the delivery debrief, in DropOps' shape: one summary
// sentence (units, one hero thought), the Saturday brew totals (incl. Performance combos), and a
// name-by-name run list that folds until delivery day. Driver logs one of three outcomes per porch;
// "held" flips the order into the pickup queue and raises a crew alert. Realtime like everything
// else — channel name unique per subscription (the twice-shipped crash class).
//
// 2026-07-16: this screen used to call the same delivery destination a "stop" (progress button, the
// assign-a-driver task title) in one spot and an "order" (section header count) in another — "stop"
// already means something else entirely (the truck's own Route locations, a different DB table).
// Standardized on "porch" here, matching what DriverDash/DriverRun and the app's own Sunday-delivery
// brand voice (Academy, marketing copy, the customer SMS) already call it.

type DOrder = {
  id: string; name: string; phone: string | null;
  address_street: string; address_city: string; address_zip: string; access_instructions: string | null;
  pack_size: number; rise_count: number; flow_count: number; dusk_count: number;
  performance_count: number; performance_mix: PerfMix; refill_count: number; new_count: number;
  total_cents: number; payment_status: string; status: string;
  driver_outcome: string | null; empties_expected: number; empties_collected: number | null;
  delivery_date: string; canceled_at: string | null;
  delivery_window?: string | null;   // "5–8 AM" (0139): when the porch is late, and whether today's run can still take one
  driver_note?: string | null;   // the driver's word on an outcome ("Not home — 6:42 AM", components/DriverRun)
  batch_id?: string | null;   // 0261 recall traceability — which brew filled this porch
  customer_id?: string | null;
};

const STATUS_NEXT: Record<string, string> = { received: "brewed", brewed: "out_for_delivery" };
const STATUS_LABEL: Record<string, string> = {
  received: "Received", brewed: "Brewed", out_for_delivery: "Out for delivery",
  delivered: "Delivered", held_for_pickup: "HELD — pickup", issue: "Issue",
};

// What the card hands Due next while a read has failed: nothing — the card shows no porches then either.
const NONE: DOrder[] = [];
const missed = (o: DOrder) => o.status === "held_for_pickup" || o.status === "issue";

/** onDue: the day of the next run (null: none scheduled), for Live Ops' Due next to put the runs in order.
 *  onRows: the run and what it carries from earlier, as this card read them, for Due next's one list (2026-10-11). */
export default function DeliveryOps({ onDue, onRows }: { onDue?: (day: string | null) => void; onRows?: (feed: PorchFeed) => void } = {}) {
  const { toast } = useAppStable();
  const confirm = useConfirm();
  const now = useMinute();
  const [rows, setRows] = useState<DOrder[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [runDays, setRunDays] = useState<string[]>([]);   // every delivery day on the board, today on — where a missed porch can go
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);   // "all", or the porch being moved
  // FROM EARLIER (2026-10-11, the KDS audit). A porch held for pickup or not home left every board the next day —
  // each read here and on the driver's run asks for today on — and nothing moved it to the next run. The last two
  // weeks' undelivered porches stay on this card until somebody settles them.
  const [earlier, setEarlier] = useState<DOrder[]>([]);
  const [loadFailed, setLoadFailed] = useState(false); // read failed ≠ no run today
  const [listOpen, setListOpen] = useState<boolean | null>(null);
  const [assign, setAssign] = useState(false);
  const [packout, setPackout] = useState(false);
  const [q, setQ] = useState("");   // R50: search the run's porches (the console audit's point 2)

  // Read, then set — the newest read's answer only (R17, lib/useLatestRead).
  const read = useLatestRead();
  const load = useCallback(() => read(async () => {
    if (!supabase) return null;
    // the next delivery day with anything on it (today counts — Sunday IS the run);
    // delivery_date is an ET business-day key (lib/delivery.ts), so "today" must be ET too
    const today = etToday();
    const since = new Date(`${today}T12:00:00Z`); since.setUTCDate(since.getUTCDate() - 14);
    const [run, back] = await Promise.all([
      supabase.from("delivery_orders").select("*")
        .gte("delivery_date", today).is("canceled_at", null)
        .order("delivery_date").order("address_zip").limit(200),
      supabase.from("delivery_orders").select("*")
        .lt("delivery_date", today).gte("delivery_date", since.toISOString().slice(0, 10))
        .in("status", ["held_for_pickup", "issue"]).is("canceled_at", null)
        .order("delivery_date", { ascending: false }).limit(50),
    ]);
    return { today, run, back };
  }, (r) => {
    if (!r) return;
    const { today, run: { data, error }, back } = r;
    if (error) { setLoadFailed(true); return; }
    setLoadFailed(false);
    const all = (data ?? []) as DOrder[];
    // The run is the first day on or after today with a porch on it — written once (lib/porchRun nextRunDay), the rule
    // a missed porch is moved to the next run by.
    const days = [...new Set(all.map((o) => o.delivery_date))];
    const d = nextRunDay(days, today);
    setDate(d);
    setRunDays(days);
    setRows(all.filter((o) => o.delivery_date === d));
    setEarlier(back.error ? [] : ((back.data ?? []) as DOrder[]));   // the upcoming run is the card; this is its margin
    setLoaded(true);
  }), [read]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable("delivery_orders", load);
  useEffect(() => { onDue?.(date); }, [date, onDue]);
  // Due next's one list is this read — the run and what it carries from earlier — and nothing while it failed.
  const feedStatus = loadFailed ? "error" : loaded ? "ready" : "loading";
  useEffect(() => {
    onRows?.({ status: feedStatus, run: loadFailed ? NONE : rows, earlier: loadFailed ? NONE : earlier });
  }, [feedStatus, loadFailed, rows, earlier, onRows]);
  // A row in Due next opens this card at its porch, so the porch list inside opens with it.
  useEffect(() => {
    const onOpen = (e: Event) => { if ((e as CustomEvent<string>).detail === DUE_CARD.porch) setListOpen(true); };
    window.addEventListener(OPEN_PANEL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PANEL_EVENT, onOpen);
  }, []);

  // A WRITE THAT FAILED SAYS SO (2026-10-11): the status and the batch were written unchecked, so a refused one
  // looked saved until the board read again and quietly put it back.
  const setStatus = async (o: DOrder, status: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("delivery_orders").update({ status }).eq("id", o.id);
    if (error) toast(`Didn't save ${o.name}'s porch — ${plainFailure(error)}`, "error");
    load();
  };
  // 0261's delivery side, delivered (the DropOps picker's twin): stamp which brew filled this
  // porch, and "who got batch X" covers the Sunday run too — recall traceability across BOTH
  // order families. Only works if the crew uses it; same habit as pack-out.
  const [batches, setBatches] = useState<{ id: string; recipe_name: string | null; batch_gal: number }[]>([]);
  useEffect(() => {
    if (!supabase) return;
    supabase.from("brew_batches").select("id, recipe_name, batch_gal").in("status", ["ready", "kegged"]).order("created_at", { ascending: false }).limit(12)
      .then(({ data }) => setBatches((data as { id: string; recipe_name: string | null; batch_gal: number }[]) ?? []));
  }, [date]);
  const setBatch = async (id: string, batchId: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("delivery_orders").update({ batch_id: batchId || null }).eq("id", id);
    if (error) toast(failureWords(error, "Didn't save the batch"), "error");
    load();
  };
  // ALL OUT AT ONCE (2026-10-11, the dispatch round — lib/porchRun says why, and why there is no "all delivered").
  // The run's porches not out yet, behind the confirm sheet; one write each, each answer read; Undo puts back the ones
  // still out for delivery.
  const markAllOut = async () => {
    if (!supabase || busy) return;
    const plan = outPlan(rows);
    if (plan.length === 0) return;
    if (!(await confirm({
      title: `Mark ${plan.length} porch${plan.length === 1 ? "" : "es"} out for delivery?`,
      body: "Each customer's delivery screen will say On the way. Held, not-home and delivered porches stay as they are.",
      confirmLabel: "Mark them out", cancelLabel: "Not yet",
    }))) return;
    setBusy("all");
    const res = await markOut(supabase, plan.map((o): PorchStep => ({ id: o.id, name: o.name, status: o.status })));
    setBusy(null);
    const said = outWords(res);
    toast(said.text, said.error ? "error" : "success", res.moved.length ? { action: { label: "Undo", run: () => { void undoAllOut(res.moved); } } } : undefined);
    load();
  };
  const undoAllOut = async (moved: PorchStep[]) => {
    if (!supabase) return;
    const said = undoOutWords(await unmarkOut(supabase, moved));
    toast(said.text, said.error ? "error" : "success");
    load();
  };

  // HELD, NOT HOME → THE NEXT RUN (2026-10-11, lib/porchRun nextRunFor). One tap; the toast can undo it.
  const toNextRun = async (o: DOrder) => {
    if (!supabase || busy) return;
    const { day } = nextRunFor(o, runDays, now);
    const was: MissedPorch = { id: o.id, name: o.name, delivery_date: o.delivery_date, status: o.status, driver_outcome: o.driver_outcome, empties_collected: o.empties_collected, driver_note: o.driver_note ?? null };
    setBusy(o.id);
    const res = await moveToRun(supabase, was, day);
    setBusy(null);
    if (res.ok) toast(`${o.name} — on the run for ${runDayWords(day, etToday())}`, "success", { action: { label: "Undo", run: () => { void undoNextRun(was, day); } } });
    else toast(res.error ? `Didn't move ${o.name}'s porch — ${plainFailure(res.error)}` : `${o.name}'s porch changed meanwhile — nothing moved`, res.error ? "error" : "info");
    load();
  };
  const undoNextRun = async (was: MissedPorch, day: string) => {
    if (!supabase) return;
    const res = await undoMove(supabase, was, day);
    toast(res.ok ? `${was.name} — back as it was` : res.error ? `Couldn't put it back — ${plainFailure(res.error)}` : `${was.name}'s porch moved on since — left as it is`, res.ok ? "success" : res.error ? "error" : "info");
    load();
  };
  // The button says where the porch goes before it is tapped, and the tap does that: one rule, on the same minute's clock.
  const nextRunButton = (o: DOrder) => {
    const when = runDayWords(nextRunFor(o, runDays, now).day, etToday());
    return (
      <button type="button" className="btn-sec btn-sm shrink-0" onClick={() => toNextRun(o)} disabled={!!busy} aria-label={`Move ${o.name}'s porch to the run for ${when}`}>
        <Icon name="arrowRight" /> Next run · {when}
      </button>
    );
  };

  // Outcomes (swap done / fresh / hold / not home) are logged in DRIVER MODE only (/driver) —
  // one writer, so the recorded flow can't drift between two button sets again. This card is the
  // HQ monitor/debrief face: statuses, brew totals, packout, assign.

  // Quiet is right for "no deliveries today" and wrong for "we could not find out". This is the
  // board the crew runs the day from; silently showing nothing is how a delivery gets missed.
  if (loadFailed) return (
    <div className="dops" role="status">
      <p className="load-failed">
        Couldn&apos;t load today&apos;s deliveries — this is not &ldquo;none scheduled&rdquo;.{" "}
        <button type="button" className="btn-ter" onClick={() => load()}>Try again</button>
      </p>
    </div>
  );
  // Undelivered porches from the last two weeks, each with what the driver said: on the run's card, and the card
  // itself when no run is scheduled — quiet only when there is neither.
  const day = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, o);
  const earlierBlock = earlier.length > 0 && (
    <div role="group" aria-label="From earlier runs — not delivered">
      <p className="dops-sum"><b className="dl-held">{earlier.length} from earlier</b> — not delivered. Next run puts {earlier.length === 1 ? "it" : "each"} on the next one.</p>
      <div className="k-rows">
        {/* Each porch carries its id, so a row in Due next lands on it (lib/dueNext dueAnchor); focus lands without a ring. */}
        {earlier.map((o) => (
          <div key={o.id} id={dueAnchor("porch", o.id)} tabIndex={-1} className="outline-none">
            <InfoRow lead={day(o.delivery_date, { weekday: "short" })} leadSub={day(o.delivery_date, { month: "short", day: "numeric" })}
              name={o.name}
              nameExtra={<span className="dops-chip new">{notHome(o) ? "Not home" : STATUS_LABEL[o.status]}</span>}
              meta={<>
                {o.driver_note ? <><em>{o.driver_note}</em> · </> : null}{o.pack_size} bottles · {o.address_street}, {o.address_city}
                {o.phone ? <div className="dops-drive"><a className="dops-tel min-h-11" href={`tel:${o.phone.replace(/[^\d+]/g, "")}`}>Call {o.name.split(" ")[0]}</a></div> : null}
                <div className="dops-actions">{nextRunButton(o)}</div>
              </>} />
          </div>
        ))}
      </div>
    </div>
  );
  if (!date || rows.length === 0) {
    if (!earlierBlock) return null; // quiet until a delivery exists
    return (
      <FoldCard title="Sunday delivery" label="Sunday delivery" today id="due-porch"
        sub={`No run scheduled · ${earlier.length} from earlier`}>
        {earlierBlock}
      </FoldCard>
    );
  }

  const bottles = rows.reduce((a, o) => a + o.pack_size, 0);
  const refills = rows.reduce((a, o) => a + o.refill_count, 0);
  const fresh = rows.reduce((a, o) => a + o.new_count + o.performance_count, 0);
  const perF = { RISE: 0, FLOW: 0, DUSK: 0 } as Record<string, number>;
  rows.forEach((o) => { perF.RISE += o.rise_count; perF.FLOW += o.flow_count; perF.DUSK += o.dusk_count; });
  // Premium ($14) adds are dynamic (whatever's flagged bulk-orderable) — sum by slug so the crew
  // brews the right ones. Legacy orders with base|addin keys still sum into the total.
  const prettySlug = (s: string) => s.replace(/[-_|]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const premiumMix: Record<string, number> = {};
  rows.forEach((o) => Object.entries(o.performance_mix || {}).forEach(([k, n]) => { if (n) premiumMix[prettySlug(k)] = (premiumMix[prettySlug(k)] || 0) + (n as number); }));
  const premiumTotal = rows.reduce((a, o) => a + o.performance_count, 0);
  const heldQueue = rows.filter((o) => o.status === "held_for_pickup");
  const doneCount = rows.filter((o) => o.status === "delivered" || o.status === "held_for_pickup").length;
  const isRunDay = date === etToday();
  const showList = listOpen ?? isRunDay;
  const dLabel = dayWithDate(date);
  // PAID IS SAID, PER PORCH (2026-10-11). Every row drew a check after its price and the line above said the run's total
  // was "paid on order" — whatever payment_status said. The total counts what is paid; a porch that is not says so.
  const paidCents = rows.filter((o) => o.payment_status === "paid").reduce((a, o) => a + o.total_cents, 0);
  const unpaid = rows.length - rows.filter((o) => o.payment_status === "paid").length;
  const toOut = outPlan(rows);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter((o) => {
    const hay = [o.name, o.phone ?? "", o.address_street, o.address_city, o.address_zip].join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  });

  return (
    // ONE ROW UNTIL ITS DAY (2026-10-10, the Live Ops fold): the run's day, how many porches, and the
    // bottles to make — and the whole working face on the run's day, or on a tap (components/crew/
    // FoldCard). Each porch is a kit InfoRow; the porch list inside still folds until the run.
    <FoldCard title="Sunday delivery" label="Sunday delivery" today={isRunDay} id="due-porch"
      sub={`${dLabel} · ${rows.length} porch${rows.length === 1 ? "" : "es"}${earlier.length ? ` · ${earlier.length} from earlier` : ""}`}
      value={`${bottles} bottle${bottles === 1 ? "" : "s"}`}>
      {earlierBlock}
      <p className="dops-sum">
        <b>{bottles}</b> bottles ({refills} refills · {fresh} fresh) · <b>{money(paidCents)}</b> paid on order
        {unpaid > 0 && <> · <b className="dl-held">{unpaid} unpaid</b></>}
        {heldQueue.length > 0 && <> · <b className="dl-held">{heldQueue.length} held for pickup</b></>}
      </p>
      <div className="dops-brew">Brew: <b>{(["RISE", "FLOW", "DUSK"] as const).filter((f) => perF[f] > 0).map((f) => `${perF[f]}× ${f}`).join(" · ") || "—"}</b>
        {premiumTotal > 0 && <> · Premium: <b>{Object.keys(premiumMix).length ? Object.entries(premiumMix).map(([k, n]) => `${n}× ${k}`).join(" · ") : premiumTotal}</b></>}
      </div>
      {/* The run's day, with porches not out yet: one tap and the confirm sheet, instead of two taps a porch. */}
      {isRunDay && toOut.length > 0 && (
        <button type="button" className="btn-sec btn-wide mb-2" onClick={markAllOut} disabled={!!busy}>
          <Icon name="truck" /> {busy === "all" ? "Marking them out…" : `Mark all out for delivery · ${toOut.length}`}
        </button>
      )}
      <LoopQuickLog porches={rows} />
      <Link className="dops-driver-link min-h-11" href="/driver"><Icon name="truck" /> Open the driver run — map &amp; turn-by-turn <Icon name="arrowRight" /></Link>
      <button type="button" className="btn-sec btn-sm btn-wide mt-2" onClick={() => setAssign(true)}><Icon name="team" /> Assign this run to a driver <Icon name="arrowRight" /></button>
      <button type="button" className="btn-sec btn-sm btn-wide mt-2" onClick={() => setPackout(true)}><Icon name="package" /> Vehicle packout plan <Icon name="arrowRight" /></button>
      {assign && <AssignTaskSheet defaultTitle={`Sunday delivery run — ${rows.length} porch${rows.length === 1 ? "" : "es"} · ${bottles} bottles`} dueOn={date} category="ops" onClose={() => setAssign(false)} />}
      {packout && <DeliveryPackout bottles={bottles} orders={rows.length} refills={refills} onClose={() => setPackout(false)} />}
      <button type="button" className="dops-prog min-h-11" onClick={() => setListOpen(!showList)} aria-expanded={showList}>
        <span><b>{doneCount}/{rows.length}</b> porches done</span>
        <span>{showList ? "▾" : "▸"}</span>
      </button>
      {showList && (
        <>
        {/* R50: search the porches, and the rows shown as a file (the console audit's points 2 and 10). */}
        <div className="flex items-center gap-2 mb-2">
          <input type="search" className="w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search porches" aria-label="Search the run's porches" enterKeyHint="search" autoComplete="off" />
          <button type="button" className="btn-sec btn-sm shrink-0" disabled={!shown.length} onClick={() => void downloadCsv("gt3-delivery.csv", shown.map((o) => ({
            customer: o.name, phone: o.phone ?? "", street: o.address_street, city: o.address_city, zip: o.address_zip,
            delivery_date: o.delivery_date, bottles: o.pack_size, refills: o.refill_count,
            status: notHome(o) ? "Not home" : STATUS_LABEL[o.status] ?? o.status, payment: o.payment_status, total: moneyPlain(o.total_cents),
            access: o.access_instructions ?? "",
          })))}>Export CSV</button>
        </div>
        {shown.length === 0 && <p className="h-sub">No matches.</p>}
        <div className="k-rows">
          {shown.map((o) => {
            // States in words (2026-10-11): not home is said, not "Issue"; a porch past its window says late.
            const late = porchLate(o, now);
            const word = `${notHome(o) ? "Not home" : STATUS_LABEL[o.status]}${late ? " · late" : ""}`;
            return (
            <div key={o.id} id={dueAnchor("porch", o.id)} tabIndex={-1} className="outline-none" style={o.status === "delivered" ? { opacity: 0.5 } : undefined}>
              <InfoRow
                lead="ZIP"
                leadSub={o.address_zip}
                name={o.name}
                nameExtra={<>
                  {o.refill_count > 0 && <span className="dops-chip ret">SWAP ×{o.refill_count}</span>}
                  <span className={`dops-chip ${missed(o) || late ? "new" : "ret"}`}>{word}</span>
                </>}
                trailing={<span className="dops-total">{money(o.total_cents)} {o.payment_status === "paid" ? <>paid <Icon name="check" /></> : <em className="dl-held">{o.payment_status === "refunded" ? "refunded" : "unpaid"}</em>}</span>}
                meta={<>
                  <b>{o.pack_size} bottles</b> — {[o.rise_count && `${o.rise_count}× RISE`, o.flow_count && `${o.flow_count}× FLOW`, o.dusk_count && `${o.dusk_count}× DUSK`, o.performance_count && `${Object.entries(o.performance_mix || {}).map(([k, n]) => `${n}× ${prettySlug(k)}`).join(" · ") || `${o.performance_count}× premium`}`].filter(Boolean).join(" · ")}
                  <br />{o.address_street}, {o.address_city} {o.address_zip}{o.access_instructions ? <> · <em>{o.access_instructions}</em></> : null}
                  <div className="dops-drive">
                    <a className="dops-nav min-h-11" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${o.address_street}, ${o.address_city} ${o.address_zip}`)}`} target="_blank" rel="noopener noreferrer"><Icon name="compass" /> Navigate</a>
                    {o.phone ? <a className="dops-tel min-h-11" href={`tel:${o.phone.replace(/[^\d+]/g, "")}`}>Call {o.name.split(" ")[0]}</a> : null}
                  </div>
                  {/* Was `!==`, which fired the SHORT label on a surplus too (collected > expected —
                      the customer had extra bottles on hand) — reads as a shortfall when it's the
                      opposite. Split into its own short/surplus case so reconciling jug inventory
                      from this screen isn't backwards. */}
                  {o.empties_collected != null && o.empties_collected < o.empties_expected && (
                    <><br /><em className="dl-held">Empties short: {o.empties_collected}/{o.empties_expected}</em></>
                  )}
                  {o.empties_collected != null && o.empties_collected > o.empties_expected && (
                    <><br /><em className="dl-held">Empties surplus: {o.empties_collected}/{o.empties_expected}</em></>
                  )}
                  <div className="dops-actions">
                    {STATUS_NEXT[o.status] && (
                      <button type="button" className="btn-sec btn-sm flex-1" onClick={() => setStatus(o, STATUS_NEXT[o.status])}><Icon name="arrowRight" /> {STATUS_LABEL[STATUS_NEXT[o.status]]}</button>
                    )}
                    {batches.length > 0 && (
                      <select className={`dops-batchsel min-h-11${o.batch_id ? " set" : ""}`} value={o.batch_id ?? ""} onChange={(e) => setBatch(o.id, e.target.value)} aria-label="Filled from batch" title="Filled from batch — recall traceability">
                        <option value="">batch?</option>
                        {batches.map((b) => <option key={b.id} value={b.id}>{(b.recipe_name || "Batch")} · {Number(b.batch_gal)} gal</option>)}
                      </select>
                    )}
                    {o.status === "out_for_delivery" && (
                      <Link className="btn-sec btn-sm shrink-0" href="/driver">Log the outcome in driver mode <Icon name="arrowRight" /></Link>
                    )}
                    {missed(o) && nextRunButton(o)}
                  </div>
                </>}
              />
            </div>
            );
          })}
        </div>
        </>
      )}
    </FoldCard>
  );
}

// Deterministic vehicle packout for the whole Sunday run — scales the cooler/ice plan from the
// bottle loadout to the day's total bottles. Uses the qd-sheet · dp-body popout (bulletproof scroll).
// LOOP RETURNS (0268) — the return ledger's quick entry, on the surface where bottles actually come
// back. One count, one tap; the decided $2 credit rides the row default (loop_txns.credit_cents).
// Feeds the Loop-participation KPI and gives the 8/6 loyalty-mechanic decision real behavior to
// read. NOT the office jug float (business_accounts.jug_balance) — different container, on purpose.
// WHOSE BOTTLES, AND WHO COUNTED THEM (2026-10-04, the form audit). Every entry books a $2 credit,
// and the row recorded neither: loop_txns.customer_id ("when known → the 8/6 loyalty bridge", 0268)
// and created_by were never written. The count is now stamped with whoever logged it, and can say
// whose bottles they were — today's porches, the swaps first. Optional: a returned crate does not
// always come with a name.
function LoopQuickLog({ porches }: { porches: readonly DOrder[] }) {
  const prompt = usePrompt();
  const { user } = useAuth();
  const [n, setN] = useState("");
  const [whose, setWhose] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const seen = new Set<string>();
  const people = [...porches]
    .sort((a, b) => Number(b.refill_count > 0) - Number(a.refill_count > 0) || a.name.localeCompare(b.name))
    .filter((o) => o.customer_id && !seen.has(o.customer_id) && (seen.add(o.customer_id), true));
  // TODAY'S ENTRIES, so a miscount has somewhere to go (0309/0310).
  //
  // This was fire-and-forget: type a number, tap Log, and the $2-a-bottle credit was baked in with
  // no edit and no undo anywhere in the app. The deletion audit ranked it the worst remaining gap,
  // because it is the one a person hits routinely and it moves money.
  //
  // Deliberately only TODAY. A miscount is noticed within seconds of making it, so the useful scope
  // is "the ones I just logged" — a full ledger browser would be a different screen answering a
  // different question, and it would bury this one.
  const loader = useCallback(async (): Promise<{ id: string; returns: number }[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("v_loop_open")
      .select("id, returns").eq("on_date", etToday()).order("id");
    // Zero open loops and a failed read are different facts about the deposit ledger. Throwing
    // hands it to useAsyncData, which already keeps the previous list on screen instead of blanking.
    if (error) throw new Error(error.message);
    return (data as { id: string; returns: number }[]) ?? [];
  }, []);
  // useAsyncData rather than an effect that calls setState — the hook every other loader in this
  // app already uses, so this one stops being the exception.
  const board = useAsyncData<{ id: string; returns: number }[]>(loader, []);
  const today = board.data ?? [];
  const load = board.reload;

  const log = async () => {
    if (!supabase) return;
    const v = Math.round(Number(n));
    if (!Number.isFinite(v) || v <= 0) { setMsg("count first"); return; }
    const { error } = await supabase.from("loop_txns").insert({ returns: v, customer_id: whose || null, created_by: user?.id ?? null });
    setMsg(error ? failureWords(error, "couldn't log") : `logged ${v} return${v === 1 ? "" : "s"} · $${(v * 2).toFixed(0)} credit owed`);
    if (!error) { setN(""); setWhose(""); load(); }
  };

  const undo = async (id: string, count: number) => {
    if (!supabase) return;
    // The reason is required by the function, not optional politeness — a reversal nobody explained
    // is unreadable six weeks later, which is exactly when someone asks about the credit.
    const why = await prompt({ title: `Void the entry for ${count} return${count === 1 ? "" : "s"}?`, hint: "Say why — a reversal nobody explained is unreadable six weeks later.", defaultValue: "miscounted", confirmLabel: "Void it" });
    if (!why || !why.trim()) return;
    const { error } = await supabase.rpc("void_loop_txn", { p_id: id, p_reason: why.trim() });
    setMsg(error ? failureWords(error, "couldn't void") : `voided ${count} · $${(count * 2).toFixed(0)} credit taken back`);
    if (!error) load();
  };

  return (
    <div className="dops-loop">
      <span className="dops-loop-l">Loop returns{board.status === "error" ? " · couldn't load" : ""}</span>
      <input className="min-h-11" inputMode="numeric" value={n} onChange={(e) => { setN(e.target.value.replace(/\D/g, "")); setMsg(null); }} placeholder="bottles" aria-label="Loop bottles returned" />
      {people.length > 0 && (
        <select className="min-h-11" value={whose} onChange={(e) => setWhose(e.target.value)} aria-label="Whose bottles">
          <option value="">Whose bottles?</option>
          {people.map((o) => <option key={o.customer_id as string} value={o.customer_id as string}>{o.name}{o.refill_count > 0 ? " · swap" : ""}</option>)}
        </select>
      )}
      <button type="button" className="btn-sec btn-sm shrink-0" onClick={log} disabled={!n}>Log</button>
      {msg && <Said as="i" className="dops-loop-m">{msg}</Said>}
      {today.length > 0 && (
        <span className="dops-loop-today">
          today:
          {today.map((t) => (
            <button key={t.id} type="button" className="k-chip sm min-w-11"
                    title={`Void this entry of ${t.returns}`}
                    onClick={() => undo(t.id, t.returns)}>
              {t.returns}<span aria-hidden="true">×</span>
              <i className="sr-only">Void the entry for {t.returns} returns</i>
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

function DeliveryPackout({ bottles, orders, refills, onClose }: { bottles: number; orders: number; refills: number; onClose: () => void }) {
  const coolers = Math.max(1, Math.ceil(bottles / 24));      // ~24 glass bottles upright per hard cooler
  const gelPacks = coolers * 5;                               // 4–6 per cooler; 5 is the safe middle
  const returnBins = refills > 0 ? Math.max(1, Math.ceil(refills / 30)) : 0;
  return (
    <Sheet open onClose={onClose} label="Vehicle packout" header={<div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}><div><div className="dp-eyebrow"><Icon name="package" /> Vehicle packout · Sunday run</div><div className="dp-title">{bottles} bottles · {orders} porch{orders === 1 ? "" : "es"}</div></div><CloseButton onClick={onClose} /></div>}>
          <div className="brew-spec"><b>{coolers}</b> hard cooler{coolers === 1 ? "" : "s"} (24–48 qt) · <b>{gelPacks}</b> gel packs (pre-frozen){returnBins > 0 ? <> · <b>{returnBins}</b> empties bin{returnBins === 1 ? "" : "s"}</> : ""}</div>
          <div className="brew-block-h">Pack them in</div>
          <div className="brew-ing">
            <div className="brew-ing-row"><b>{coolers}×</b><span>Hard cooler with dividers or foam sleeves — GT3 glass upright, no clinking. ~24 bottles per cooler.</span></div>
            <div className="brew-ing-row"><b>{gelPacks}×</b><span>Gel/ice packs ONLY (no loose ice on glass), pre-frozen overnight. 2 flat on the floor, 1–2 on the caps per cooler.</span></div>
            {returnBins > 0 && <div className="brew-ing-row"><b>{returnBins}×</b><span>Empties bin/crate for the {refills} bottles coming back on today&rsquo;s swaps.</span></div>}
          </div>
          <div className="brew-block-h">Before you pull off</div>
          <ul className="brew-checks">
            <li>Pre-chill the coolers ~1 hr; target internal temp ≤ 38°F.</li>
            <li>Load coolers low and flat in the cargo area, braced so nothing slides on the drive.</li>
            <li>Run the AC — keep the cabin ≤ 65°F and the coolers out of direct sun.</li>
            <li>Stops are ordered by ZIP on the driver run — pull them in that order so glass rides cold to the last porch.</li>
          </ul>
    </Sheet>
  );
}
