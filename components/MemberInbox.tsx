"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { useRealtimeTable } from "@/lib/realtime";
import { relativeDay } from "@/lib/dates";
import Icon, { type IconName } from "@/components/Icon";

// MEMBER INBOX — "what's happening with my stuff," on the customer Today. A read-only aggregation
// over the member's OWN orders (cup), packs (drop_orders) and deliveries (delivery_orders) — every
// row already member-readable via RLS, timelined by status_changed_at (0232). No new table: this is
// the honest inbox a member actually wants (their order activity), not a push channel. Renders
// nothing when there's no active/recent activity, so it only ever adds signal, never clutter.

type Item = {
  key: string; icon: IconName; title: string; line: ReactNode; when: string | null;
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
  // Humanize the near-term week (Today / Tomorrow / This Sat, or a recent "Nd ago"); keep the
  // absolute weekday + date for anything a week or more out (relativeDay's "Next …" is excluded).
  const rel = relativeDay(iso);
  if (/^(Today|Tomorrow|Yesterday|This )/.test(rel) || rel.endsWith("d ago")) return rel;
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

export default function MemberInbox() {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !user) { setItems([]); setLoadFailed(false); return; }
    const dayFloor = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const recent = new Date(Date.now() - 36 * 3600000).toISOString();
    // Each read is own-rows (RLS) + fail-soft — a missing table/column can never break Today — but a
    // real fetch error must still be logged (not silently swallowed) and must never render identically
    // to "nothing to show": that false-empty-state can hide a genuine ready-drink notification behind
    // an empty widget with no sign anything went wrong.
    const safe = async (run: () => PromiseLike<{ data?: unknown[] | null; error?: unknown }>) => {
      try {
        const r = await run();
        if (r?.error) { console.error("[MemberInbox] fetch failed:", r.error); return { data: [] as unknown[], failed: true }; }
        return { data: r.data ?? [], failed: false };
      } catch (err) { console.error("[MemberInbox] fetch failed:", err); return { data: [] as unknown[], failed: true }; }
    };
    const [cups, packs, dels] = await Promise.all([
      safe(() => supabase!.from("orders").select("id, items, status, status_changed_at, created_at").eq("user_id", user.id).in("status", ["new", "preparing", "ready"]).order("created_at", { ascending: false }).limit(5)),
      safe(() => supabase!.from("drop_orders").select("id, size, drop_date, paid, picked_up, canceled_at, status_changed_at, created_at").eq("user_id", user.id).is("canceled_at", null).gte("drop_date", dayFloor).order("drop_date").limit(5)),
      safe(() => supabase!.from("delivery_orders").select("id, pack_size, delivery_date, status, payment_status, canceled_at, status_changed_at, created_at").eq("user_id", user.id).is("canceled_at", null).neq("status", "delivered").order("delivery_date").limit(5)),
    ]);

    const out: Item[] = [];
    for (const o of (cups.data as { id: string; items: string[]; status: string; status_changed_at: string | null; created_at: string }[]) ?? []) {
      const n = o.items?.length ?? 0;
      const line = o.status === "ready" ? "Ready — come grab it" : o.status === "preparing" ? "We're making it now" : "Order received";
      out.push({ key: `cup-${o.id}`, icon: "coffee", title: `${n} drink${n === 1 ? "" : "s"} at the truck`, line, when: REL(o.status_changed_at ?? o.created_at), tone: o.status === "ready" ? "live" : "done", href: "/menu" });
    }
    for (const p of (packs.data as { id: string; size: number; drop_date: string; paid: boolean; picked_up: boolean; status_changed_at: string | null; created_at: string }[]) ?? []) {
      const line = p.picked_up ? <>Picked up <Icon name="check" /></> : `Pickup ${dayLabel(p.drop_date)}${p.paid ? "" : " · pay at pickup"}`;
      out.push({ key: `pack-${p.id}`, icon: "package", title: `${p.size}-pack`, line, when: REL(p.status_changed_at ?? p.created_at), tone: p.picked_up ? "done" : "live", href: "/reserve" });
    }
    for (const d of (dels.data as { id: string; pack_size: number; delivery_date: string; status: string; status_changed_at: string | null; created_at: string }[]) ?? []) {
      const map: Record<string, ReactNode> = { received: "Order in — brewing soon", brewed: "Brewed & packed", out_for_delivery: <>Out for delivery <Icon name="truck" /></>, held_for_pickup: "Held for pickup", issue: "There's a hiccup — we'll reach out" };
      out.push({ key: `del-${d.id}`, icon: "truck", title: `${d.pack_size}-bottle delivery · ${dayLabel(d.delivery_date)}`, line: map[d.status] ?? "On the way", when: REL(d.status_changed_at ?? d.created_at), tone: d.status === "out_for_delivery" ? "live" : d.status === "issue" ? "warn" : "done", href: "/delivery" });
    }
    // Live/soonest first: anything actionable (live/warn) rises above passive "received/done" rows.
    out.sort((a, b) => (a.tone === "live" || a.tone === "warn" ? 0 : 1) - (b.tone === "live" || b.tone === "warn" ? 0 : 1));
    setItems(out);
    setLoadFailed((cups.failed || packs.failed || dels.failed) && out.length === 0);
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable({ table: "drop_orders", filter: `user_id=eq.${user?.id}` }, load, { enabled: !!user });
  useRealtimeTable({ table: "delivery_orders", filter: `user_id=eq.${user?.id}` }, load, { enabled: !!user });
  useRealtimeTable({ table: "orders", filter: `user_id=eq.${user?.id}` }, load, { enabled: !!user });

  if (!user) return null;
  if (items.length === 0) {
    if (!loadFailed) return null;
    // Don't let a fetch failure look identical to "nothing happening" — show a real signal instead
    // of silently hiding a possible ready-drink notification.
    return (
      <div className="minbox" role="group" aria-label="Your orders">
        <div className="minbox-h">Your stuff</div>
        <p className="minbox-err">Couldn&rsquo;t load your orders — check back in a moment.</p>
      </div>
    );
  }
  return (
    <div className="minbox" role="group" aria-label="Your orders">
      <div className="minbox-h">Your stuff</div>
      {items.map((it) => (
        <Link key={it.key} href={it.href} className={`minbox-row tone-${it.tone}`}>
          <span className="minbox-ic" aria-hidden><Icon name={it.icon} /></span>
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
  // Defaults to true (uncertain → assume active) rather than false. This guard exists specifically to
  // stop upselling "reserve a drop" to someone who already has one coming, so the safe failure
  // direction — including on a fetch error — is "assume they might," never "confidently say they
  // don't." A confident-false-on-error was the actual bug: a transient error read as "definitely no
  // active order" and showed the upsell it exists to suppress.
  const [has, setHas] = useState(true);
  useEffect(() => {
    if (!supabase || !user) { setHas(false); return; }
    let live = true;
    const today = new Date().toISOString().slice(0, 10);
    (async () => {
      try {
        const [{ count: p, error: e1 }, { count: d, error: e2 }] = await Promise.all([
          supabase!.from("drop_orders").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("canceled_at", null).eq("picked_up", false).gte("drop_date", today),
          supabase!.from("delivery_orders").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("canceled_at", null).neq("status", "delivered"),
        ]);
        if (!live) return;
        if (e1 || e2) { console.error("[MemberInbox] active-order check failed:", e1 || e2); return; } // leave `has` at its safe default
        setHas((p ?? 0) > 0 || (d ?? 0) > 0);
      } catch (err) { if (live) console.error("[MemberInbox] active-order check failed:", err); }
    })();
    return () => { live = false; };
  }, [user]);
  return has;
}
