"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { mixSummary, dollars, emptyMix, dropForStop, nextDrop, dropDateKey, type Mix, type GlassPath } from "@/lib/orderAhead";
import { authedFetch } from "@/lib/authedFetch";

// YOUR PACK — the customer's own reservations, right on /reserve. Reserving is only half the
// product: coming back should show what you've got coming, live (staff checking you off at the
// truck flips the card to "picked up" in realtime), with the two self-service moves that matter —
// change it (prefills the form; the new reservation replaces this one) or cancel it (definer RPC,
// 0136; a paid cancel routes the refund flag to the crew inbox). Renders nothing when signed out
// or when there's nothing upcoming — the reserve form stays the hero.
export type PackStage = "reserved" | "preparing" | "ready" | "en_route" | "picked_up";
export type MyPack = {
  id: string; name: string; phone: string | null; size: number; glass: GlassPath;
  mix: Partial<Mix>; total_cents: number; paid: boolean; drop_date: string;
  picked_up: boolean; bottles_returned: boolean; stage?: PackStage | null; canceled_at: string | null;
};

// What the customer sees for each stage the crew sets — plain, reassuring, present-tense.
const STAGE_VIEW: Record<PackStage, { label: string; note: string }> = {
  reserved: { label: "Reserved", note: "we brew it fresh for drop day" },
  preparing: { label: "Preparing", note: "we're brewing your pack now" },
  ready: { label: "Ready", note: "brewed and waiting for you" },
  en_route: { label: "On the way", note: "your pack is heading out" },
  picked_up: { label: "Picked up", note: "enjoy — see you at the next drop" },
};
const PACK_STEPS: PackStage[] = ["preparing", "ready", "en_route", "picked_up"];

