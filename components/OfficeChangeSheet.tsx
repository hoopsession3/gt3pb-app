"use client";

import { useEffect, useRef, useState } from "react";
import Sheet, { CloseButton } from "@/components/Sheet";
import { Segmented } from "@/components/controls";
import { useApp } from "@/components/AppProvider";
import { supabase } from "@/lib/supabase";
import { haptic } from "@/lib/haptics";
import { money } from "@/lib/money";
import { windowHours } from "@/lib/office";
import { nextIdem, type IdemState } from "@/lib/idempotency";
import { changeable, cutoffLabel, dayLabel, deliveryState, type OfficeDelivery } from "@/lib/officeStatus";
import { OFFICE_REASONS, askOf, changePlan, draftOf, stepWords, type ChangeDraft, type ChangeStep, type OfficeReason } from "@/lib/officeChange";

// CHANGE IT IN ONE SHEET (2026-10-07, Phase 2A-2 — the mock's screen B). One delivery: its gallons,
// skip it (or bring a skip back), move it to another morning, a note for the driver — saved by
// office_change_delivery (0359), which keeps every rule: the cutoff, whole jugs and the minimum, a
// settled delivery's money, who may change what. Until the cutoff it saves; after it — or for the
// parts the database would refuse now — the same sheet sends them to GT3 as one request
// (office_request), so a client is never left looking at a dead button. The sheet shows the cutoff in
// the delivery's own city, and the clock it is handed moves while it is open: a sheet left open past
// 6 PM stops offering a save the database would refuse.
//
// Each step is its own call with its own key (lib/idempotency's rule): a retry of a step that failed
// carries the same key, so the database answers the change it already made instead of making it twice;
// once a step lands its key is spent, and the next change of that kind gets a new one.

type Props = {
  delivery: OfficeDelivery;
  /** where it goes, as the client calls it ("Suite 300 front desk") */
  place: string | null;
  canChange: boolean;
  canRequest: boolean;
  minGallons: number;
  now: number;
  /** opened from the card's Skip: the sheet starts with the skip on, for a Save (and a reason) */
  startSkip?: boolean;
  onClose: () => void;
  /** something was saved or sent: read the home again */
  onChanged: () => void;
};

const MAX_GALLONS = 100;   // past this the database asks for a request (we plan the brew)

/** "Tue 13" — a morning beside the delivery's own; the month too when it is another month's. */
function chipDay(key: string, ref: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  const wd = d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" });
  const sameMonth = key.slice(0, 7) === ref.slice(0, 7);
  return sameMonth ? `${wd} ${d.getUTCDate()}` : `${wd}, ${d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}`;
}

