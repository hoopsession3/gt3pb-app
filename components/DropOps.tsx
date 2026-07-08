"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { FLAVORS, nextDrop, dropDateKey, mixSummary, dollars, type GlassPath, type Mix } from "@/lib/orderAhead";

// DROP OPS — the order-ahead brew sheet + pickup checklist for Saturday's drop. Lives in the admin
// "Now" section right under the kitchen pass (and pops out of reservation alerts), so walk-up orders
// and reservations are one surface. Realtime like the KDS; staff-gated by RLS (0119).
// Fulfillment: staff can move a reservation to next week's drop or cancel it (canceled rows keep
// their id for the audit trail and drop out of totals; a PAID cancel flags the Square refund).
// Planning: one tap turns the brew sheet into planned brew_batches rows for Friday — sized from the
// bottle counts (production is spec'd in 10-oz servings, 0079), linked to the drop by drop_date, and
// picked up by the existing brew windows/timers from there.
type DropOrder = {
  id: string; name: string; phone: string | null; size: number; glass: GlassPath;
  mix: Mix; total_cents: number; paid: boolean; drop_date: string; picked_up: boolean; bottles_returned: boolean;
  canceled_at?: string | null;
};
type PlannedBatch = { id: string; recipe_name: string | null; batch_gal: number; status: string };

const GAL_PER_BOTTLE = 10 / 128; // one bottle = one 10-oz serving (the brew spec's unit)
const quarterGal = (g: number) => Math.max(0.25, Math.ceil(g * 4) / 4);

