"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { useRealtimeTable } from "@/lib/realtime";

// YOUR DELIVERIES — the customer's own Sunday-delivery orders, on /3mpire. The delivery success
// screen promises "track it in your account"; this is what makes that true. Mirrors MyPacks exactly
// (same tracker card, same live realtime, same self-cancel) so packs and deliveries read as one
// system, not two. Renders nothing when signed out or with nothing upcoming.
type DeliveryStatus = "received" | "brewed" | "out_for_delivery" | "delivered" | "held_for_pickup" | "issue";
type MyDelivery = {
  id: string; delivery_date: string; pack_size: number;
  address_street: string; address_city: string; address_zip: string;
  rise_count: number; flow_count: number; dusk_count: number; performance_count: number; refill_count: number;
  total_cents: number; payment_status: "pending" | "paid" | "failed" | "refunded";
  status: DeliveryStatus; canceled_at: string | null;
};

const STAGE_VIEW: Record<DeliveryStatus, { label: string; note: string }> = {
  received: { label: "Received", note: "we brew it fresh for delivery day" },
  brewed: { label: "Brewed", note: "bottled and ready to roll" },
  out_for_delivery: { label: "On the way", note: "your delivery is heading to you" },
  delivered: { label: "Delivered", note: "enjoy — fresh for 7 days" },
  held_for_pickup: { label: "Held for pickup", note: "no empties out — grab it at GT3PB" },
  issue: { label: "Needs a look", note: "we'll reach out to sort it" },
};
const STEPS: DeliveryStatus[] = ["brewed", "out_for_delivery", "delivered"];

const money = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const mixLine = (p: MyDelivery) => {
  const parts: string[] = [];
  if (p.rise_count) parts.push(`${p.rise_count}× RISE`);
  if (p.flow_count) parts.push(`${p.flow_count}× FLOW`);
  if (p.dusk_count) parts.push(`${p.dusk_count}× DUSK`);
  if (p.performance_count) parts.push(`${p.performance_count}× premium`);
  return parts.join(" · ") || "—";
};

export default function MyDeliveries() {
  const { user } = useAuth();
  const { toast } = useApp();
  const [rows, setRows] = useState<MyDelivery[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !user) { setRows([]); return; }
    // Yesterday's floor keeps today's delivery visible all day regardless of timezone drift.
    const floor = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data } = await supabase.from("delivery_orders").select("*")
      .eq("user_id", user.id).is("canceled_at", null).gte("delivery_date", floor)
      .order("delivery_date").order("created_at");
    setRows((data as MyDelivery[]) ?? []);
  }, [user]);

  useEffect(() => { load(); }, [load]);
  // Live: crew flipping the order to brewed / out-for-delivery / delivered updates the card in front of the customer.
  useRealtimeTable({ table: "delivery_orders", filter: `user_id=eq.${user?.id}` }, load, { enabled: !!user });

  const cancel = async (p: MyDelivery) => {
    if (!supabase || busy) return;
    const msg = p.payment_status === "paid"
      ? `Cancel your ${p.pack_size}-bottle delivery for ${dayLabel(p.delivery_date)}?\n\nYou paid ${money(p.total_cents)} — your refund will follow shortly.`
      : `Cancel your ${p.pack_size}-bottle delivery for ${dayLabel(p.delivery_date)}?`;
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    setBusy(p.id);
    // Route (not the raw RPC) so canceling also pings the crew + texts/emails the customer.
    const ok = await authedFetch("/api/orders/cancel", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "delivery", id: p.id }),
    }).then((r) => r.ok ? r.json() : null).then((d) => d?.ok === true).catch(() => false);
    setBusy(null);
    if (!ok) { toast("Too late to cancel online — it's already being brewed. Text us and we'll help.", "error"); load(); return; }
    toast(p.payment_status === "paid" ? "Canceled — refund on the way" : "Delivery canceled");
    load();
  };

  if (!user || rows.length === 0) return null;
  return (
    <div className="mypacks">
      <div className="mypacks-h">Your deliver{rows.length > 1 ? "ies" : "y"}</div>
      {rows.map((p) => {
        const isOpen = open === p.id;
        const done = p.status === "delivered";
        return (
          <div className={`mypack${done ? " done" : ""}${isOpen ? " open" : ""}`} key={p.id}>
            <button type="button" className="mypack-row" onClick={() => setOpen(isOpen ? null : p.id)} aria-expanded={isOpen}>
              <b>{p.pack_size}-bottle delivery · {dayLabel(p.delivery_date)}</b>
              <span className="mypack-rt">
                <span className={`mypack-pay${p.payment_status === "paid" ? " ok" : ""}`}>
                  {done ? "✓ DELIVERED" : p.payment_status === "paid" ? "PAID" : p.payment_status === "refunded" ? "REFUNDED" : p.payment_status === "failed" ? "payment failed" : "pending"}
                </span>
                <span className="mypack-car">{isOpen ? "▾" : "▸"}</span>
              </span>
            </button>
            {isOpen && (
              <>
                <div className="mypack-mix">{mixLine(p)}{p.refill_count ? ` · ${p.refill_count} refill${p.refill_count > 1 ? "s" : ""}` : ""} · {money(p.total_cents)}</div>
                <div className="mypack-mix">{p.address_street}, {p.address_city} {p.address_zip}</div>
                {(() => {
                  const stage = p.status;
                  const view = STAGE_VIEW[stage] ?? STAGE_VIEW.received;
                  // held_for_pickup / issue are off the happy path — show the note, not the dot track.
                  const onTrack = stage === "received" || STEPS.includes(stage);
                  const curIdx = STEPS.indexOf(stage); // -1 while 'received'
                  return (
                    <>
                      {onTrack && (
                        <div className="mypack-track" role="img" aria-label={`Status: ${view.label}`}>
                          {STEPS.map((s, i) => (
                            <span key={s} className={`mypack-dot${i <= curIdx ? " on" : ""}${i === curIdx ? " now" : ""}`} title={STAGE_VIEW[s].label} />
                          ))}
                        </div>
                      )}
                      <div className="mypack-st">
                        <b>{view.label}</b> — {view.note}{stage === "received" ? ` · #${p.id.slice(0, 6).toUpperCase()}` : ""}
                      </div>
                    </>
                  );
                })()}
                {p.status === "received" && (
                  <div className="mypack-actions">
                    <button type="button" className="danger" onClick={() => cancel(p)} disabled={busy === p.id}>{busy === p.id ? "Canceling…" : "Cancel"}</button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