export default function OfficeChangeSheet({ delivery: d, place, canChange, canRequest, minGallons, now, startSkip = false, onClose, onChanged }: Props) {
  const { toast } = useApp();
  const [draft, setDraft] = useState<ChangeDraft>(() => ({ ...draftOf(d), skip: draftOf(d).skip || (startSkip && !d.canceled) }));
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  // The database said the changes closed while the sheet was open (55000): everything left is a request.
  const [closedNow, setClosedNow] = useState(false);
  const [dates, setDates] = useState<string[] | null>(null);
  const [datesErr, setDatesErr] = useState(false);
  const keys = useRef<Record<string, IdemState>>({});

  const skipped = d.canceled && d.canceled_reason === "skipped";
  const open = canChange && !closedNow && changeable(d, now);
  // What may save now; everything else, a request (when this person may send one).
  const seen: OfficeDelivery = { ...d, open, note_open: canChange && d.note_open };
  const plan = changePlan(seen, draft, now);
  const asks = canRequest ? plan.asks : [];
  const cut = cutoffLabel(d.cutoff_at, d.market, now);
  const state = deliveryState(d);
  const price = d.price_per_gallon_cents ?? 0;
  const lowering = Math.round(draft.gallons) < Math.round(d.gallons);
  const askWhy = !skipped && (draft.skip || lowering || (!!draft.moveTo && draft.moveTo !== d.date));
  const dirty = plan.steps.length + plan.asks.length > 0 || extra.trim().length > 0;
  const readOnly = !canChange && !canRequest;

  // The mornings it can move to — asked of the database (office_open_dates), never worked out here.
  useEffect(() => {
    if (!supabase || !open || skipped || d.canceled) return;
    let live = true;
    supabase.rpc("office_open_dates", { p_order: d.id }).then(({ data, error }) => {
      if (!live) return;
      if (error) { setDatesErr(true); return; }
      setDates(((data as { delivery_date: string }[] | null) ?? []).map((r) => r.delivery_date).sort());
    });
    return () => { live = false; };
  }, [d.id, open, skipped, d.canceled]);

  const set = (p: Partial<ChangeDraft>) => setDraft((x) => ({ ...x, ...p }));
  const flipSkip = () => { if (draft.skip) haptic("toggleOff"); else haptic("toggleOn"); set({ skip: !draft.skip }); };
  const step = (by: number) => {
    const g = Math.round(draft.gallons) + by;
    if (g < minGallons || g > MAX_GALLONS) { haptic("boundary"); return; }
    if (by > 0) haptic("increase"); else haptic("decrease");
    set({ gallons: g });
  };

  const keyFor = (kind: string, details: unknown) => (keys.current[kind] = nextIdem(keys.current[kind], d.id, details)).key;

  const run = async (s: ChangeStep) => {
    const key = keyFor(s.change, s);
    const res = await supabase!.rpc("office_change_delivery", {
      p_order: d.id, p_change: s.change,
      p_gallons: s.change === "quantity" ? s.gallons : null,
      p_to: s.change === "move" ? s.to : null,
      p_note: s.change === "note" ? s.note : null,
      p_reason: s.change === "quantity" || s.change === "skip" || s.change === "move" ? draft.reason : null,
      p_key: key,
    });
    if (!res.error) delete keys.current[s.change];
    return res.error;
  };

  const save = async () => {
    if (!supabase || busy || readOnly) return;
    if (!plan.steps.length && !asks.length) return;
    setBusy(true);
    let saved = 0;
    for (const s of plan.steps) {
      const error = await run(s);
      if (!error) { saved++; continue; }
      setBusy(false);
      onChanged();
      if (error.code === "55000") {
        // Closed while the sheet was open (or the driver left): the rest goes to GT3 from here.
        setClosedNow(true);
        toast(error.message, "error");
      } else if (error.code === "P0002") {
        toast("That delivery isn't on the schedule any more.", "error");
        onClose();
      } else {
        // 22023 / 42501 are sentences a person can act on ("The minimum is 3 gallons.")
        toast(error.code === "22023" || error.code === "42501" ? error.message : "Couldn't save — try again", "error");
      }
      return;
    }
    if (asks.length) {
      const ask = askOf(d, asks, extra, now);
      const wants = { changes: asks, reason: draft.reason };
      const { error } = await supabase.rpc("office_request", {
        p_kind: ask.kind, p_body: ask.body, p_order: d.id, p_company: null, p_wants: wants, p_key: keyFor("request", ask),
      });
      setBusy(false);
      onChanged();
      if (error) { toast(error.code === "22023" || error.code === "42501" ? error.message : "Couldn't send it — try again", "error"); return; }
      delete keys.current.request;
      haptic("success");
      toast(saved ? "Saved — and the rest is with GT3" : "Sent — GT3 has it and will reply here");
      onClose();
      return;
    }
    setBusy(false);
    onChanged();
    haptic("success");
    toast("Saved — the crew sees it now");
    onClose();
  };

  const label = !plan.steps.length && asks.length ? "Send to GT3" : plan.steps.length && asks.length ? "Save, and send the rest to GT3" : "Save changes";
  // its own morning among the others, in date order: the chosen one is where the calendar would put it
  const moveOpts = dates ? [...new Set([...dates, d.date])].sort() : null;

  const header = (
    <div className="office-head">
      <span className="flex flex-col gap-0.5 min-w-0">
        <b className="office-head-t">{dayLabel(d.date, true)} · {windowHours(d.window)}</b>
        <span className="font-sans text-[12.5px] text-cream-muted truncate">{[place, state.label].filter(Boolean).join(" · ")}</span>
      </span>
      <CloseButton className="isheet-x" onClick={onClose} />
    </div>
  );

  const footer = readOnly ? undefined : (
    <div className="flex flex-col gap-2 w-full">
      {cut && (!d.canceled || skipped) && (
        <p className="m-0 font-sans text-[12.5px] leading-snug text-cream-muted text-center">
          {cut.closed || closedNow ? <>Changes closed <b className="text-cream">{cut.when}</b> — what you ask now goes to GT3.</>
            : <>Changes close <b className="text-cream">{cut.when}</b>. After that, this sheet sends GT3 a request.</>}
        </p>
      )}
      <button type="button" className="handle" onClick={save} disabled={busy || (!plan.steps.length && !asks.length)}>
        <span>{busy ? "Saving…" : label}</span>
      </button>
    </div>
  );

  return (
    <Sheet open onClose={onClose} label={`Change the ${dayLabel(d.date)} delivery`} header={header} footer={footer}
      className="office-sheet" dirty={dirty} dismissible={!busy}>

      {readOnly && (
        <p className="office-lede">{Math.round(d.gallons)} gal · {state.label}. Your role can see deliveries but not change them — ask your office admin.</p>
      )}

      {!readOnly && skipped && (
        <>
          <p className="office-lede">Skipped{d.change_reason ? ` — ${OFFICE_REASONS.find((r) => r.key === d.change_reason)?.label.toLowerCase()}` : ""}. Your weekly order carries on; bring this one back any time before its cutoff.</p>
          <button type="button" className={`office-toggle${draft.skip ? " on" : ""}`} onClick={flipSkip} aria-pressed={draft.skip}>
            <span className="office-toggle-x"><b>Skip this delivery</b><span>{draft.skip ? "Off the schedule" : "Back on — it comes as planned"}</span></span>
            <span className="office-toggle-track"><span className="office-toggle-knob" /></span>
          </button>
        </>
      )}

      {!readOnly && !skipped && d.canceled && (
        <p className="office-lede">This delivery is {state.label.toLowerCase()} with your weekly order. Turn the weekly order back on to bring it back.</p>
      )}

      {!readOnly && !d.canceled && (
        <>
          {/* gallons */}
          <div className="office-gal">
            <div>
              <span className="office-k">Gallons</span>
              <span className="office-hint">{d.money_locked && open ? "Billed already — a new amount goes to GT3, who settle the difference" : `${minGallons}-gallon minimum · whole jugs`}</span>
            </div>
            <div className="office-step">
              <button type="button" onClick={() => step(-1)} aria-label="Fewer gallons" disabled={draft.skip || Math.round(draft.gallons) <= minGallons}>−</button>
              <span className="office-gal-v" aria-live="polite">{Math.round(draft.gallons)}</span>
              <button type="button" onClick={() => step(1)} aria-label="More gallons" disabled={draft.skip || Math.round(draft.gallons) >= MAX_GALLONS}>+</button>
            </div>
          </div>
          {price > 0 && (
            <div className="office-quote"><span>{Math.round(draft.gallons)} gal × {money(price)}</span><b>{money(Math.round(draft.gallons) * price)}</b></div>
          )}

          {/* this delivery */}
          <button type="button" className={`office-toggle${draft.skip ? " on" : ""}`} onClick={flipSkip} aria-pressed={draft.skip}>
            <span className="office-toggle-x"><b>Skip this delivery</b><span>{d.program_id ? "Your weekly order carries on after it" : "It won't come"}</span></span>
            <span className="office-toggle-track"><span className="office-toggle-knob" /></span>
          </button>

          {/* move it */}
          {!draft.skip && open && (
            <div className="flex flex-col gap-2 mt-4">
              <span className="office-k">Move it</span>
              <span className="office-hint mt-0">Same window, another morning</span>
              {datesErr ? <p className="office-fine mt-0">Couldn&rsquo;t load the other mornings — close this and open it again.</p>
                : !moveOpts ? <p className="office-fine mt-0">Finding the open mornings…</p>
                : moveOpts.length < 2 ? <p className="office-fine mt-0">No other open morning in the two weeks around it.</p>
                : <Segmented kind="choice" label="Move it to" value={draft.moveTo ?? d.date}
                    onChange={(k) => { haptic("selection"); set({ moveTo: k === d.date ? null : k }); }}
                    options={moveOpts.map((k) => ({ key: k, label: chipDay(k, d.date), title: dayLabel(k, true) }))} />}
            </div>
          )}

          {/* for the driver */}
          <label className="flex flex-col gap-2 mt-4">
            <span className="office-k">For the driver</span>
            <textarea className="auth-input min-h-[68px] resize-none" rows={2} maxLength={300} value={draft.note}
              onChange={(e) => set({ note: e.target.value })} disabled={!canChange || !d.note_open}
              placeholder={d.note_open ? "Front desk opens 6:30 — leave with security before that." : "The driver has left for this one."} />
          </label>
        </>
      )}

      {/* why — optional, and only when there's something to explain */}
      {!readOnly && askWhy && (
        <div className="flex flex-col gap-2 mt-4">
          <span className="office-k">Why? <span className="normal-case tracking-normal text-cream-dim">optional</span></span>
          <Segmented kind="choice" label="Why" value={draft.reason ?? ("" as OfficeReason)} onChange={(k) => { haptic("selection"); set({ reason: draft.reason === k ? null : k }); }}
            options={OFFICE_REASONS.map((r) => ({ key: r.key, label: r.label }))} />
        </div>
      )}

      {/* what goes to GT3 instead */}
      {!readOnly && asks.length > 0 && (
        <div className="flex flex-col gap-2 mt-4 p-3.5 rounded-2xl border border-line2">
          <span className="office-k">This goes to GT3 as a request</span>
          <ul className="m-0 pl-4 font-sans text-[13.5px] leading-normal text-cream">
            {asks.map((s) => <li key={s.change}>{stepWords(s)}</li>)}
          </ul>
          <input className="auth-input" value={extra} onChange={(e) => setExtra(e.target.value)} maxLength={600}
            placeholder="Anything else? (optional)" aria-label="Anything else GT3 should know" />
        </div>
      )}
      {!readOnly && !canRequest && plan.asks.length > 0 && (
        <p className="office-fine">Your role can&rsquo;t send requests — ask your office admin to.</p>
      )}
    </Sheet>
  );
}
