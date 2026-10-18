"use client";

import { useEffect, useRef } from "react";
import { useAppStable } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/money";
import { orderNo, wasCanceledHere } from "@/lib/activeOrder";
import { orderLine } from "@/lib/orderWords";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Short kitchen chime for new tickets.
function chime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.07;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
    setTimeout(() => { try { o.stop(); ctx.close(); } catch { /* */ } }, 240);
  } catch { /* */ }
}

// One name per channel opened (R11): a channel's NAME is a singleton per client, and one being left was handed back by
// the next .channel("notify-me") — subscribe() on it did nothing, and the ack of the leave closed it. Every other auth
// event (a return to the tab, the hourly refresh) re-ran these effects, so the member's "ready" and the admin's "new
// order" went silent half the time.
let notifySeq = 0;

// Listens on Supabase realtime (RLS-scoped) and surfaces notifications. Renders nothing.
export default function Notifications() {
  const { toast, nameOf } = useAppStable();
  // The Catalog's names (R2), read through a ref so the realtime channel is not re-opened when the menu lands.
  const nameRef = useRef(nameOf);
  useEffect(() => { nameRef.current = nameOf; }, [nameOf]);
  const { user, profile, refreshProfile } = useAuth();
  // Keyed on the person, not the object (R11): every auth event hands over a new user and profile object.
  const uid = user?.id ?? null, isAdmin = !!profile?.is_admin;
  const refreshRef = useRef(refreshProfile);
  useEffect(() => { refreshRef.current = refreshProfile; }, [refreshProfile]);
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; }, [toast]);

  // Client: updates to MY orders.
  useEffect(() => {
    if (!supabase || !uid) return;
    const toast = (...a: Parameters<typeof toastRef.current>) => toastRef.current(...a);
    const refreshProfile = () => refreshRef.current();
    const ch = supabase
      .channel(`notify-me-${++notifySeq}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `user_id=eq.${uid}` }, (p) => {
        const o = p.new as any;
        if (o.user_id !== uid) return;
        // The order's number and its words, as the bar, Today and the push say them (R3b: lib/orderWords).
        if (o.status === "preparing" || o.status === "ready" || o.status === "done") toast(`${orderNo(String(o.id))} · ${orderLine(o.status)}`);
        // CANCELED, SAID (R7): a void the crew made — or a stop called off — slipped the order off the bar without a word.
        // What becomes of the money, as the push says it. One this phone canceled itself is said by its own answer.
        if (o.status === "void" && !wasCanceledHere(String(o.id)) && !(o.ticket && wasCanceledHere(String(o.ticket)))) {
          const atWindow = !!o.collected_at, paid = o.paid === true || atWindow || o.payment_status === "paid";
          toast(`${orderNo(String(o.id))} was canceled — ${atWindow ? "what you paid at the window comes back there" : paid ? "your card is being refunded in full" : "nothing was charged"}.`, "info");
        }
        // Loyalty points are credited server-side on the 'done' transition — pull the
        // fresh profile so the 3MPIRE ring updates live instead of waiting for a reload.
        if (o.status === "done") refreshProfile();
      })
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [uid]);

  // Admin: new orders + new booking requests (RLS delivers all to admins).
  useEffect(() => {
    if (!supabase || !isAdmin) return;
    const toast = (...a: Parameters<typeof toastRef.current>) => toastRef.current(...a);
    const ch = supabase
      .channel(`notify-admin-${++notifySeq}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (p) => {
        const o = p.new as any;
        const names = (o.items || []).map((i: string) => nameRef.current(i)).join(" · ");
        const amt = money(o.total_cents);
        toast(`New order · ${names} · ${amt}`);
        // ONE CHIME PER ORDER (2026-10-11, lib/passSound): none while the Pass is open — it rings its own — and none
        // on a phone where the pass is muted. Asked on the first order, not loaded with every page.
        import("@/lib/passSound").then((m) => { if (m.passRings()) chime(); }, () => {});
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "booking_requests" }, (p) => {
        const b = p.new as any;
        toast(`New booking request · ${b.name ?? "someone"}`);
        chime();
      })
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [isAdmin]);

  return null;
}
