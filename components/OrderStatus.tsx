"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
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

  // Self-service cancel — allowed only while the order is still 'new' (not yet on the pass). The RPC
  // re-checks owner + status server-side; a paid order flags staff for the Square refund.
  const cancel = async () => {
    if (!supabase || canceling) return;
    if (!window.confirm(paid ? "Cancel this order? Your refund will follow shortly." : "Cancel this order?")) return;
    setCanceling(true);
    const { data, error } = await supabase.rpc("cancel_own_order", { p_order: o.id });
    setCanceling(false);
    if (!error && data) load();
  };

  return (
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
  );
}
