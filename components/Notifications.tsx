"use client";

import { useEffect } from "react";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { supabase } from "@/lib/supabase";
import { DRINKS, type DrinkId } from "@/lib/menu";

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS notification when the app is running and permission is granted (in addition to the in-app toast).
function osNotify(title: string, body: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, icon: "/icon-192.png", badge: "/icon-192.png", tag: "gt3pb" });
    }
  } catch { /* no-op */ }
}

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

// Listens on Supabase realtime (RLS-scoped) and surfaces notifications. Renders nothing.
export default function Notifications() {
  const { toast } = useApp();
  const { user, profile } = useAuth();

  // Client: updates to MY orders.
  useEffect(() => {
    if (!supabase || !user) return;
    const ch = supabase
      .channel("notify-me")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, (p) => {
        const o = p.new as any;
        if (o.user_id !== user.id) return;
        const msg: Record<string, string> = {
          preparing: "Your order is being made ☕",
          ready: "Your order is ready — come grab it!",
          done: "Order picked up. Enjoy.",
        };
        if (msg[o.status]) { toast(msg[o.status]); osNotify("GT3PB", msg[o.status]); }
      })
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [user, toast]);

  // Admin: new orders + new booking requests (RLS delivers all to admins).
  useEffect(() => {
    if (!supabase || !profile?.is_admin) return;
    const ch = supabase
      .channel("notify-admin")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (p) => {
        const o = p.new as any;
        const names = (o.items || []).map((i: string) => DRINKS[i as DrinkId]?.n ?? i).join(" · ");
        const amt = `$${(o.total_cents / 100).toFixed(2)}`;
        toast(`New order · ${names} · ${amt}`);
        osNotify("🔔 New order", `${names} — ${amt}`);
        chime();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "booking_requests" }, (p) => {
        const b = p.new as any;
        toast(`New booking request · ${b.name ?? "someone"}`);
        osNotify("🔔 New booking request", `${b.name ?? "Someone"}${b.event_date ? " · " + b.event_date : ""}`);
        chime();
      })
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [profile, toast]);

  return null;
}
