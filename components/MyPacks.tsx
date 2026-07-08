"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { mixSummary, dollars, emptyMix, type Mix, type GlassPath } from "@/lib/orderAhead";

// YOUR PACK — the customer's own reservations, right on /reserve. Reserving is only half the
// product: coming back should show what you've got coming, live (staff checking you off at the
// truck flips the card to "picked up" in realtime), with the two self-service moves that matter —
// change it (prefills the form; the new reservation replaces this one) or cancel it (definer RPC,
// 0136; a paid cancel routes the refund flag to the crew inbox). Renders nothing when signed out
// or when there's nothing upcoming — the reserve form stays the hero.
export type MyPack = {
  id: string; name: string; phone: string | null; size: number; glass: GlassPath;
  mix: Partial<Mix>; total_cents: number; paid: boolean; drop_date: string;
  picked_up: boolean; bottles_returned: boolean; canceled_at: string | null;
};

export const packDayLabel = (p: { drop_date: string }): string =>
  new Date(`${p.drop_date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
export const packMix = (p: { mix: Partial<Mix> }): Mix => ({ ...emptyMix(), ...p.mix });

export default function MyPacks({ onChange, refreshKey }: { onChange?: (p: MyPack) => void; refreshKey?: string }) {
  const { user } = useAuth();
  const { toast } = useApp();
  const [rows, setRows] = useState<MyPack[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !user) { setRows([]); return; }
    // Yesterday's date-floor keeps today's drop visible all day regardless of timezone drift.
    const floor = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data } = await supabase.from("drop_orders").select("*")
      .eq("user_id", user.id).is("canceled_at", null).gte("drop_date", floor)
      .order("drop_date").order("created_at");
    setRows((data as MyPack[]) ?? []);
  }, [user]);

  useEffect(() => {
    load();
    if (!supabase || !user) return;
    // Live: staff checking off pickup at the truck flips this card in front of the customer.
    const ch = supabase.channel("my-packs")
      .on("postgres_changes", { event: "*", schema: "public", table: "drop_orders", filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load, user, refreshKey]);

  const cancel = async (p: MyPack) => {
    if (!supabase || busy) return;
    const day = packDayLabel(p);
    const msg = p.paid
      ? `Cancel your ${p.size}-pack for ${day}?\n\nYou paid ${dollars(p.total_cents / 100)} — your refund will follow shortly.`
      : `Cancel your ${p.size}-pack for ${day}? Nothing was charged.`;
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    setBusy(p.id);
    const { data, error } = await supabase.rpc("cancel_own_reservation", { p_id: p.id });
    setBusy(null);
    if (error || data !== true) { toast("Couldn't cancel — it may already be picked up. Ask at the truck.", "error"); load(); return; }
    toast(p.paid ? "Canceled — refund on the way" : "Reservation canceled");
    load();
  };

  if (!user || rows.length === 0) return null;
  return (
    <div className="mypacks">
      <div className="mypacks-h">Your pack{rows.length > 1 ? "s" : ""}</div>
      {rows.map((p) => (
        <div className={`mypack${p.picked_up ? " done" : ""}`} key={p.id}>
          <div className="mypack-top">
            <b>{p.size}-pack · {packDayLabel(p)}</b>
            <span className={`mypack-pay${p.paid ? " ok" : ""}`}>{p.paid ? "PAID" : "pay at pickup"}</span>
          </div>
          <div className="mypack-mix">{mixSummary(packMix(p)) || "—"} · {p.glass === "return" ? "bringing bottles back" : "new glass"} · {dollars(p.total_cents / 100)}</div>
          <div className="mypack-st">
            {p.picked_up ? "✓ Picked up — enjoy" : `Reserved under ${p.name.split(" ")[0]} · #${p.id.slice(0, 6).toUpperCase()} — we brew it fresh for pickup day`}
          </div>
          {!p.picked_up && (
            <div className="mypack-actions">
              {onChange && <button type="button" onClick={() => onChange(p)}>Change pack</button>}
              <button type="button" className="danger" onClick={() => cancel(p)} disabled={busy === p.id}>{busy === p.id ? "Canceling…" : "Cancel"}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
