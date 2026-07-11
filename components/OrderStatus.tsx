"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { DRINKS, type DrinkId } from "@/lib/menu";
import type { Order } from "@/lib/db";
import { saveSnapshot, readSnapshot, isNetworkError } from "./offline";
import { snapshotUsable } from "@/lib/offline";

// A live "your order" banner for signed-in members — preparing → ready in realtime,
// no push permission required (RLS lets a member read only their own orders). Guests
// (no account) still get the at-checkout confirmation; this closes the loop for members.
const STATUS_LABEL: Record<string, string> = {
  new: "Order received",
  preparing: "Preparing your order…",
  ready: "Ready — grab it at the bar",
};
const RANK: Record<string, number> = { ready: 3, preparing: 2, new: 1 };

export default function OrderStatus() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [canceling, setCanceling] = useState(false);
  const [etaBusy, setEtaBusy] = useState(false);
  const [etaOpen, setEtaOpen] = useState(false); // chips fold until asked for
  // Offline: a member who walks away from the truck (festival dead zones) still sees their
  // last-known status, labeled as such, instead of the banner vanishing.
  const [stale, setStale] = useState(false);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    if (!supabase || !user) { setOrders([]); return; }
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["new", "preparing", "ready"])
      .order("created_at", { ascending: false });
    if (data) {
      setOrders(data as Order[]); setStale(false); loadedOnce.current = true;
      saveSnapshot(`gt3-order-snap-${user.id}`, data);
      return;
    }
    if (error && !loadedOnce.current && isNetworkError(error.message)) {
      const snap = readSnapshot<Order[]>(`gt3-order-snap-${user.id}`);
      if (snap && snapshotUsable(snap.at, Date.now(), 90 * 60 * 1000) && snap.data.length > 0) { setOrders(snap.data); setStale(true); }
    }
  }, [user]);

  useEffect(() => {
    load();
    if (!supabase || !user) return;
    const interval = setInterval(load, 20000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", load);
    const ch = supabase
      .channel("my-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", load);
      supabase?.removeChannel(ch);
    };
  }, [load, user]);

  if (orders.length === 0) return null;
  // Surface the most-advanced active order (ready beats preparing beats new), newest first.
  const o = [...orders].sort((a, b) => (RANK[b.status] - RANK[a.status]) || (a.created_at < b.created_at ? 1 : -1))[0];
  const items = o.items.map((i) => DRINKS[i as DrinkId]?.n ?? i).join(" · ");
  const paid = Boolean((o as Order & { paid?: boolean }).paid);

  // Customer → pass quick replies ("I'm on the way / outside / running late"). One tap writes
  // eta_status via the definer RPC (owner-only, active orders only); the KDS shows it live and
  // OUTSIDE rings the pass so the crew calls the name. Tapping the active chip clears it.
  const setEta = async (eta: "on_way" | "outside" | "late") => {
    if (!supabase || etaBusy) return;
    setEtaBusy(true);
    const next = o.eta_status === eta ? null : eta;
    const { data } = await supabase.rpc("set_order_eta", { p_order: o.id, p_eta: next });
    setEtaBusy(false);
    if (data === true) load();
  };

  // Self-service cancel — allowed only while the order is still 'new' (not yet on the pass). The RPC
  // re-checks owner + status server-side; a paid order flags staff for the Square refund.
  const cancel = async () => {
    if (!supabase || canceling) return;
    if (!window.confirm(paid ? "Cancel this order? Your refund will follow shortly." : "Cancel this order?")) return;
    setCanceling(true);
    // Route (not the raw RPC) so canceling also pings the crew + texts/emails the customer.
    const ok = await authedFetch("/api/orders/cancel", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "cup", id: o.id }),
    }).then((r) => r.ok ? r.json() : null).then((d) => d?.ok === true).catch(() => false);
    setCanceling(false);
    if (ok) load();
  };

  return (
    <div className={`orderbar-wrap st-${o.status}`}>
      <div className={`orderbar st-${o.status}`} role="status" aria-live="polite">
        <span className="orderbar-dot" />
        <div className="orderbar-main">
          <b>{STATUS_LABEL[o.status] ?? "Your order"}</b>
          <span>{items}{orders.length > 1 ? ` · +${orders.length - 1} more` : ""}{stale ? " · offline — last known" : ""}</span>
        </div>
        {o.status === "new" && (
          <button type="button" className="orderbar-cancel" onClick={cancel} disabled={canceling}>
            {canceling ? "Canceling…" : "Cancel"}
          </button>
        )}
        <span className="orderbar-tag">#{o.id.slice(0, 4).toUpperCase()}</span>
      </div>
      {/* Talk to the truck — folded until asked for; once set, it collapses to the answer. */}
      {etaOpen ? (
        <div className="orderbar-eta" role="group" aria-label="Tell the truck">
          {([["on_way", "🏃 On my way"], ["outside", "📍 I'm outside"], ["late", "⏰ Running late"]] as const).map(([k, label]) => (
            <button key={k} type="button" className={`eta-chip${o.eta_status === k ? " on" : ""}`} disabled={etaBusy} onClick={async () => { await setEta(k); setEtaOpen(false); }} aria-pressed={o.eta_status === k}>
              {label}
            </button>
          ))}
        </div>
      ) : o.eta_status ? (
        <div className="orderbar-eta collapsed">
          <span className="eta-set">{({ on_way: "🏃 On my way", outside: "📍 I'm outside", late: "⏰ Running late" } as const)[o.eta_status]} ✓</span>
          <button type="button" className="eta-change" onClick={() => setEtaOpen(true)}>change</button>
        </div>
      ) : (
        <button type="button" className="eta-tell" onClick={() => setEtaOpen(true)}>Tell the truck ›</button>
      )}
    </div>
  );
}