// Channels are keyed by NAME and a fast remount (Service mode toggles this component) can
// grab the old still-subscribed instance -> "cannot add callbacks after subscribe()" and an error
// boundary. Unique name per subscription, same fix as lib/availability.
let dropOpsChanSeq = 0;
// Two faces: `brief` is the Now screen's prep face (what to brew, what money, one progress line —
// tapping it opens Service mode); full is the working face (checklist, upcoming, history) and
// lives in Service mode only, so the same list never renders on two screens.
export default function DropOps({ brief = false, onOpen }: { brief?: boolean; onOpen?: () => void } = {}) {
  const { toast } = useApp();
  const [rows, setRows] = useState<DropOrder[]>([]);
  const [batches, setBatches] = useState<PlannedBatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<DropOrder[]>([]); // past drops — where fulfilled orders live on
  const [upcoming, setUpcoming] = useState<DropOrder[]>([]); // future drops — moved packs stay visible here
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

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("drop_orders").select("*").eq("drop_date", dropISO).is("canceled_at", null).order("created_at");
    if (data) setRows(data as DropOrder[]);
  }, [dropISO]);
  const loadBatches = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("brew_batches").select("id, recipe_name, batch_gal, status").eq("drop_date", dropISO).order("recipe_name");
    setBatches((data as PlannedBatch[]) ?? []);
  }, [dropISO]);
  const loadHistory = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("drop_orders").select("*").lt("drop_date", dropISO)
      .order("drop_date", { ascending: false }).order("created_at").limit(200);
    setHistory((data as DropOrder[]) ?? []);
  }, [dropISO]);
  // Future drops must render SOMEWHERE — before this, "→ Next drop" moved a pack into a week no
  // query covered and it vanished from every surface until that date arrived.
  const loadUpcoming = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("drop_orders").select("*").gt("drop_date", dropISO)
      .is("canceled_at", null).order("drop_date").order("created_at").limit(100);
    setUpcoming((data as DropOrder[]) ?? []);
  }, [dropISO]);

  useEffect(() => {
    load(); loadBatches(); loadHistory(); loadUpcoming();
    if (!supabase) return;
    const ch = supabase.channel(`drop-ops-${++dropOpsChanSeq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "drop_orders" }, () => { load(); loadHistory(); loadUpcoming(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "brew_batches" }, () => loadBatches())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load, loadBatches, loadHistory, loadUpcoming]);

  const toggle = async (id: string, key: "picked_up" | "bottles_returned", val: boolean) => {
    if (!supabase) return;
    setRows((r) => r.map((o) => (o.id === id ? { ...o, [key]: val } : o))); // optimistic
    await supabase.from("drop_orders").update({ [key]: val }).eq("id", id);
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
    setRows((r) => r.filter((x) => x.id !== o.id)); // optimistic — it leaves this drop
    const { error } = await supabase.from("drop_orders").update({ drop_date: nextISO }).eq("id", o.id);
    if (error) { toast(`Couldn't move it — ${error.message}`, "error"); load(); return; }
    toast(`Moved to ${nextLabel} — it's under Upcoming drops`);
    loadUpcoming();
  };

  // The way back — pull an upcoming pack onto this drop.
  const pullBack = async (o: DropOrder) => {
    if (!supabase) return;
    setUpcoming((u) => u.filter((x) => x.id !== o.id)); // optimistic
    const { error } = await supabase.from("drop_orders").update({ drop_date: dropISO }).eq("id", o.id);
    if (error) { toast(`Couldn't move it — ${error.message}`, "error"); loadUpcoming(); return; }
    toast(`Back on ${satLabel}'s drop`);
    load();
  };

  // Cancel keeps the row (audit trail) and drops it from the sheet; a paid cancel flags the refund.
  const cancel = async (o: DropOrder) => {
    if (!supabase) return;
    const msg = o.paid
      ? `Cancel ${o.name}'s PAID ${o.size}-pack (${dollars(o.total_cents / 100)})?\n\nThe card refund is done in Square — the crew inbox gets a flag.`
      : `Cancel ${o.name}'s ${o.size}-pack (pay at pickup — nothing was charged)?`;
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    setRows((r) => r.filter((x) => x.id !== o.id)); // optimistic — current or upcoming, wherever it lives
    setUpcoming((u) => u.filter((x) => x.id !== o.id));
    const { error } = await supabase.from("drop_orders").update({ canceled_at: new Date().toISOString() }).eq("id", o.id);
    if (error) { toast(`Couldn't cancel — ${error.message}`, "error"); load(); return; }
    if (o.paid) {
      await supabase.from("alerts").insert({
        severity: "important", category: "money",
        title: "Canceled a PAID reservation — refund needed",
        body: `${o.name} · ${o.size}-pack · ${dollars(o.total_cents / 100)} for ${satLabel}'s drop. Refund it in Square.`,
        link: "/admin",
      });
    }
    toast("Reservation canceled");
  };

  // Turn the brew sheet into planned batches for Friday — sized per flavor from bottle counts and
  // each recipe's yield factor, linked to this drop by drop_date. The brew system takes it from there.
  const queueBrew = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    const wanted = FLAVORS.filter((f) => perF[f] > 0);
    const { data: recipes } = await supabase.from("brew_recipes")
      .select("id, name, product_slug, yield_factor").in("product_slug", wanted.map((f) => f.toLowerCase())).is("archived_at", null);
    const brewD = new Date(`${dropISO}T12:00:00`); brewD.setDate(brewD.getDate() - 1); // 18h cold extraction → brew the day before the drop
    const brewISO = brewD.toISOString().slice(0, 10);
    const ins = wanted.map((f) => {
      const r = (recipes ?? []).find((x) => x.product_slug === f.toLowerCase());
      const gal = quarterGal((perF[f] * GAL_PER_BOTTLE) / (Number(r?.yield_factor) || 0.92));
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
    loadBatches();
  };

  const bottles = rows.reduce((a, o) => a + o.size, 0);
  const glassBack = rows.filter((o) => o.glass === "return").reduce((a, o) => a + o.size, 0);
  const revenue = rows.reduce((a, o) => a + o.total_cents, 0) / 100;
  const dueAtWindow = rows.filter((o) => !o.paid).reduce((a, o) => a + o.total_cents, 0) / 100;
  const perF: Record<string, number> = { RISE: 0, FLOW: 0, DUSK: 0 };
  rows.forEach((o) => FLAVORS.forEach((f) => { perF[f] += o.mix?.[f] || 0; }));
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
  const isDropDay = rows.length > 0 && rows[0].drop_date === new Date().toISOString().slice(0, 10);
  const showList = listOpen ?? isDropDay;

  return (
    <div className="dops zone-pickup">
      <div className="dops-head"><span className="dops-kick">🧺 Pickup · reserves &amp; packs</span><b>{satLabel}&rsquo;s drop{rows.length > 0 ? ` · ${rows.length} pack${rows.length === 1 ? "" : "s"} reserved` : ""}</b></div>
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
        <div className="dops-empty">No reservations yet for this drop.</div>
      ) : (
        <>
          <div className="dops-brew">Brew sheet: <b>{FLAVORS.map((f) => `${perF[f]}× ${f}`).join(" · ")}</b></div>
          {batches.length > 0 ? (
            <div className="dops-plan queued">🫙 Brew plan queued: {batches.map((b) => `${b.recipe_name ?? "?"} — ${b.batch_gal} gal (${b.status})`).join(" · ")}</div>
          ) : bottles > 0 ? (
            <div className="dops-plan">
              <span>Friday&rsquo;s brew: {FLAVORS.filter((f) => perF[f] > 0).map((f) => `${quarterGal((perF[f] * GAL_PER_BOTTLE) / 0.92)} gal ${f}`).join(" · ")}</span>
              <button type="button" onClick={queueBrew} disabled={busy}>{busy ? "Queuing…" : "Queue brew batches"}</button>
            </div>
          ) : null}
          <button type="button" className={`dops-prog${allDone ? " done" : ""}`} onClick={() => (brief ? onOpen?.() : setListOpen(!showList))} aria-expanded={brief ? undefined : showList}>
            <span>{allDone ? "✓ All picked up · bottles in" : <><b>{pickedCount}/{rows.length}</b> picked up{returns.length > 0 ? <> · <b>{bottlesInCount}/{returns.length}</b> bottles in</> : null}</>}</span>
            <span>{brief ? "checklist in Service ▸" : showList ? "▾" : "▸"}</span>
          </button>
          {!brief && showList && queue.map((o) => (
            <div className={`dops-order${o.picked_up ? " done" : ""}`} key={`cur-${o.id}`}>
              <div className="dops-top">
                <span className="dops-name">{o.name}
                  <span className={`dops-chip ${o.glass === "return" ? "ret" : "new"}`}>{o.glass === "return" ? `GLASS BACK ×${o.size}` : "NEW GLASS"}</span>
                </span>
                <span className="dops-total">{dollars(o.total_cents / 100)} {o.paid ? "✓" : <em className="dops-owe">due</em>}</span>
              </div>
              <div className="dops-meta"><b>{o.size}-pack</b> — {mixSummary(o.mix)}{o.phone ? <><br /><a className="dops-tel" href={`tel:${o.phone.replace(/[^\d+]/g, "")}`}>{o.phone}</a></> : null}</div>
              <div className="dops-actions">
                <button type="button" className={`dops-check${o.picked_up ? " done" : ""}`} onClick={() => toggle(o.id, "picked_up", !o.picked_up)}>{o.picked_up ? "✓ Picked up" : "Picked up"}</button>
                {o.glass === "return" && (
                  <button type="button" className={`dops-check${o.bottles_returned ? " done" : ""}`} onClick={() => toggle(o.id, "bottles_returned", !o.bottles_returned)}>{o.bottles_returned ? "✓ Bottles in" : "Bottles in"}</button>
                )}
                {!o.picked_up && (
                  <>
                    <button type="button" className="dops-mini" onClick={() => pushNextWeek(o)}>→ Next drop</button>
                    <button type="button" className="dops-mini danger" onClick={() => cancel(o)}>Cancel</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </>
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
                  <span><b>{o.name}</b> — {o.size}-pack{o.paid ? " · paid ✓" : ""}</span>
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
                      {o.canceled_at ? "canceled" : o.picked_up ? `✓ picked up${o.glass === "return" ? (o.bottles_returned ? " · bottles in" : " · bottles out") : ""}` : "no-show"}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
