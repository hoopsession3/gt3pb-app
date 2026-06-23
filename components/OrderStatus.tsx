"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import { DRINKS, type DrinkId } from "@/lib/menu";
import type { Order } from "@/lib/db";

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

  const load = useCallback(async () => {
    if (!supabase || !user) { setOrders([]); return; }
    const { data } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["new", "preparing", "ready"])
      .order("created_at", { ascending: false });
    if (data) setOrders(data as Order[]);
  }, [user]);

  useEffect(() => {
    load();
    if (!supabase || !user) return;
    const ch = supabase
      .channel("my-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load, user]);

  if (orders.length === 0) return null;
  // Surface the most-advanced active order (ready beats preparing beats new), newest first.
  const o = [...orders].sort((a, b) => (RANK[b.status] - RANK[a.status]) || (a.created_at < b.created_at ? 1 : -1))[0];
  const items = o.items.map((i) => DRINKS[i as DrinkId]?.n ?? i).join(" · ");

  return (
    <div className={`orderbar st-${o.status}`} role="status" aria-live="polite">
      <span className="orderbar-dot" />
      <div className="orderbar-main">
        <b>{STATUS_LABEL[o.status] ?? "Your order"}</b>
        <span>{items}{orders.length > 1 ? ` · +${orders.length - 1} more` : ""}</span>
      </div>
      <span className="orderbar-tag">#{o.id.slice(0, 4).toUpperCase()}</span>
    </div>
  );
}
