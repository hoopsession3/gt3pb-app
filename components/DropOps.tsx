"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { raiseAlertClient } from "@/lib/clientAlerts";
import { useApp } from "./AppProvider";
import { SectionHeader, InfoRow } from "@/components/kit";
import { FLAVORS, nextDrop, dropDateKey, mixSummary, dollars, type GlassPath, type Mix } from "@/lib/orderAhead";
import { gallonsForBottles, flavorDemand } from "@/lib/brewMath";
import { dayKey, etToday, relativeDay } from "@/lib/dates";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import EmptyState from "./EmptyState";
import Icon from "@/components/Icon";

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
};
type PlannedBatch = { id: string; recipe_name: string | null; batch_gal: number; status: string };
type Board = { rows: DropOrder[]; batches: PlannedBatch[]; history: DropOrder[]; upcoming: DropOrder[] };

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
export default function DropOps({ brief = false, onOpen, canPlan = false }: { brief?: boolean; onOpen?: () => void; canPlan?: boolean } = {}) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [listOpen, setListOpen] = useState<boolean | null>(null); // null = open on drop day only
  // The drop = the truck's NEXT scheduled stop (same resolution as the reserve flow + /api/reserve),
  // falling back to the Saturday cadence when the route is empty — the sheet and the reservations
  // must always agree on which date "this drop" is.
  const [drop, setDrop] = useState<{ iso: string; label: string }>(() => {
    const s = nextDrop().sat;
    return { iso: dropDateKey(s), label: s.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) };
  });
  useEffect(() => {
    if (!supabase) return;
    let liveFlag = true;
    supabase.from("stops").select("starts_at").is("archived_at", null).neq("status", "done").not("starts_at", "is", null)
      .gte("starts_at", new Date().toISOString()).order("starts_at", { ascending: true }).limit(1).maybeSingle()
      .then(({ data }) => {
        const at = (data as { starts_at?: string | null } | null)?.starts_at;
        if (liveFlag && at) {
          const d = new Date(at);
          setDrop({ iso: dropDateKey(d), label: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) });
        }
      });
    return () => { liveFlag = false; };
  }, []);
  const dropISO = drop.iso;
  const satLabel = drop.label;
  // Humanized, unambiguous drop date for the heading — "This Sat · Jul 18" instead of a bare
  // "Sat, Jul 18" (relativeDay + the absolute date, per lib/dates' caller contract). satLabel
  // stays the raw weekday label the toasts / confirms / alert bodies below already read.
  const dropWhen = `${relativeDay(dropISO)} · ${new Date(`${dropISO}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { rows: [], batches: [], history: [], upcoming: [] };
    const [r, b, h, u] = await Promise.all([
      supabase.from("drop_orders").select("*").eq("drop_date", dropISO).is("canceled_at", null).order("created_at"),
      supabase.from("brew_batches").select("id, recipe_name, batch_gal, status").eq("drop_date", dropISO).order("recipe_name"),
      supabase.from("drop_orders").select("*").lt("drop_date", dropISO).order("drop_date", { ascending: false }).order("created_at").limit(200),
      supabase.from("drop_orders").select("*").gt("drop_date", dropISO).is("canceled_at", null).order("drop_date").order("created_at").limit(100),
    ]);
    const firstErr = [r, b, h, u].find((x) => x.error)?.error;
    if (firstErr) throw new Error(firstErr.message);
    return {
      rows: (r.data as DropOrder[]) ?? [],
      batches: (b.data as PlannedBatch[]) ?? [],
      history: (h.data as DropOrder[]) ?? [],
      upcoming: (u.data as DropOrder[]) ?? [],
    };
  }, [dropISO]);
  const board = useAsyncData(loader, [dropISO]);
  const { reload } = board;
  useRealtimeTable("drop_orders", reload);
  useRealtimeTable("brew_batches", reload);

  const rows = board.data?.rows ?? [];
  const upcoming = board.data?.upcoming ?? [];
  const history = board.data?.history ?? [];
  const batches = board.data?.batches ?? [];

  const toggle = async (id: string, key: "picked_up" | "bottles_returned", val: boolean) => {
    if (!supabase) return;
    await supabase.from("drop_orders").update({ [key]: val }).eq("id", id);
    reload();
  };
  // Advance (or jump) a pack's fulfillment stage. The DB trigger keeps picked_up in sync, and the
  // customer's pack card updates live (drop_orders is realtime).
  const setStage = async (id: string, stage: PackStage) => {
    if (!supabase) return;
    await supabase.from("drop_orders").update({ stage }).eq("id", id);
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
    if (typeof window !== "undefined" && !window.confirm(`Move ${o.name}'s ${o.size}-pack to ${nextLabel}'s drop?`)) return;
    const { error } = await supabase.from("drop_orders").update({ drop_date: nextISO }).eq("id", o.id);
    if (error) { toast(`Couldn't move it — ${error.message}`, "error"); reload(); return; }
    toast(`Moved to ${nextLabel} — it's under Upcoming drops`);
    reload();
  };

  // The way back — pull an upcoming pack onto this drop.
  const pullBack = async (o: DropOrder) => {
    if (!supabase) return;
    const { error } = await supabase.from("drop_orders").update({ drop_date: dropISO }).eq("id", o.id);
    if (error) { toast(`Couldn't move it — ${error.message}`, "error"); reload(); return; }
    toast(`Back on ${satLabel}'s drop`);
    reload();
  };

  // Cancel keeps the row (audit trail) and drops it from the sheet; a paid cancel flags the refund.
  const cancel = async (o: DropOrder) => {
    if (!supabase) return;
    const msg = o.paid
      ? `Cancel ${o.name}'s PAID ${o.size}-pack (${dollars(o.total_cents / 100)})?\n\nThe card refund is done in Square — the crew inbox gets a flag.`
      : `Cancel ${o.name}'s ${o.size}-pack (pay at pickup — nothing was charged)?`;
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    const { error } = await supabase.from("drop_orders").update({ canceled_at: new Date().toISOString() }).eq("id", o.id);
    if (error) { toast(`Couldn't cancel — ${error.message}`, "error"); reload(); return; }
    if (o.paid) {
      await raiseAlertClient({
        severity: "important", category: "money", kind: "refund_needed", subjectId: o.id,
        title: "Canceled a PAID reservation — refund needed",
        body: `${o.name} · ${o.size}-pack · ${dollars(o.total_cents / 100)} for ${satLabel}'s drop. Refund it in Square.`,
        link: "/crew",
      });
    }
    toast("Reservation canceled");
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
        brew_date: brewISO, status: "planned", drop_date: dropISO,
        notes: `${perF[f]}× ${f} bottles for ${satLabel}'s drop`,
      };
    });
    const { error } = await supabase.from("brew_batches").insert(ins);
    setBusy(false);
    if (error) { toast(`Couldn't queue the brew — ${error.message}`, "error"); return; }
    toast(`Brew plan queued — ${ins.length} ${ins.length === 1 ? "batch" : "batches"} for Friday`);
    reload();
  };

  const bottles = rows.reduce((a, o) => a + o.size, 0);
  const glassBack = rows.filter((o) => o.glass === "return").reduce((a, o) => a + o.size, 0);
  const revenue = rows.reduce((a, o) => a + o.total_cents, 0) / 100;
  const dueAtWindow = rows.filter((o) => !o.paid).reduce((a, o) => a + o.total_cents, 0) / 100;
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

  return (
    <AsyncSection state={board} isEmpty={() => false} errorTitle="Couldn't load the drop" emptyTitle="Nothing here yet">
      {() => (
        <div className="dops zone-pickup">
          {/* The drop block is a card now (matches the crew console's .mpanel panels) so the heading
              reads as a titled surface, not a bare floating line. SectionHeader supplies its own top
              spacing; the card only pads sides + bottom. */}
          <div className="mpanel" style={{ padding: "0 14px 14px" }}>
            <SectionHeader
              label="Pickup · reserves & packs"
              annotation={`${dropWhen}'s drop${rows.length > 0 ? ` · ${rows.length} pack${rows.length === 1 ? "" : "s"}` : ""}`}
            />
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
                  {canPlan && <button type="button" onClick={queueBrew} disabled={busy}>{busy ? "Queuing…" : "Queue brew batches"}</button>}
                </div>
              ) : null}
              <button type="button" className={`dops-prog${allDone ? " done" : ""}`} onClick={() => (brief ? onOpen?.() : setListOpen(!showList))} aria-expanded={brief ? undefined : showList}>
                <span>{allDone ? <><Icon name="check" /> All picked up · bottles in</> : <><b>{pickedCount}/{rows.length}</b> picked up{returns.length > 0 ? <> · <b>{bottlesInCount}/{returns.length}</b> bottles in</> : null}</>}</span>
                <span>{brief ? "checklist in Service ▸" : showList ? "▾" : "▸"}</span>
              </button>
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
                      trailing={<span className="dops-total">{dollars(o.total_cents / 100)} {o.paid ? <Icon name="check" /> : <em className="dops-owe">due</em>}</span>}
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
                              <button key={st.key} type="button" className={`dops-stage${on ? " on" : ""}${done ? " done" : ""}`} aria-current={on} onClick={() => setStage(o.id, st.key)}>
                                {done ? <><Icon name="check" /> {st.label}</> : st.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="dops-actions">
                          {nextLabel && <button type="button" className="dops-check adv" onClick={() => setStage(o.id, PACK_STAGES[cur + 1].key)}>{nextLabel}</button>}
                          {o.glass === "return" && (
                            <button type="button" className={`dops-check${o.bottles_returned ? " done" : ""}`} onClick={() => toggle(o.id, "bottles_returned", !o.bottles_returned)}>{o.bottles_returned ? <><Icon name="check" /> Bottles in</> : "Bottles in"}</button>
                          )}
                          {!o.picked_up && (
                            <>
                              <button type="button" className="dops-mini" onClick={() => pushNextWeek(o)}><Icon name="arrowRight" /> Next drop</button>
                              <button type="button" className="dops-mini danger" onClick={() => cancel(o)}>Cancel</button>
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
          </div>
          {/* Moved packs land here in the same breath — never off any surface. Grouped by date so a
              glance says what next week already owes. */}
          {!brief && upcoming.length > 0 && (
            <div className="dops-up">
              {Object.entries(upcoming.reduce<Record<string, DropOrder[]>>((m, o) => { (m[o.drop_date] ??= []).push(o); return m; }, {})).map(([d, os]) => (
                <div key={d}>
                  <div className="dops-up-h">Upcoming · {new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {os.reduce((a, o) => a + o.size, 0)} bottles</div>
                  {os.map((o) => (
                    <div className="dops-up-row" key={o.id}>
                      <span><b>{o.name}</b> — {o.size}-pack{o.paid ? <> · paid <Icon name="check" /></> : ""}</span>
                      <span className="dops-up-act">
                        <button type="button" className="dops-mini" onClick={() => pullBack(o)}>← This drop</button>
                        <button type="button" className="dops-mini danger" onClick={() => cancel(o)}>Cancel</button>
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {!brief && history.length > 0 && (
            <div className="dops-hist">
              <button type="button" className="dops-hist-h" onClick={() => setHistOpen((v) => !v)} aria-expanded={histOpen}>
                Past drops · {new Set(history.map((o) => o.drop_date)).size} <span>{histOpen ? "▾" : "▸"}</span>
              </button>
              {histOpen && Object.entries(history.reduce<Record<string, DropOrder[]>>((m, o) => { (m[o.drop_date] ??= []).push(o); return m; }, {})).map(([d, os]) => {
                const kept = os.filter((o) => !o.canceled_at);
                const rev = kept.reduce((a, o) => a + o.total_cents, 0) / 100;
                const label = new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
                return (
                  <div className="dops-hist-drop" key={d}>
                    <div className="dops-hist-meta"><b>{label}</b> · {kept.length} pack{kept.length === 1 ? "" : "s"} · {kept.reduce((a, o) => a + o.size, 0)} bottles · {dollars(rev)}</div>
                    {os.map((o) => (
                      <div className="dops-hist-row" key={o.id}>
                        <span>{o.name} — {o.size}-pack{o.paid ? "" : " · unpaid"}</span>
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
        </div>
      )}
    </AsyncSection>
  );
}
