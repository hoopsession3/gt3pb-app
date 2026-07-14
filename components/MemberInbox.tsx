"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { useRealtimeTable } from "@/lib/realtime";

// MEMBER INBOX — "what's happening with my stuff," on the customer Today. A read-only aggregation
// over the member's OWN orders (cup), packs (drop_orders) and deliveries (delivery_orders) — every
// row already member-readable via RLS, timelined by status_changed_at (0232). No new table: this is
// the honest inbox a member actually wants (their order activity), not a push channel. Renders
// nothing when there's no active/recent activity, so it only ever adds signal, never clutter.

type Item = {
  key: string; icon: string; title: string; line: string; when: string | null;
  tone: "live" | "done" | "warn"; href: string;
};

const REL = (iso: string | null): string | null => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
};
const dayLabel = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

export default function MemberInbox() {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);

  const load = useCallback(async () => {
    if (!supabase || !user) { setItems([]); return; }
    const dayFloor = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const recent = new Date(Date.now() - 36 * 3600000).toISOString();
    // Each read is own-rows (RLS) + fail-soft; a missing table/column can never break Today.
    const safe = async (run: () => PromiseLike<unknown>) => { try { return (await run()) as { data?: unknown[] }; } catch { return { data: [] }; } };
    const [cups, packs, dels] = await Promise.all([
      safe(() => supabase!.from("orders").select("id, items, status, status_changed_at, created_at").eq("user_id", user.id).in("status", ["new", "preparing", "ready"]).order("created_at", { ascending: false }).limit(5)),
      safe(() => supabase!.from("drop_orders").select("id, size, drop_date, paid, picked_up, canceled_at, status_changed_at, created_at").eq("user_id", user.id).is("canceled_at", null).gte("drop_date", dayFloor).order("drop_date").limit(5)),
      safe(() => supabase!.from("delivery_orders").select("id, pack_size, delivery_date, status, payment_status, canceled_at, status_changed_at, created_at").eq("user_id", user.id).is("canceled_at", null).neq("status", "delivered").order("delivery_date").limit(5)),
    ]);

    const out: Item[] = [];
    for (const o of (cups.data as { id: string; items: string[]; status: string; status_changed_at: string | null; created_at: string }[]) ?? []) {
      const n = o.items?.length ?? 0;
      const line = o.status === "ready" ? "Ready — come grab it" : o.status === "preparing" ? "We're making it now" : "Order received";
      out.push({ key: `cup-${o.id}`, icon: "☕", title: `${n} drink${n === 1 ? "" : "s"} at the truck`, line, when: REL(o.status_changed_at ?? o.created_at), tone: o.status === "ready" ? "live" : "done", href: "/menu" });
    }
    for (const p of (packs.data as { id: string; size: number; drop_date: string; paid: boolean; picked_up: boolean; status_changed_at: string | null; created_at: string }[]) ?? []) {
      const line = p.picked_up ? "Picked up ✓" : `Pickup ${dayLabel(p.drop_date)}${p.paid ? "" : " · pay at pickup"}`;
      out.push({ key: `pack-${p.id}`, icon: "🧺", title: `${p.size}-pack`, line, when: REL(p.status_changed_at ?? p.created_at), tone: p.picked_up ? "done" : "live", href: "/reserve" });
    }
    for (const d of (dels.data as { id: string; pack_size: number; delivery_date: string; status: string; status_changed_at: string | null; created_at: string }[]) ?? []) {
      const map: Record<string, string> = { received: "Order in — brewing soon", brewed: "Brewed & packed", out_for_delivery: "Out for delivery 🚚", held_for_pickup: "Held for pickup", issue: "There's a hiccup — we'll reach out" };
      out.push({ key: `del-${d.id}`, icon: "🚚", title: `${d.pack_size}-bottle delivery · ${dayLabel(d.delivery_date)}`, line: map[d.status] ?? "On the way", when: REL(d.status_changed_at ?? d.created_at), tone: d.status === "out_for_delivery" ? "live" : d.status === "issue" ? "warn" : "done", href: "/delivery" });
    }
    // Live/soonest first: anything actionable (live/warn) rises above passive "received/done" rows.
    out.sort((a, b) => (a.tone === "live" || a.tone === "warn" ? 0 : 1) - (b.tone === "live" || b.tone === "warn" ? 0 : 1));
    setItems(out);
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable({ table: "drop_orders", filter: `user_id=eq.${user?.id}` }, load, { enabled: !!user });
  useRealtimeTable({ table: "delivery_orders", filter: `user_id=eq.${user?.id}` }, load, { enabled: !!user });
  useRealtimeTable({ table: "orders", filter: `user_id=eq.${user?.id}` }, load, { enabled: !!user });

  if (!user || items.length === 0) return null;
  return (
    <div className="minbox" role="group" aria-label="Your orders">
      <div className="minbox-h">Your stuff</div>
      {items.map((it) => (
        <Link key={it.key} href={it.href} className={`minbox-row tone-${it.tone}`}>
          <span className="minbox-ic" aria-hidden>{it.icon}</span>
          <span className="minbox-main"><b>{it.title}</b><span>{it.line}</span></span>
          {it.when && <span className="minbox-when">{it.when}</span>}
        </Link>
      ))}
    </div>
  );
}

// Whether the member has an active pack/delivery — Today uses this to stop upselling "reserve a
// drop" to someone who already has one coming (the contextual half of the decrowd).
export function useHasActiveOrder(): boolean {
  const { user } = useAuth();
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!supabase || !user) { setHas(false); return; }
    let live = true;
    const today = new Date().toISOString().slice(0, 10);
    (async () => {
      try {
        const [{ count: p }, { count: d }] = await Promise.all([
          supabase!.from("drop_orders").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("canceled_at", null).eq("picked_up", false).gte("drop_date", today),
          supabase!.from("delivery_orders").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("canceled_at", null).neq("status", "delivered"),
        ]);
        if (live) setHas((p ?? 0) > 0 || (d ?? 0) > 0);
      } catch { /* leave false */ }
    })();
    return () => { live = false; };
  }, [user]);
  return has;
}