export const packDayLabel = (p: { drop_date: string }): string =>
  new Date(`${p.drop_date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
export const packMix = (p: { mix: Partial<Mix> }): Mix => ({ ...emptyMix(), ...p.mix });

export default function MyPacks({ onChange, refreshKey }: { onChange?: (p: MyPack) => void; refreshKey?: string }) {
  const { user } = useAuth();
  const { toast } = useApp();
  const [rows, setRows] = useState<MyPack[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null); // pack id showing the day picker
  // The same upcoming-drop days the order form offers (real stops, still open) — so "move it"
  // can only land on a day the truck will actually be out.
  const [days, setDays] = useState<{ key: string; label: string }[]>([]);
  useEffect(() => {
    if (!supabase || !user) return;
    supabase.from("stops").select("starts_at").is("archived_at", null).neq("status", "done").not("starts_at", "is", null)
      .gte("starts_at", new Date().toISOString()).order("starts_at", { ascending: true }).limit(8)
      .then(({ data }) => {
        const seen = new Set<string>();
        const opts: { key: string; label: string }[] = [];
        for (const st of (data ?? []) as { starts_at: string }[]) {
          const d = dropForStop(st.starts_at);
          if (d.cutoff.getTime() <= Date.now()) continue;
          const key = st.starts_at.slice(0, 10);
          if (seen.has(key)) continue; seen.add(key);
          opts.push({ key, label: packDayLabel({ drop_date: key }) });
        }
        // Same fallback the reserve API uses: no scheduled stops → the Saturday cadence.
        if (opts.length === 0 && (data ?? []).length === 0) {
          const fb = nextDrop();
          opts.push({ key: dropDateKey(fb.sat), label: packDayLabel({ drop_date: dropDateKey(fb.sat) }) });
        }
        setDays(opts.slice(0, 4));
      });
  }, [user]);

  const moveDay = async (p: MyPack, toDate: string) => {
    if (busy) return;
    setBusy(p.id);
    try {
      const res = await authedFetch("/api/reserve/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, toDate }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || "Couldn't move it — try again.", "error"); return; }
      toast(`Moved to ${packDayLabel({ drop_date: toDate })} — see you then.`);
      setMoving(null); load();
    } finally { setBusy(null); }
  };

  const load = useCallback(async () => {
    if (!supabase || !user) { setRows([]); return; }
    // Yesterday's date-floor keeps today's drop visible all day regardless of timezone drift.
    const floor = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data } = await supabase.from("drop_orders").select("*")
      .eq("user_id", user.id).is("canceled_at", null).gte("drop_date", floor)
      .order("drop_date").order("created_at");
    setRows((data as MyPack[]) ?? []);
  }, [user]);

  useEffect(() => { load(); }, [load, refreshKey]);
  // Live: staff checking off pickup at the truck flips this card in front of the customer.
  useRealtimeTable({ table: "drop_orders", filter: `user_id=eq.${user?.id}` }, load, { enabled: !!user });

  const cancel = async (p: MyPack) => {
    if (!supabase || busy) return;
    const day = packDayLabel(p);
    const msg = p.paid
      ? `Cancel your ${p.size}-pack for ${day}?\n\nYou paid ${dollars(p.total_cents / 100)} — your refund will follow shortly.`
      : `Cancel your ${p.size}-pack for ${day}? Nothing was charged.`;
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    setBusy(p.id);
    const { data, error } = await supabase.rpc("cancel_any_order", { p_channel: "pickup", p_id: p.id });
    setBusy(null);
    if (error || data !== true) { toast("Couldn't cancel — it may already be picked up. Ask at the truck.", "error"); load(); return; }
    toast(p.paid ? "Canceled — refund on the way" : "Reservation canceled");
    load();
  };

  if (!user || rows.length === 0) return null;
  // Grouped by PICKUP DAY — three packs for one Saturday read as one plan ("Sat · 3 packs · 18
  // bottles"), not three look-alike rows. Tap a row for the mix + the self-service moves.
  const byDay = new Map<string, MyPack[]>();
  for (const p of rows) { const g = byDay.get(p.drop_date) ?? []; g.push(p); byDay.set(p.drop_date, g); }
  return (
    <div className="mypacks">
      <div className="mypacks-h">Your pack{rows.length > 1 ? "s" : ""}</div>
      {[...byDay.entries()].map(([day, group]) => (
        <div key={day} className="mypack-day">
          {group.length > 1 && (
            <div className="mypack-dayh">
              <b>{packDayLabel({ drop_date: day })}</b>
              <span>{group.length} packs · {group.reduce((s, x) => s + x.size, 0)} bottles · {group.filter((x) => x.paid).length ? `${group.filter((x) => x.paid).length} paid` : ""}{group.some((x) => !x.paid) ? `${group.filter((x) => x.paid).length ? " · " : ""}${group.filter((x) => !x.paid).length} at pickup` : ""}</span>
            </div>
          )}
          {group.map((p) => {
        const isOpen = open === p.id;
        return (
          <div className={`mypack${p.picked_up ? " done" : ""}${isOpen ? " open" : ""}`} key={p.id}>
            <button type="button" className="mypack-row" onClick={() => setOpen(isOpen ? null : p.id)} aria-expanded={isOpen}>
              <b>{p.size}-pack{group.length > 1 ? ` · ${mixSummary(packMix(p)) || "your mix"}` : ` · ${packDayLabel(p)}`}</b>
              <span className="mypack-rt">
                <span className={`mypack-pay${p.paid ? " ok" : ""}`}>{p.picked_up ? "✓ PICKED UP" : p.paid ? "PAID" : "pay at pickup"}</span>
                <span className="mypack-car">{isOpen ? "▾" : "▸"}</span>
              </span>
            </button>
            {isOpen && (
              <>
                <div className="mypack-mix">{mixSummary(packMix(p)) || "—"} · {p.glass === "return" ? "bringing bottles back" : "new glass"} · {dollars(p.total_cents / 100)}</div>
                {/* Live fulfillment tracker — the crew's stage, shown to the customer. */}
                {(() => {
                  const stage = (p.stage ?? (p.picked_up ? "picked_up" : "reserved")) as PackStage;
                  const view = STAGE_VIEW[stage] ?? STAGE_VIEW.reserved;
                  const curIdx = PACK_STEPS.indexOf(stage); // -1 while 'reserved'
                  return (
                    <>
                      <div className="mypack-track" role="img" aria-label={`Status: ${view.label}`}>
                        {PACK_STEPS.map((s, i) => (
                          <span key={s} className={`mypack-dot${i <= curIdx ? " on" : ""}${i === curIdx ? " now" : ""}`} title={STAGE_VIEW[s].label} />
                        ))}
                      </div>
                      <div className="mypack-st">
                        <b>{view.label}</b> — {view.note}{stage === "reserved" ? ` · #${p.id.slice(0, 6).toUpperCase()}` : ""}
                      </div>
                    </>
                  );
                })()}
                {!p.picked_up && (
                  <>
                    <div className="mypack-actions">
                      {days.some((d) => d.key !== p.drop_date) && (
                        <button type="button" onClick={() => setMoving(moving === p.id ? null : p.id)} aria-expanded={moving === p.id}>Move day</button>
                      )}
                      {onChange && <button type="button" onClick={() => onChange(p)}>Change the pack</button>}
                      <button type="button" className="danger" onClick={() => cancel(p)} disabled={busy === p.id}>{busy === p.id ? "Canceling…" : "Cancel"}</button>
                    </div>
                    {moving === p.id && (
                      <div className="mypack-move">
                        <span>Pick the new day — everything else stays the same.</span>
                        <div className="mypack-move-days">
                          {days.filter((d) => d.key !== p.drop_date).map((d) => (
                            <button key={d.key} type="button" disabled={busy === p.id} onClick={() => moveDay(p, d.key)}>{d.label}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        );
          })}
        </div>
      ))}
    </div>
  );
}
