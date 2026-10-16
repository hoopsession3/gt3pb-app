"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { useConfirm } from "./ConfirmSheet";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import type { Order } from "@/lib/db";
import { saveSnapshot, readSnapshot, isNetworkError } from "./offline";
import { snapshotUsable } from "@/lib/offline";
import { isSettled } from "@/lib/settled";
import { cancelWords } from "@/lib/orderWords";
import { canceledHere } from "@/lib/activeOrder";

// A MEMBER'S OPEN CUP ORDERS, READ ONCE FOR EVERY SCREEN THAT SHOWS ONE (2026-10-13, R3 — Today leads with an order in
// progress). The order bar (components/OrderStatus) read them for itself; Today's order card reads the same, the same
// way: the member's own rows (RLS), realtime, every 20 seconds and on coming back to the page, and offline the last
// answer for 90 minutes, labelled as such (a festival dead zone). Moved out of OrderStatus unchanged.
export function useMyActiveOrders(): { orders: Order[]; stale: boolean; reload: () => void; failed: boolean } {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [stale, setStale] = useState(false);
  // FAILED IS NOT NONE (R7b): a first read that failed, with nothing kept from before, was an empty list — and Today led
  // with "Order again" over an order being made. The page says it couldn't check instead.
  const [failed, setFailed] = useState(false);
  const loadedOnce = useRef(false);

  // Nothing is set before the read answers (a signed-out phone simply has no orders: see the return).
  const reload = useCallback(async () => {
    if (!supabase || !user) return;
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["new", "preparing", "ready"])
      .order("created_at", { ascending: false });
    if (data) {
      setOrders(data as Order[]); setStale(false); setFailed(false); loadedOnce.current = true;
      saveSnapshot(`gt3-order-snap-${user.id}`, data);
      return;
    }
    if (error && !loadedOnce.current && isNetworkError(error.message)) {
      const snap = readSnapshot<Order[]>(`gt3-order-snap-${user.id}`);
      if (snap && snapshotUsable(snap.at, Date.now(), 90 * 60 * 1000) && snap.data.length > 0) { setOrders(snap.data); setStale(true); return; }
    }
    if (error && !loadedOnce.current) setFailed(true);
  }, [user]);

  useEffect(() => {
    void reload();
    if (!supabase || !user) return;
    const interval = setInterval(reload, 20000);
    const onVis = () => { if (document.visibilityState === "visible") void reload(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", reload);
    const ch = supabase
      .channel(`my-orders-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `user_id=eq.${user.id}` }, () => { void reload(); })
      .subscribe();
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", reload);
      supabase?.removeChannel(ch);
    };
  }, [reload, user]);

  return { orders: user ? orders : [], stale: !!user && stale, reload, failed: !!user && failed };
}

export type Eta = "on_way" | "outside" | "late";

/** What a member can do to an open order of theirs: tell the truck where they are (set_order_eta, owner-only, open
 *  orders only — the Pass shows it, and I'm outside rings it), and cancel it while it is still only "in" and not paid at
 *  the window (the database refuses anything else, 0341). Moved out of OrderStatus; a cancel that did not go through
 *  now says so instead of saying nothing. */
export function useOrderActions(o: Order | null, reload: () => void) {
  const confirm = useConfirm();
  const { toast } = useApp();
  const [etaBusy, setEtaBusy] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const setEta = useCallback(async (eta: Eta) => {
    if (!supabase || !o || etaBusy) return;
    setEtaBusy(true);
    const next = o.eta_status === eta ? null : eta;
    // try/finally: a thrown failure must not leave the buttons stuck busy for the rest of the session.
    try {
      const { data } = await supabase.rpc("set_order_eta", { p_order: o.id, p_eta: next });
      if (data === true) reload();
    } finally {
      setEtaBusy(false);
    }
  }, [o, etaBusy, reload]);

  const cancel = useCallback(async () => {
    if (!o || canceling) return;
    const paid = isSettled(o);
    if (!(await confirm({ title: "Cancel this order?", body: paid ? "We'll flag it for a refund and the crew will process it." : undefined, confirmLabel: "Cancel order", cancelLabel: "Keep order", danger: true }))) return;
    setCanceling(true);
    canceledHere(o.id);   // its own answer says it (below) — the realtime toast does not say it again (R7)
    // The route, not the bare function, so a cancel also tells the crew and the customer — and says what happened
    // (R3b): canceled and what becomes of the money, or why not, in the order's own words (lib/cancelWords).
    const said = await authedFetch("/api/orders/cancel", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "cup", id: o.id }),
    }).then((r) => r.json().catch(() => null)).catch(() => null) as { ok?: boolean; outcome?: string; now?: string; paid?: boolean } | null;
    setCanceling(false);
    const words = cancelWords(said);
    toast(words.text, words.ok ? "info" : "error");
    if (words.ok) reload();
  }, [o, canceling, confirm, reload, toast]);

  return { setEta, etaBusy, cancel, canceling };
}

export const ETA_WORDS: Record<Eta, string> = { on_way: "On my way", outside: "I'm outside", late: "Running late" };
