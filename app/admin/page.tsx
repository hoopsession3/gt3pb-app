"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth, roleOf, type Profile } from "@/components/AuthProvider";
import { useOperatorSection, sectionsForRole, type OpSection } from "@/components/OperatorNav";
import TrailerLoadout from "@/components/TrailerLoadout";
import GearLibrary from "@/components/GearLibrary";
import SignIn from "@/components/SignIn";
import { supabase } from "@/lib/supabase";
import { subscribePush } from "@/lib/push";
import { chime, unlockAudio } from "@/lib/chime";
import { haptic, HAPTIC } from "@/lib/haptics";
import { DRINKS, type DrinkId } from "@/lib/menu";
import { geocode } from "@/lib/geocode";
import { packListFor } from "@/lib/packlist";
import { complianceFor } from "@/lib/compliance";
import { projectEvent, reconcile, DEFAULT_ECON, type EventEcon, type ProductEcon, type Projection } from "@/lib/economics";
import { buildBrief } from "@/lib/eventbrief";
import { fetchInventory, inventoryForEvent, rollupLowStock, type InventoryResp, type InvItem } from "@/lib/inventory";
import type { Stop, LiveStatus, EventRow, EventTask, BookingRequest, Order, Reserve, Subscription, Vendor } from "@/lib/db";

// money helpers for the economics panels
const usd = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const toCents = (s: string) => Math.max(0, Math.round((parseFloat(s) || 0) * 100));
const pctInt = (n: number) => Math.round(n * 100);

const STATUSES: BookingRequest["status"][] = ["new", "contacted", "booked", "declined"];

// ───────────────────────── time helpers ─────────────────────────
function ago(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}
function ageMin(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}
function ageSev(min: number) {
  return min >= 8 ? "late" : min >= 4 ? "warn" : "calm";
}

// ───────────────────────── the pass (KDS) ─────────────────────────
// One ticket, one next action. Oldest-first. Aging colour signals pressure.
// Void is demoted to a guarded overflow — never under the operator's thumb.
const NEXT: Record<Order["status"], Order["status"] | null> = { new: "preparing", preparing: "ready", ready: "done", done: null, void: null };
const PREV: Record<Order["status"], Order["status"] | null> = { new: null, preparing: "new", ready: "preparing", done: "ready", void: null };
const ACT_CLASS: Record<string, string> = { new: "go", preparing: "primary", ready: "done" };
// The three live stages of the pass. Tickets move down as the operator advances them.
const STAGES: { key: Order["status"]; label: string; action: string }[] = [
  { key: "new", label: "New", action: "Start" },
  { key: "preparing", label: "In progress", action: "Mark ready" },
  { key: "ready", label: "Ready · hand off", action: "Picked up" },
];
// Group identical drinks → "2× RISE" instead of "RISE · RISE".
function groupItems(items: string[]) {
  const m = new Map<string, number>();
  items.forEach((i) => m.set(i, (m.get(i) ?? 0) + 1));
  return [...m.entries()].map(([id, qty]) => ({ id, qty }));
}
const RECENT_MS = 30 * 60000; // picked-up orders linger 30 min for review / recall

function Kitchen() {
  const { toast } = useApp();
  const [orders, setOrders] = useState<Order[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [, setTick] = useState(0);
  const [err, setErr] = useState("");
  const seeded = useRef(false);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { try { setMuted(localStorage.getItem("kds_muted") === "1"); } catch { /* */ } }, []);

  // Active board + recently-completed (last 30 min) so picked-up orders linger for
  // review / recall instead of vanishing instantly.
  const load = useCallback(async () => {
    if (!supabase) return;
    const recentISO = new Date(Date.now() - RECENT_MS).toISOString();
    const { data, error } = await supabase.from("orders").select("*").neq("status", "void")
      .or(`status.neq.done,status_changed_at.gte.${recentISO}`).order("created_at");
    if (error) { setErr(error.message); return; }
    setErr("");
    if (data) setOrders(data as Order[]);
    seeded.current = true;
  }, []);
  // Merge a single row into state (no refetch). Keeps recently-done; drops voids and
  // stale dones (those fall off on the next reconcile).
  const apply = useCallback((row: Order | null, removed = false) => {
    if (!row?.id) return;
    setOrders((prev) => {
      const without = prev.filter((o) => o.id !== row.id);
      const isStaleDone = row.status === "done" && !(row.status_changed_at && Date.now() - new Date(row.status_changed_at).getTime() < RECENT_MS);
      if (!removed && row.status !== "void" && !isStaleDone) {
        without.push(row);
        without.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
      }
      return without;
    });
  }, []);

  // Ring + buzz + flash when a genuinely new order lands (not on initial seed / own taps).
  const announceNew = useCallback((row: Order) => {
    if (!seeded.current) return;
    if (!mutedRef.current) { chime(); haptic(HAPTIC.alert); }
    setFlash((p) => new Set(p).add(row.id));
    setTimeout(() => setFlash((p) => { const n = new Set(p); n.delete(row.id); return n; }), 6000);
  }, []);

  useEffect(() => {
    load();
    const tick = setInterval(() => setTick((n) => n + 1), 1000);   // live clocks/colours
    const recon = setInterval(() => load(), 15000);                // reconcile safety net
    if (!supabase) return () => { clearInterval(tick); clearInterval(recon); };
    const ch = supabase
      .channel("admin-kds")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (p) => {
        const row = (p.eventType === "DELETE" ? p.old : p.new) as Order;
        apply(row, p.eventType === "DELETE");
        if (p.eventType === "INSERT" && row?.status === "new") announceNew(row);
      })
      .subscribe();
    return () => { clearInterval(tick); clearInterval(recon); supabase?.removeChannel(ch); };
  }, [load, apply, announceNew]);

  // Instant: patch local state synchronously, fire the write, no refetch on success.
  const move = async (o: Order, to: Order["status"] | null) => {
    if (!to || !supabase) return;
    apply({ ...o, status: to, status_changed_at: new Date().toISOString() } as Order, false);
    haptic(HAPTIC.tap);
    // Definer RPC so a 'server' can advance status without table-wide write access.
    const { error } = await supabase.rpc("staff_set_order_status", { p_order: o.id, p_status: to });
    if (error) { setErr(error.message); toast(`Couldn't update — ${error.message}`, "error"); load(); }
  };
  const advance = (o: Order) => move(o, NEXT[o.status]);
  const recall = (o: Order) => move(o, PREV[o.status]);
  const voidOrder = async (o: Order) => {
    if (typeof window !== "undefined" && !window.confirm(`Void ${o.customer ?? "this order"}? This can't be undone.`)) return;
    if (!supabase) return;
    apply(o, true);
    const { error } = await supabase.rpc("staff_set_order_status", { p_order: o.id, p_status: "void" });
    if (error) { setErr(error.message); toast(`Couldn't void — ${error.message}`, "error"); load(); }
  };

  const toggle = (k: string) => setCollapsed((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleMute = () => setMuted((m) => { const v = !m; try { localStorage.setItem("kds_muted", v ? "1" : "0"); } catch { /* */ } unlockAudio(); return v; });
  const active = orders.filter((o) => o.status !== "done");
  const done = orders.filter((o) => o.status === "done").sort((a, b) => (a.status_changed_at < b.status_changed_at ? 1 : -1));
  const late = active.filter((o) => o.status !== "ready" && ageMin(o.created_at) >= 8);

  return (
    <div className="adm-sec">
      <div className="sec">The pass{active.length > 0 && <span className="adm-pill">{active.length} active</span>}
        <button type="button" className="kds-mute" onClick={toggleMute} aria-pressed={muted}>{muted ? "🔇 Muted" : "🔔 Sound"}</button>
      </div>

      {err && <div className="adm-attn" role="alert">Backend error: {err}</div>}
      {late.length > 0 && (
        <div className="adm-attn" role="alert">
          <b>{late.map((o) => o.customer ?? "Guest").join(", ")}</b> waiting past 8 min — step over and reassure the guest.
        </div>
      )}

      <div aria-live="polite">
        {STAGES.map((st) => {
          const list = orders.filter((o) => o.status === st.key);
          const isCol = collapsed.has(st.key);
          return (
            <div className="kds-stage" key={st.key}>
              <button type="button" className="kds-stage-h" onClick={() => toggle(st.key)} aria-expanded={!isCol}>
                <span className={`kds-caret${isCol ? " col" : ""}`}>▾</span>
                <span className="kds-stage-name">{st.label}</span>
                <span className="kds-stage-n">{list.length}</span>
              </button>
              {!isCol && list.length === 0 && <div className="kds-empty">Nothing here.</div>}
              {!isCol && list.map((o) => {
                const sev = ageSev(ageMin(o.created_at));
                return (
                  <div className={`adm-order st-${o.status}${flash.has(o.id) ? " flash" : ""}`} key={o.id}>
                    <button className="adm-act-more" onClick={() => voidOrder(o)} aria-label={`Void ${o.customer ?? "order"}`}>⋯</button>
                    <div className="adm-order-top">
                      <b>{o.customer ?? "Guest"}</b>
                      <span className={`adm-age ${sev}`}>{ago(o.created_at)}</span>
                    </div>
                    <div className="adm-items">{groupItems(o.items).map((g) => `${g.qty > 1 ? g.qty + "× " : ""}${DRINKS[g.id as DrinkId]?.n ?? g.id}`).join(" · ")}</div>
                    <div className="meta">#{o.id.slice(0, 4).toUpperCase()} · ${(o.total_cents / 100).toFixed(2)} · <span className={o.paid ? "pd" : "unp"}>{o.paid ? "PAID" : "pre-order"}</span> · <span className="kds-stagetime">{ago(o.status_changed_at)} in stage</span></div>
                    <div className="adm-actions-row">
                      {PREV[o.status] && <button className="adm-recall" onClick={() => recall(o)} aria-label="Move back a stage">↩</button>}
                      <button className={`adm-act ${ACT_CLASS[o.status]}`} onClick={() => advance(o)}>{st.action}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}

        {done.length > 0 && (
          <div className="kds-stage">
            <button type="button" className="kds-stage-h" onClick={() => setDoneOpen((v) => !v)} aria-expanded={doneOpen}>
              <span className={`kds-caret${!doneOpen ? " col" : ""}`}>▾</span>
              <span className="kds-stage-name">Just completed</span>
              <span className="kds-stage-n">{done.length}</span>
            </button>
            {doneOpen && done.map((o) => (
              <div className="adm-order st-done" key={o.id}>
                <div className="adm-order-top">
                  <b>{o.customer ?? "Guest"}</b>
                  <span className="adm-age calm">picked up {ago(o.status_changed_at)} ago</span>
                </div>
                <div className="adm-items">{groupItems(o.items).map((g) => `${g.qty > 1 ? g.qty + "× " : ""}${DRINKS[g.id as DrinkId]?.n ?? g.id}`).join(" · ")}</div>
                <div className="meta">#{o.id.slice(0, 4).toUpperCase()} · ${(o.total_cents / 100).toFixed(2)} · <span className={o.paid ? "pd" : "unp"}>{o.paid ? "PAID" : "pre-order"}</span></div>
                <div className="adm-actions-row">
                  <button className="adm-recall" onClick={() => recall(o)} aria-label={`Bring ${o.customer ?? "order"} back to ready`}>↩ Recall</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {active.length === 0 && done.length === 0 && <div className="h-sub">The pass is clear. New orders arrive here in realtime.</div>}
    </div>
  );
}

// ───────────────────────── pre-flight readiness ─────────────────────────
// ───────────────────────── my tasks: what's assigned to me, by priority ─────────────────────────
type MyTaskRow = EventTask & { events: { title: string | null; day: string | null; is_live: boolean | null } | null };

function MyTasks({ userId }: { userId: string | null }) {
  const [tasks, setTasks] = useState<MyTaskRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !userId) { setTasks([]); setLoaded(true); return; }
    const { data } = await supabase
      .from("event_tasks")
      .select("*, events(title, day, is_live)")
      .eq("assignee", userId)
      .eq("done", false)
      .order("sort");
    setTasks((data as MyTaskRow[]) ?? []);
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    load();
    if (!supabase || !userId) return;
    const ch = supabase.channel("my-tasks")
      .on("postgres_changes", { event: "*", schema: "public", table: "event_tasks", filter: `assignee=eq.${userId}` }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load, userId]);

  const complete = async (t: MyTaskRow) => {
    if (!supabase) return;
    setTasks((p) => p.filter((x) => x.id !== t.id)); // optimistic
    await supabase.from("event_tasks").update({ done: true, done_by: userId, done_at: new Date().toISOString() }).eq("id", t.id);
  };

  if (!userId || (loaded && tasks.length === 0)) return null;

  // Priority: critical first, then important (warn), then tasks on a LIVE event, then by date.
  const score = (t: MyTaskRow) => (t.critical ? 0 : t.warn ? 1 : t.events?.is_live ? 2 : 3);
  const sorted = [...tasks].sort((a, b) => score(a) - score(b) || (a.events?.day ?? "9999").localeCompare(b.events?.day ?? "9999"));
  const crit = tasks.filter((t) => t.critical).length;

  return (
    <div className="adm-sec">
      <div className="sec">My tasks <span className={`adm-pill${crit ? " due" : ""}`}>{tasks.length}{crit ? ` · ${crit} critical` : ""}</span></div>
      {sorted.map((t) => (
        <div key={t.id} className={`mytask${t.critical ? " crit" : t.warn ? " warn" : ""}`}>
          <button type="button" className="task-check" onClick={() => complete(t)} aria-label={`Mark done: ${t.label}`}>
            <span className="task-box" />
          </button>
          <div className="mytask-main">
            <span className="mytask-label">{t.label}</span>
            <span className="mytask-ev">{t.events?.title ?? "Event"}{t.events?.is_live ? " · LIVE" : t.events?.day ? ` · ${whenBucket(t.events.day).label}` : ""}</span>
          </div>
          {t.critical ? <span className="mytask-pri crit">Critical</span> : t.warn ? <span className="mytask-pri warn">Important</span> : null}
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── per-event prep: card picker + detail ─────────────────────────
type Readiness = { done: number; total: number; crit: number };

// "By date / when" bucket for the Prep cards (events.day vs today).
function whenBucket(day: string | null | undefined): { key: number; label: string } {
  if (!day) return { key: 4, label: "Unscheduled" };
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { key: 4, label: "Unscheduled" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { key: 0, label: "Past" };
  if (diff === 0) return { key: 1, label: "Today" };
  if (diff <= 7) return { key: 2, label: "This week" };
  return { key: 3, label: "Later" };
}

// Pull-up sheet to categorize the card view (date/when sort direction).
function PrepViewSheet({ dir, setDir, onClose }: { dir: "asc" | "desc"; setDir: (d: "asc" | "desc") => void; onClose: () => void }) {
  return (
    <>
      <div className="prep-scrim" onClick={onClose} aria-hidden="true" />
      <div className="prep-sheet" role="dialog" aria-modal="true" aria-label="Card view options">
        <div className="prep-sheet-grab" />
        <div className="prep-sheet-h">Group by · date / when</div>
        <div className="prep-sheet-opts">
          <button className={`prep-sheet-opt${dir === "asc" ? " on" : ""}`} onClick={() => { setDir("asc"); onClose(); }}>Soonest first</button>
          <button className={`prep-sheet-opt${dir === "desc" ? " on" : ""}`} onClick={() => { setDir("desc"); onClose(); }}>Latest first</button>
        </div>
      </div>
    </>
  );
}

function PrepCard({ ev, r, onOpen }: { ev: EventRow; r: Readiness; onOpen: () => void }) {
  const status = r.total === 0 ? "Not started" : r.done === r.total ? "Ready to roll" : `Loaded ${r.done}/${r.total}`;
  const cls = r.total === 0 ? "none" : r.done === r.total ? "ok" : r.crit ? "miss" : "mid";
  const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
  const when = [ev.day_label, ev.start_time].filter(Boolean).join(" · ");
  return (
    <button className={`prep-card${ev.is_live ? " live" : ""}`} onClick={onOpen} aria-label={`Prep ${ev.title} — ${status}`}>
      <div className="prep-card-top">
        <span className="prep-card-when">{when || "—"}</span>
        {ev.is_live && <span className="prep-card-livetag">● Live</span>}
      </div>
      <div className="prep-card-title">{ev.title}</div>
      {ev.location_text && <div className="prep-card-loc">{ev.location_text}</div>}
      <div className="prep-card-foot">
        <span className={`prep-card-status ${cls}`}>{status}</span>
        {r.crit > 0 && <span className="prep-card-crit">{r.crit} critical</span>}
        <span className="prep-card-go">Prep ›</span>
      </div>
      {r.total > 0 && <div className="prep-card-bar"><span style={{ width: `${pct}%` }} /></div>}
    </button>
  );
}

// Outer: the event picker. Cards grouped by date/when, with a pull-up to re-sort.
// Tapping a card opens that event's pack-list detail (EventPrepDetail).
function EventPrep({ onGo }: { onGo: (t: string) => void }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [ready, setReady] = useState<Record<string, Readiness>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [sheet, setSheet] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data: evs } = await supabase.from("events").select("*").order("sort");
    const list = ((evs as EventRow[]) ?? []).filter((e) => !e.archived_at);
    setEvents(list);
    const { data: t } = await supabase.from("event_tasks").select("event_id, done, critical");
    const map: Record<string, Readiness> = {};
    for (const row of (t as { event_id: string; done: boolean; critical: boolean }[]) ?? []) {
      const m = (map[row.event_id] ??= { done: 0, total: 0, crit: 0 });
      m.total++;
      if (row.done) m.done++;
      else if (row.critical) m.crit++;
    }
    setReady(map);
    // First load auto-opens the live event so the gig in progress is one tap away.
    setSelectedId((prev) => prev ?? list.find((e) => e.is_live)?.id ?? null);
    setLoaded(true);
  }, []);
  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel("admin-prep-index")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "event_tasks" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  if (selectedId) return <EventPrepDetail eventId={selectedId} onBack={() => setSelectedId(null)} />;

  // group by date/when, buckets ordered Past→Today→This week→Later→Unscheduled; dir flips it
  const by: Record<string, { key: number; label: string; items: EventRow[] }> = {};
  for (const ev of events) {
    const b = whenBucket(ev.day);
    (by[b.label] ??= { key: b.key, label: b.label, items: [] }).items.push(ev);
  }
  const groups = Object.values(by).sort((a, b) => a.key - b.key);
  const cmp = (a: EventRow, b: EventRow) => (a.day ?? "9999").localeCompare(b.day ?? "9999") || a.sort - b.sort;
  for (const g of groups) g.items.sort(cmp);
  if (dir === "desc") { groups.reverse(); for (const g of groups) g.items.reverse(); }

  return (
    <>
    {/* The overview + loadout live on the event LIST only — opening an event gives prep the full screen. */}
    <Overview onGo={onGo} />
    <div className="adm-sec adm-prep">
      <div className="sec">Prep · {events.length} event{events.length === 1 ? "" : "s"}
        <button className="adm-prep-view" onClick={() => setSheet(true)} aria-haspopup="dialog">View ⌄</button>
      </div>
      {!loaded && <div className="h-sub">Loading events…</div>}
      {loaded && events.length === 0 && <div className="h-sub">No events yet — add one in Plan → Events to prep it.</div>}
      {groups.map((g) => (
        <div key={g.label} className="prep-group">
          <div className="prep-group-h">{g.label} <span>{g.items.length}</span></div>
          <div className="prep-cards">
            {g.items.map((ev) => (
              <PrepCard key={ev.id} ev={ev} r={ready[ev.id] ?? { done: 0, total: 0, crit: 0 }} onOpen={() => setSelectedId(ev.id)} />
            ))}
          </div>
        </div>
      ))}
      {sheet && <PrepViewSheet dir={dir} setDir={setDir} onClose={() => setSheet(false)} />}
    </div>
    <TrailerLoadout />
    <GearLibrary />
    </>
  );
}

// Detail: the per-event pack-list checklist (auto-derived from the event's rig/menu,
// persisted, realtime, role-scoped, crew roster + task assignment) for a chosen event.
function EventPrepDetail({ eventId, onBack }: { eventId: string; onBack: () => void }) {
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const isAdmin = roleOf(profile) === "admin" || roleOf(profile) === "owner";
  const [ev, setEv] = useState<EventRow | null>(null);
  const [tasks, setTasks] = useState<EventTask[]>([]);
  const [crew, setCrew] = useState<{ id: string; user_id: string; role_label: string | null }[]>([]);
  const [staff, setStaff] = useState<{ id: string; display_name: string | null; role?: string | null }[]>([]);
  const [approvals, setApprovals] = useState<{ approver_id: string }[]>([]);
  const [newTask, setNewTask] = useState("");
  const [generating, setGenerating] = useState(false);
  const [assignFor, setAssignFor] = useState<EventTask | null>(null);
  const [showSupplies, setShowSupplies] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data: e } = await supabase.from("events").select("*").eq("id", eventId).maybeSingle();
    const target = (e as EventRow) ?? null;
    setEv(target);
    if (!target) { setTasks([]); setCrew([]); return; }
    const [{ data: t }, { data: c }, { data: ap }] = await Promise.all([
      supabase.from("event_tasks").select("*").eq("event_id", target.id).order("sort"),
      supabase.from("event_staff").select("id, user_id, role_label").eq("event_id", target.id),
      supabase.from("event_approvals").select("approver_id").eq("event_id", target.id), // may not exist pre-0038
    ]);
    // Dedupe defensively — past double-generates left duplicate rows in the DB.
    const seen = new Set<string>();
    setTasks(((t as EventTask[]) ?? []).filter((x) => { const k = `${x.section ?? ""}|${x.label}`; if (seen.has(k)) return false; seen.add(k); return true; }));
    setCrew((c as { id: string; user_id: string; role_label: string | null }[]) ?? []);
    setApprovals((ap as { approver_id: string }[]) ?? []);
    if (isAdmin) {
      const { data: p } = await supabase.from("profiles").select("id, display_name, role").neq("role", "member");
      setStaff((p as { id: string; display_name: string | null; role?: string | null }[]) ?? []);
    }
  }, [eventId, isAdmin]);
  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel("admin-eventprep")
      .on("postgres_changes", { event: "*", schema: "public", table: "event_tasks" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "event_staff" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "event_approvals" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  // Clear, identifiable labels — staff often sign in without setting a name, so fall back
  // to something readable instead of an anonymous "—" that makes assignments look empty.
  const staffName = (uid: string) => staff.find((s) => s.id === uid)?.display_name?.trim() || "Unnamed crew";
  const firstNameOf = (uid: string) => staffName(uid).split(" ")[0];
  const initialOf = (uid: string) => { const n = staff.find((s) => s.id === uid)?.display_name?.trim(); return n ? n.charAt(0).toUpperCase() : "?"; };
  const nameOf = (uid: string) => staffName(uid);
  const generate = async (regen = false) => {
    if (!ev || !supabase || generating) return;
    if (regen && typeof window !== "undefined" && !window.confirm("Rebuild the pack list from the event's current menu/rig?\n\nThis clears the existing list and all its checkmarks.")) return;
    setGenerating(true);
    // Idempotency: never double-insert (the old double-tap bug). If tasks already exist,
    // a plain generate no-ops; "Regenerate" clears first then rebuilds.
    const { data: existing } = await supabase.from("event_tasks").select("id").eq("event_id", ev.id);
    if (existing && existing.length) {
      if (!regen) { setGenerating(false); load(); return; }
      await supabase.from("event_tasks").delete().eq("event_id", ev.id);
    }
    // Pack list (rig/menu) + compliance (state/county) in one go — the whole "what do
    // we need to bring AND what permits do we need" question, answered from the event.
    const pack = packListFor(ev).map((p, i) => ({ event_id: ev.id, label: p.label, section: p.section, critical: !!p.critical, warn: !!p.warn, kind: "pack", link: null, sort: i }));
    const comp = (await complianceFor(ev, supabase)).map((p, i) => ({ event_id: ev.id, label: p.label, section: p.section, critical: !!p.critical, warn: !!p.warn, kind: "task", link: p.link ?? null, sort: 100 + i }));
    const rows = [...pack, ...comp];
    if (!rows.length) { setGenerating(false); toast("Set the event's rig + menu first (Plan → Events)", "error"); return; }
    const { error } = await supabase.from("event_tasks").insert(rows);
    setGenerating(false);
    toast(error ? `Error: ${error.message}` : `Generated ${pack.length} pack + ${comp.length} compliance items`);
    if (!error) load();
  };
  const toggle = async (t: EventTask) => {
    if (!supabase) return;
    const next = !t.done;
    setTasks((p) => p.map((x) => (x.id === t.id ? { ...x, done: next } : x)));
    const { error } = await supabase.from("event_tasks").update({ done: next, done_by: next ? user?.id ?? null : null, done_at: next ? new Date().toISOString() : null }).eq("id", t.id);
    if (error) { toast(`Error: ${error.message}`, "error"); load(); }
  };
  const assign = async (t: EventTask, uid: string) => {
    if (!supabase) return;
    const prev = t.assignee ?? null;
    const next = uid || null;
    setAssignFor(null);
    if (next === prev) return;
    setTasks((p) => p.map((x) => (x.id === t.id ? { ...x, assignee: next } : x))); // optimistic — the assignment shows immediately
    const { error } = await supabase.from("event_tasks").update({ assignee: next }).eq("id", t.id);
    if (error) { toast(`Error: ${error.message}`, "error"); load(); return; }
    toast(next ? `Assigned to ${firstNameOf(next)}` : "Unassigned");
    // Notify the newly-assigned member (best-effort; lights up once the push Edge Function is redeployed).
    if (next) {
      supabase.functions
        .invoke("push", { body: { table: "event_tasks", type: "UPDATE", record: { ...t, assignee: next }, old_record: { ...t, assignee: prev } } })
        .catch(() => {});
    }
  };
  const addTask = async () => {
    if (!ev || !supabase || !newTask.trim()) return;
    const { error } = await supabase.from("event_tasks").insert({ event_id: ev.id, label: newTask.trim(), kind: "task", section: "Task", sort: tasks.length });
    setNewTask("");
    if (error) toast(`Error: ${error.message}`, "error"); else load();
  };
  const addCrew = async (uid: string) => {
    if (!ev || !supabase || !uid) return;
    const { error } = await supabase.from("event_staff").insert({ event_id: ev.id, user_id: uid });
    if (error) toast(error.code === "23505" ? "Already on crew" : `Error: ${error.message}`, "error"); else load();
  };
  const removeCrew = async (id: string) => { if (supabase) { await supabase.from("event_staff").delete().eq("id", id); load(); } };
  // Add supplies the crew must bring — picked from the Notion inventory catalog or typed
  // off-catalog. Each becomes a checklist line under "Supplies" (no inventory duplication).
  const addSupplies = async (items: { label: string; critical: boolean }[]) => {
    setShowSupplies(false);
    if (!ev || !supabase || items.length === 0) return;
    const have = new Set(tasks.map((t) => t.label.trim().toLowerCase()));
    const rows = items
      .filter((i) => !have.has(i.label.trim().toLowerCase()))
      .map((i, idx) => ({ event_id: ev.id, label: i.label.trim(), section: "Supplies", kind: "pack", critical: i.critical, sort: 40 + idx }));
    if (rows.length === 0) { toast("Those are already on the list"); return; }
    const { error } = await supabase.from("event_tasks").insert(rows);
    toast(error ? `Error: ${error.message}` : `Added ${rows.length} suppl${rows.length === 1 ? "y" : "ies"}`);
    if (!error) load();
  };
  // Tag/untag a crew member as a manager — managers must approve the prep too.
  const setManager = async (crewRowId: string, makeMgr: boolean) => {
    if (!supabase) return;
    await supabase.from("event_staff").update({ role_label: makeMgr ? "manager" : null }).eq("id", crewRowId);
    load();
  };
  const toggleApproval = async (mine: boolean) => {
    if (!user || !supabase || !ev) return;
    if (mine) {
      await supabase.from("event_approvals").delete().eq("event_id", ev.id).eq("approver_id", user.id);
      toast("Approval withdrawn");
    } else {
      const { error } = await supabase.from("event_approvals").insert({ event_id: ev.id, approver_id: user.id });
      toast(error ? `Error: ${error.message}` : "Prep approved");
    }
    load();
  };
  const requestSignoff = (approverIds: string[]) => {
    if (!ev || !supabase || approverIds.length === 0) { toast("Everyone's already approved"); return; }
    toast("Sign-off requested");
    supabase.functions
      .invoke("push", { body: { table: "event_approval_request", type: "INSERT", record: { event_id: ev.id, title: ev.title, approver_ids: approverIds } } })
      .catch(() => {});
  };

  if (!ev) return (
    <div className="adm-sec adm-prep">
      <button className="adm-prep-back" onClick={onBack}>‹ All events</button>
      <div className="h-sub">Event not found — it may have been removed.</div>
    </div>
  );
  const total = tasks.length, doneN = tasks.filter((t) => t.done).length;
  const critOut = tasks.filter((t) => t.critical && !t.done);
  const ready = total > 0 && doneN === total;
  const sections = [...new Set(tasks.map((t) => t.section ?? "Task"))];

  // Sign-off: an owner + every tagged manager must approve. Editing checklist content
  // re-opens it (DB trigger). Checking items / assigning crew does NOT re-open.
  const managers = crew.filter((c) => c.role_label === "manager");
  const approvedIds = new Set(approvals.map((a) => a.approver_id));
  const ownerApproved = approvals.some((a) => staff.find((s) => s.id === a.approver_id)?.role === "owner");
  const ownerIds = staff.filter((s) => s.role === "owner").map((s) => s.id);
  const fullyApproved = ownerApproved && managers.every((m) => approvedIds.has(m.user_id));
  const approvedCount = (ownerApproved ? 1 : 0) + managers.filter((m) => approvedIds.has(m.user_id)).length;
  const isOwner = roleOf(profile) === "owner";
  const iAmRequired = !!user && (isOwner || managers.some((m) => m.user_id === user.id));
  const iApproved = !!user && approvedIds.has(user.id);
  const pendingApprovers = [...new Set([...managers.map((m) => m.user_id), ...ownerIds])].filter((id) => !approvedIds.has(id));

  return (
    <div className="adm-sec adm-prep">
      <button className="adm-prep-back" onClick={onBack}>‹ All events</button>
      <div className="sec">{ev.title} · prep{ev.is_live && <span className="adm-pill due">LIVE</span>}</div>
      {total > 0 ? (
        <>
          <div className={`adm-ready-bar${ready ? " ok" : critOut.length ? " miss" : ""}`}>
            <b>Loaded {doneN}/{total}</b>
            {critOut.length > 0 && <span className="adm-ready-miss"> · {critOut.length} critical to load: {critOut.slice(0, 2).map((t) => t.label).join(", ")}{critOut.length > 2 ? ` +${critOut.length - 2}` : ""}</span>}
            {ready && <span> · ready to roll</span>}
          </div>
          {isAdmin && (
            <div className="adm-prep-actions">
              <button className="adm-regen" onClick={() => generate(true)} disabled={generating}>↻ Regenerate from menu</button>
              <button className="adm-regen" onClick={() => setShowSupplies(true)}>+ Add supplies</button>
            </div>
          )}
        </>
      ) : isAdmin ? (
        <button className="adm-btn primary" onClick={() => generate()} disabled={generating}>{generating ? "Generating…" : "Generate pack list from menu"}</button>
      ) : <div className="h-sub">No pack list yet — an owner generates it.</div>}

      {isAdmin && (
        <div className="adm-crew-row">
          {crew.map((c) => {
            const mgr = c.role_label === "manager";
            return (
              <span key={c.id} className={`adm-crew-chip${mgr ? " mgr" : ""}`}>
                <button type="button" className="crew-mgr" onClick={() => setManager(c.id, !mgr)} title={mgr ? "Remove manager" : "Make manager (must approve)"} aria-label={mgr ? "Remove manager" : "Make manager"}>{mgr ? "★" : "☆"}</button>
                <span className="crew-name">{nameOf(c.user_id)}</span>
                <button type="button" className="crew-x" onClick={() => removeCrew(c.id)} aria-label="Remove from crew">✕</button>
              </span>
            );
          })}
          <select className="adm-role" value="" onChange={(e) => { addCrew(e.target.value); e.target.value = ""; }} aria-label="Add crew">
            <option value="">+ crew</option>
            {staff.filter((s) => !crew.some((c) => c.user_id === s.id)).map((s) => <option key={s.id} value={s.id}>{s.display_name ?? "—"}</option>)}
          </select>
        </div>
      )}

      {total > 0 && (
        <div className={`adm-approve${fullyApproved ? " ok" : ""}`}>
          <div className="adm-approve-h">
            <b>{fullyApproved ? "Prep approved" : "Prep sign-off"}</b>
            <span>{approvedCount}/{1 + managers.length} approved</span>
          </div>
          <div className="adm-approve-rows">
            <div className={`adm-approve-row${ownerApproved ? " done" : ""}`}><span>Owner</span><span className="adm-approve-mark">{ownerApproved ? "✓" : "—"}</span></div>
            {managers.map((m) => (
              <div key={m.id} className={`adm-approve-row${approvedIds.has(m.user_id) ? " done" : ""}`}><span>{firstNameOf(m.user_id)} · mgr</span><span className="adm-approve-mark">{approvedIds.has(m.user_id) ? "✓" : "—"}</span></div>
            ))}
          </div>
          <div className="adm-approve-actions">
            {iAmRequired && <button className={`adm-btn${iApproved ? " ghost" : " primary"}`} onClick={() => toggleApproval(iApproved)}>{iApproved ? "Withdraw approval" : "Approve prep"}</button>}
            {isAdmin && !fullyApproved && pendingApprovers.length > 0 && <button className="adm-btn ghost" onClick={() => requestSignoff(pendingApprovers)}>Request sign-off</button>}
          </div>
          {managers.length === 0 && <div className="h-sub" style={{ marginTop: 6 }}>Tag a crew member ★ as manager to require their approval too.</div>}
        </div>
      )}

      {sections.map((sec) => (
        <div key={sec} className="adm-prep-sec">
          <div className="adm-prep-label">{sec}</div>
          {tasks.filter((t) => (t.section ?? "Task") === sec).map((t) => (
            <div key={t.id} className={`adm-task${t.done ? " done" : ""}${t.critical ? " crit" : t.warn ? " warn" : ""}`}>
              <button type="button" className="task-check" aria-pressed={t.done} onClick={() => toggle(t)} aria-label={`${t.done ? "Mark not loaded" : "Mark loaded"}: ${t.label}`}>
                <span className="task-box">{t.done && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>}</span>
                <span className="task-label">{t.label}</span>
              </button>
              <div className="task-right">
                {t.link && <a className="adm-task-link" href={t.link} target="_blank" rel="noopener noreferrer" aria-label="Open reference / application">↗</a>}
                {isAdmin ? (
                  <button type="button" className={`task-assign${t.assignee ? " set" : ""}`} onClick={() => setAssignFor(t)} aria-label={t.assignee ? `Reassign ${t.label} — currently ${staffName(t.assignee)}` : `Assign ${t.label} to crew`}>
                    {t.assignee
                      ? <><span className="task-assign-av">{initialOf(t.assignee)}</span><span className="task-assign-name">{firstNameOf(t.assignee)}</span></>
                      : <span className="task-assign-add">+ Assign</span>}
                  </button>
                ) : t.assignee ? (
                  <span className="task-assign set readonly"><span className="task-assign-av">{initialOf(t.assignee)}</span><span className="task-assign-name">{firstNameOf(t.assignee)}</span></span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ))}
      {isAdmin && total > 0 && (
        <div className="adm-task-add">
          <input className="subpitch-email" style={{ marginBottom: 0 }} placeholder="Add a task…" value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTask()} aria-label="Add a task" />
          <button className="adm-btn" onClick={addTask}>Add</button>
        </div>
      )}

      {assignFor && (
        <AssignSheet
          task={assignFor}
          staff={staff}
          crewIds={crew.map((c) => c.user_id)}
          meId={user?.id ?? null}
          meName={profile?.display_name?.trim() || "Me"}
          onPick={(uid) => assign(assignFor, uid)}
          onClose={() => setAssignFor(null)}
        />
      )}

      {showSupplies && (
        <SupplyPicker ev={ev} have={new Set(tasks.map((t) => t.label.trim().toLowerCase()))} onAdd={addSupplies} onClose={() => setShowSupplies(false)} />
      )}
    </div>
  );
}

// Mobile-friendly assignee picker — a bottom sheet with big tap rows, crew first.
function AssignSheet({ task, staff, crewIds, meId, meName, onPick, onClose }: {
  task: EventTask;
  staff: { id: string; display_name: string | null }[];
  crewIds: string[];
  meId: string | null;
  meName: string;
  onPick: (uid: string) => void;
  onClose: () => void;
}) {
  const label = (s: { display_name: string | null }) => s.display_name?.trim() || "Unnamed crew";
  const initial = (s: { display_name: string | null }) => { const n = s.display_name?.trim(); return n ? n.charAt(0).toUpperCase() : "?"; };
  // The current user can always assign to themselves, even if their profile name/role
  // would otherwise keep them out of the staff list — that's "assign to me".
  const crew = staff.filter((s) => crewIds.includes(s.id) && s.id !== meId);
  const others = staff.filter((s) => !crewIds.includes(s.id) && s.id !== meId);
  const Row = (s: { id: string; display_name: string | null }) => (
    <button key={s.id} type="button" className={`assign-row${task.assignee === s.id ? " on" : ""}`} onClick={() => onPick(s.id)}>
      <span className="assign-av">{initial(s)}</span>
      <span className="assign-name">{label(s)}</span>
      {task.assignee === s.id && <span className="assign-check">✓</span>}
    </button>
  );
  return (
    <>
      <div className="prep-scrim" onClick={onClose} aria-hidden="true" />
      <div className="prep-sheet assign-sheet" role="dialog" aria-modal="true" aria-label={`Assign ${task.label}`}>
        <div className="prep-sheet-grab" />
        <div className="assign-sheet-h">Assign · <b>{task.label}</b></div>
        {meId && (
          <button type="button" className={`assign-row me${task.assignee === meId ? " on" : ""}`} onClick={() => onPick(meId)}>
            <span className="assign-av">{(meName.trim().charAt(0) || "M").toUpperCase()}</span>
            <span className="assign-name">Assign to me{meName && meName !== "Me" ? ` · ${meName.split(" ")[0]}` : ""}</span>
            {task.assignee === meId && <span className="assign-check">✓</span>}
          </button>
        )}
        {crew.length === 0 && others.length === 0 && !meId && <div className="h-sub">No staff yet — add people and set their role/name in <b>Team</b>.</div>}
        {crew.length > 0 && <div className="assign-group">On this crew</div>}
        {crew.map(Row)}
        {others.length > 0 && <div className="assign-group">All staff</div>}
        {others.map(Row)}
        {task.assignee && (
          <button type="button" className="assign-row clear" onClick={() => onPick("")}>
            <span className="assign-av none">—</span><span className="assign-name">Unassign</span>
          </button>
        )}
      </div>
    </>
  );
}

// Supply picker — references the Notion inventory catalog (/api/inventory) and lets you
// add off-catalog items by typing. Pre-selects what the event's menu/rig actually needs.
function SupplyPicker({ ev, have, onAdd, onClose }: {
  ev: EventRow;
  have: Set<string>;
  onAdd: (items: { label: string; critical: boolean }[]) => void;
  onClose: () => void;
}) {
  const [inv, setInv] = useState<InventoryResp | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());

  useEffect(() => { fetchInventory().then(setInv); }, []);
  // Pre-check the items this event actually draws on (from its menu/rig answers).
  useEffect(() => {
    if (!inv) return;
    const relevant = inventoryForEvent(inv.items, ev).relevant;
    setSel(new Set(relevant.filter((it) => !have.has(it.name.trim().toLowerCase())).map((it) => it.name)));
  }, [inv]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = inv?.items ?? [];
  const ql = q.trim().toLowerCase();
  const onList = (name: string) => have.has(name.trim().toLowerCase());
  const relevantNames = inv ? new Set(inventoryForEvent(inv.items, ev).relevant.map((it) => it.name)) : new Set<string>();
  const filtered = ql ? items.filter((it) => it.name.toLowerCase().includes(ql) || (it.category ?? "").toLowerCase().includes(ql)) : items;
  const exactMatch = items.some((it) => it.name.trim().toLowerCase() === ql);
  const toggle = (name: string) => setSel((p) => { const n = new Set(p); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const confirm = () => onAdd(items.filter((it) => sel.has(it.name) && !onList(it.name)).map((it) => ({ label: it.name, critical: it.critical })));
  const addCustom = () => { if (ql) onAdd([{ label: q.trim(), critical: false }]); };
  const selCount = [...sel].filter((n) => !onList(n)).length;

  // Group: what this event needs first, then by catalog category — easier to scan than one flat list.
  const groupsMap = new Map<string, InvItem[]>();
  for (const it of filtered) {
    const g = relevantNames.has(it.name) ? "Needed for this event" : (it.category || "Other");
    const arr = groupsMap.get(g) ?? [];
    if (arr.length === 0) groupsMap.set(g, arr);
    arr.push(it);
  }
  const groupEntries = [...groupsMap.entries()].sort((a, b) =>
    a[0] === "Needed for this event" ? -1 : b[0] === "Needed for this event" ? 1 : a[0].localeCompare(b[0])
  );

  const Item = (it: InvItem) => {
    const already = onList(it.name);
    const picked = sel.has(it.name);
    return (
      <button key={it.name} type="button" className={`assign-row${picked && !already ? " on" : ""}`} disabled={already} onClick={() => toggle(it.name)}>
        <span className={`task-box${picked && !already ? " on" : ""}`}>{picked && !already && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>}</span>
        <span className="assign-name">{it.name}{it.critical && <span className="supply-crit"> · critical</span>}{already && <span className="supply-off"> · on list</span>}</span>
        {it.qty != null && <span className="orderbar-tag">{it.qty}{it.unit ? ` ${it.unit}` : ""}</span>}
      </button>
    );
  };

  return (
    <>
      <div className="prep-scrim" onClick={onClose} aria-hidden="true" />
      <div className="prep-sheet assign-sheet supply-sheet" role="dialog" aria-modal="true" aria-label="Add supplies">
        <div className="supply-head">
          <div className="prep-sheet-grab" />
          <div className="assign-sheet-h">Supplies for · <b>{ev.title}</b></div>
          <input className="subpitch-email" style={{ marginBottom: 0 }} placeholder="Search the asset database…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search supplies" autoFocus />
          {ql && !exactMatch && (
            <button type="button" className="assign-row me" style={{ marginTop: 8 }} onClick={addCustom}>
              <span className="assign-av none">+</span>
              <span className="assign-name">Add &ldquo;{q.trim()}&rdquo; <span className="supply-off">off-catalog</span></span>
            </button>
          )}
        </div>
        <div className="supply-list">
          {!inv && <div className="h-sub" style={{ margin: "6px 0" }}>Loading the asset database…</div>}
          {inv && !inv.enabled && <div className="h-sub" style={{ margin: "6px 0" }}>Asset database (Notion) isn&apos;t connected — type a name above and tap <b>Add</b> to put it on the list.</div>}
          {inv && inv.enabled && groupEntries.length === 0 && <div className="h-sub" style={{ margin: "6px 0" }}>No matches{ql ? ` for “${q.trim()}”` : ""}. Type to add it off-catalog.</div>}
          {groupEntries.map(([g, list]) => (
            <div key={g}>
              <div className="assign-group">{g} <span className="supply-count">{list.length}</span></div>
              {list.map(Item)}
            </div>
          ))}
        </div>
        <button className="handle supply-add" onClick={confirm} disabled={selCount === 0}>
          <span>{selCount > 0 ? `Add ${selCount} to checklist` : "Select items to add"}</span>
        </button>
      </div>
    </>
  );
}

// ───────────────────────── one stop: go-live + location + notes ─────────────────────────
function StopControl({ s, index, isCur, open, onToggle, onGoLive, onArchive, onChanged, vendors, onLinkVendor }: {
  s: Stop; index: number; isCur: boolean; open: boolean; onToggle: () => void;
  onGoLive: (id: string) => void; onArchive: () => void; onChanged: () => void;
  vendors: Vendor[]; onLinkVendor: (v: Vendor | null) => void;
}) {
  const { toast } = useApp();
  const [name, setName] = useState(s.name);
  const [address, setAddress] = useState(s.address ?? "");
  const [busy, setBusy] = useState(false);
  const hasCoords = s.lat != null && s.lng != null;

  // every update carries a WHERE (id) — safe with the safeupdate guard
  const patch = async (p: Partial<Stop>, msg = "Saved") => {
    const { error } = await supabase!.from("stops").update(p).eq("id", s.id);
    toast(error ? `Error: ${error.message}` : msg);
    if (!error) onChanged();
  };
  const saveName = () => { const nm = name.trim(); if (nm && nm !== s.name) patch({ name: nm }, "Name saved"); };
  const saveLocation = async () => {
    const q = address.trim(); if (!q) return;
    setBusy(true);
    const geo = await geocode(q);
    if (!geo) { setBusy(false); toast("Couldn't find that address — add city & state, then retry."); return; }
    const { error } = await supabase!.from("stops").update({ address: q, location_text: q, lat: geo.lat, lng: geo.lng }).eq("id", s.id);
    setBusy(false);
    toast(error ? `Error: ${error.message}` : "Location pinned — directions are now accurate");
    if (!error) onChanged();
  };
  const remove = async () => {
    if (typeof window !== "undefined" && !window.confirm(`Delete ${s.name}? This removes the record.`)) return;
    const { error } = await supabase!.from("stops").delete().eq("id", s.id);
    toast(error ? `Error: ${error.message}` : "Location deleted");
    if (!error) onChanged();
  };

  const sub = [s.poc_name, s.service_dates, hasCoords ? "pinned" : "no pin"].filter(Boolean).join("  ·  ");
  return (
    <div className={`ev-card${isCur ? " live" : ""}${open ? " open" : ""}`}>
      <button className="ev-head" onClick={onToggle} aria-expanded={open}>
        <span className="ev-led" />
        <span className="ev-head-main">
          <span className="ev-tag">Location {String(index + 1).padStart(2, "0")}{isCur ? " · Live" : ""}</span>
          <span className="ev-title">{s.name || "Untitled location"}</span>
          <span className="ev-sub">{sub || "Tap to set up"}</span>
        </span>
        <span className="ev-head-badges">
          {isCur && <span className="ev-badge live">● Live</span>}
          <span className="ev-chev">›</span>
        </span>
      </button>

      {open && (
        <div className="ev-body">
          <button className={`ev-golive${isCur ? " on" : ""}`} onClick={() => onGoLive(s.id)} disabled={isCur}>
            <span className="ev-golive-dot" />
            <span>{isCur ? "Live here now — guests see this location" : "Go live at this location"}</span>
            <span className="ev-golive-state">{isCur ? "LIVE" : "GO"}</span>
          </button>

          <div className="ev-group">
            <div className="ev-group-h">Location</div>
            <input className="ev-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} maxLength={120} placeholder="Location name" />
            <div className="stop-addr">
              <input className="ev-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address (for directions)" maxLength={300} />
              <button className="ev-archive" onClick={saveLocation} disabled={busy || !address.trim()}>{busy ? "Finding…" : "Save"}</button>
            </div>
            <div className={`stop-coords${hasCoords ? " ok" : ""}`}>{hasCoords ? `Pinned · ${(s.lat as number).toFixed(4)}, ${(s.lng as number).toFixed(4)}` : "No pin yet — add an address for accurate directions"}</div>
          </div>

          <VendorPicker vendors={vendors} vendorId={s.vendor_id} onLink={onLinkVendor} />

          {!s.vendor_id && (
            <div className="ev-group">
              <div className="ev-group-h">Point of contact</div>
              <input className="ev-input" defaultValue={s.poc_name ?? ""} placeholder="POC name" maxLength={120} onBlur={(e) => { if ((e.target.value.trim() || null) !== (s.poc_name ?? null)) patch({ poc_name: e.target.value.trim() || null }, "Contact saved"); }} />
              <input className="ev-input" type="tel" defaultValue={s.poc_phone ?? ""} placeholder="Phone" maxLength={40} onBlur={(e) => { if ((e.target.value.trim() || null) !== (s.poc_phone ?? null)) patch({ poc_phone: e.target.value.trim() || null }, "Contact saved"); }} />
              <input className="ev-input" type="email" defaultValue={s.poc_email ?? ""} placeholder="Email" maxLength={160} onBlur={(e) => { if ((e.target.value.trim() || null) !== (s.poc_email ?? null)) patch({ poc_email: e.target.value.trim() || null }, "Contact saved"); }} />
            </div>
          )}

          <div className="ev-group">
            <div className="ev-group-h">Dates of service</div>
            <input className="ev-input" defaultValue={s.service_dates ?? ""} placeholder="e.g. Saturdays · May 3 – Aug 30" maxLength={200} onBlur={(e) => { if ((e.target.value.trim() || null) !== (s.service_dates ?? null)) patch({ service_dates: e.target.value.trim() || null }, "Service dates saved"); }} />
          </div>

          <div className="ev-group">
            <div className="ev-group-h">Guest details</div>
            <textarea className="ev-input ev-area" rows={2} maxLength={1000} defaultValue={s.notes ?? ""} placeholder="Parking, what's special, anything guests should know" onBlur={(e) => { if (e.target.value !== (s.notes ?? "")) patch({ notes: e.target.value.trim() || null }, "Details saved"); }} />
          </div>

          <div className="ev-card-foot">
            <button className="ev-archive" onClick={onArchive}>Archive location</button>
            <button className="ev-delete" onClick={remove}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── live truck control ─────────────────────────
function LiveControl() {
  const { toast } = useApp();
  const [stops, setStops] = useState<Stop[]>([]);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [err, setErr] = useState("");
  const [posBusy, setPosBusy] = useState(false);
  const [openStopId, setOpenStopId] = useState<string | null>(null); // single-open accordion
  const [showArchStops, setShowArchStops] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: s, error: se }, { data: l }, { data: vs }] = await Promise.all([
      supabase.from("stops").select("*").order("sort"),
      supabase.from("live_status").select("*").maybeSingle(),
      supabase.from("vendors").select("*").order("sort"), // may not exist pre-0034
    ]);
    if (se) setErr(se.message); else setErr("");
    if (s) setStops(s as Stop[]);
    if (l) setLive(l as LiveStatus);
    if (vs) setVendors((vs as Vendor[]).filter((v) => !v.archived_at));
  }, []);
  // link a stop to a vendor → denormalize the public location onto the (public) stop row
  const linkVendor = async (stopId: string, v: Vendor | null) => {
    const p: Partial<Stop> = { vendor_id: v?.id ?? null };
    if (v) { p.name = v.name; p.address = v.address; p.location_text = v.location_text; p.lat = v.lat; p.lng = v.lng; }
    await supabase!.from("stops").update(p).eq("id", stopId);
    toast(v ? `Linked to ${v.name}` : "Unlinked");
    load();
  };

  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel("admin-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_status" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "stops" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  // Optimistic flip first (instant), then direct, RLS-protected writes — every UPDATE
  // carries an explicit filter so Supabase's "no UPDATE without WHERE" guard is happy,
  // and it doesn't depend on the admin_set_live RPC (which ran a bare UPDATE).
  const goLive = async (stopId: string) => {
    setLive((l) => ({ id: 1, current_stop_id: stopId, is_live: true, next_eta: l?.next_eta ?? null }));
    // demote any other live stop, promote this one (one live at a time)
    await supabase!.from("stops").update({ status: "upcoming" }).eq("status", "live").neq("id", stopId);
    const r1 = await supabase!.from("stops").update({ status: "live" }).eq("id", stopId);
    // upsert the single live_status row, and read it back to confirm it actually persisted
    const r2 = await supabase!.from("live_status").upsert({ id: 1, is_live: true, current_stop_id: stopId }, { onConflict: "id" }).select("is_live");
    const error = r1.error || r2.error;
    if (error) { setErr(error.message); toast(`Couldn't go live — ${error.message}`, "error"); load(); return; }
    if (!r2.data || r2.data.length === 0 || r2.data[0].is_live !== true) {
      setErr("Go live didn't persist — your account lacks owner write access (RLS). Run: update profiles set role='owner' where is_admin.");
      toast("Go live didn't save — your role lacks write access (see banner).", "error");
      load(); return;
    }
    toast("Truck is LIVE — members updated");
    load();
  };
  const pause = async () => {
    // Going offline closes out the current stop: it's archived off the live screen and the
    // next stop on the route is queued. Confirm since it drops the truck for every customer.
    const finished = stops.find((s) => s.id === live?.current_stop_id) ?? null;
    const next = stops.find((s) => !s.archived_at && s.status !== "done" && s.id !== finished?.id) ?? null;
    const msg = finished
      ? `Close out ${finished.name} and go offline?\n\nIt gets archived off the live screen${next ? `, and ${next.name} is queued up next` : ""}. Customers stop seeing the truck as live.`
      : "Take the truck OFFLINE?\n\nCustomers will immediately stop seeing it as live on the Truck page.";
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    stopBroadcast();
    setLive((l) => (l ? { ...l, is_live: false, current_stop_id: next?.id ?? null } : { id: 1, current_stop_id: next?.id ?? null, is_live: false, next_eta: null }));
    // .select() so we KNOW the row actually changed — RLS can filter a write to 0 rows
    // with NO error (the "false success" bug). If it didn't persist, say so loudly.
    const { data, error } = await supabase!.from("live_status")
      .update({ is_live: false, current_stop_id: next?.id ?? null, truck_lat: null, truck_lng: null, pos_updated_at: null })
      .eq("id", 1).select("is_live");
    if (error) { setErr(error.message); toast(`Couldn't go offline — ${error.message}`, "error"); load(); return; }
    if (!data || data.length === 0 || data[0].is_live !== false) {
      setErr("Go offline didn't persist — your account lacks owner write access (RLS). Run: update profiles set role='owner' where is_admin.");
      toast("Go offline didn't save — your role lacks write access (see banner).", "error");
      load(); return;
    }
    await supabase!.from("stops").update({ status: "upcoming" }).eq("status", "live");
    // Archive the just-finished stop off the live screen (record kept).
    if (finished) await supabase!.from("stops").update({ status: "done", archived_at: new Date().toISOString() }).eq("id", finished.id);
    toast(next ? `Offline — ${next.name} queued next` : "Truck is offline");
    load();
  };
  // One-shot pin of this phone's GPS as the truck's live position.
  const pinHere = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { toast("Location isn't available on this device", "error"); return; }
    setPosBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const { error } = await supabase!.rpc("admin_set_truck_pos", { lat: p.coords.latitude, lng: p.coords.longitude });
        setPosBusy(false);
        if (error) { setErr(error.message); toast(`Couldn't pin location — ${error.message}`, "error"); }
        else toast("Location pinned — members see the dot move");
      },
      (e) => { setPosBusy(false); toast(`Location error: ${e.message}`, "error"); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Continuous broadcast — stream the phone's GPS so the customer dot actually MOVES,
  // not just a stale one-shot pin. A screen wake lock keeps it alive while open.
  const watchRef = useRef<number | null>(null);
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);
  const lastWriteRef = useRef(0);
  const [broadcasting, setBroadcasting] = useState(false);

  const stopBroadcast = () => {
    if (watchRef.current != null && typeof navigator !== "undefined") navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
    setBroadcasting(false);
  };

  const startBroadcast = async () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { toast("Location isn't available on this device", "error"); return; }
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      wakeRef.current = wl ? await wl.request("screen") : null;
    } catch { /* wake lock is optional */ }
    watchRef.current = navigator.geolocation.watchPosition(
      async (p) => {
        const now = Date.now();
        if (now - lastWriteRef.current < 8000) return; // throttle to ~1 write / 8s
        lastWriteRef.current = now;
        await supabase!.rpc("admin_set_truck_pos", { lat: p.coords.latitude, lng: p.coords.longitude });
      },
      (e) => { toast(`Location error: ${e.message}`, "error"); stopBroadcast(); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    setBroadcasting(true);
    toast("Broadcasting live location — the dot moves with you");
  };

  // Stop streaming on unmount (ref-based so it doesn't depend on a memoized callback).
  useEffect(() => () => {
    if (watchRef.current != null && typeof navigator !== "undefined") navigator.geolocation.clearWatch(watchRef.current);
    wakeRef.current?.release().catch(() => {});
  }, []);
  const posLabel = live?.is_live
    ? live?.pos_updated_at
      ? `Pinned ${new Date(live.pos_updated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : "Location not pinned yet"
    : "";
  const addStop = async () => {
    const { data, error } = await supabase!.from("stops").insert({ name: "New location", status: "upcoming", sort: stops.length }).select("id").single();
    if (error) { setErr(error.message); toast(`Couldn't add — ${error.message}`, "error"); }
    else { if (data) setOpenStopId((data as { id: string }).id); toast("Location added — fill in its details"); }
    load();
  };
  // Archive a location out of the active list (keeps the record). If it was live, close it.
  const archiveStop = async (id: string) => {
    const wasLive = id === live?.current_stop_id;
    await supabase!.from("stops").update({ archived_at: new Date().toISOString(), status: "upcoming" }).eq("id", id);
    if (wasLive) await supabase!.from("live_status").update({ is_live: false, current_stop_id: null }).eq("id", 1);
    toast("Location archived");
    setOpenStopId(null);
    load();
  };
  const restoreStop = async (id: string) => {
    await supabase!.from("stops").update({ archived_at: null }).eq("id", id);
    toast("Location restored");
    load();
  };
  const deleteStop = async (id: string, nm: string) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete ${nm}? This removes the record.`)) return;
    await supabase!.from("stops").delete().eq("id", id);
    load();
  };
  const curStop = stops.find((s) => s.id === live?.current_stop_id);
  const active = stops.filter((s) => !s.archived_at);
  const archived = stops.filter((s) => s.archived_at);

  return (
    <div className="adm-sec">
      <div className="sec">Live truck <button className="adm-btn" style={{ marginLeft: "auto" }} onClick={addStop}>+ Add location</button></div>
      {err && <div className="adm-attn" role="alert">Backend error: {err}</div>}
      <div className="adm-live">
        <div className="adm-live-status">
          <span className={`adm-dot${live?.is_live ? " on" : ""}`} />
          <span><b>{live?.is_live ? "Live now" : "Offline"}</b>{live?.is_live && curStop ? <span className="adm-live-at"> · {curStop.name}</span> : null}</span>
        </div>
        {live?.is_live && <button className="adm-btn ghost" onClick={pause}>Go offline</button>}
      </div>
      {live?.is_live && (
        <>
          {!broadcasting && !live?.pos_updated_at && (
            <div className="adm-attn" role="alert">Customers can&apos;t see the truck on the map yet — tap <b>Broadcast live</b> so the dot tracks you.</div>
          )}
          <div className="adm-live adm-live-pos">
            <div className="adm-live-status"><span className="h-sub">{broadcasting ? "● Broadcasting — dot moves with you" : posLabel}</span></div>
            {broadcasting ? (
              <button className="adm-btn ghost" onClick={stopBroadcast}>Stop</button>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="adm-btn ghost" onClick={pinHere} disabled={posBusy}>{posBusy ? "Pinning…" : "Pin once"}</button>
                <button className="adm-btn primary" onClick={startBroadcast}>Broadcast live</button>
              </div>
            )}
          </div>
        </>
      )}

      <div className="ev-list" style={{ marginTop: 12 }}>
        {active.map((s, i) => (
          <StopControl
            key={s.id}
            s={s}
            index={i}
            isCur={Boolean(s.id === live?.current_stop_id && live?.is_live)}
            open={openStopId === s.id}
            onToggle={() => setOpenStopId(openStopId === s.id ? null : s.id)}
            onGoLive={goLive}
            onArchive={() => archiveStop(s.id)}
            onChanged={load}
            vendors={vendors}
            onLinkVendor={(v) => linkVendor(s.id, v)}
          />
        ))}
      </div>
      {active.length === 0 && <div className="ev-empty">No locations yet. Tap <b>+ Add location</b> to create one{archived.length ? ", or reopen one below" : ""}.</div>}

      {archived.length > 0 && (
        <div className="ev-archived">
          <button className="ev-arch-head" onClick={() => setShowArchStops((v) => !v)} aria-expanded={showArchStops}>
            Archived locations · {archived.length}<span className={`ev-chev${showArchStops ? " open" : ""}`}>›</span>
          </button>
          {showArchStops && archived.map((s) => (
            <div className="ev-arch-row" key={s.id}>
              <span className="ev-arch-name">{s.name || "Untitled location"}</span>
              <button className="ev-arch-btn" onClick={() => restoreStop(s.id)}>Restore</button>
              <button className="ev-arch-btn del" onClick={() => deleteStop(s.id, s.name)}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── booking requests ─────────────────────────
function Bookings() {
  const { toast } = useApp();
  const [reqs, setReqs] = useState<BookingRequest[]>([]);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("booking_requests").select("*").order("created_at", { ascending: false });
    if (data) setReqs(data as BookingRequest[]);
  }, []);
  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel("admin-bookings")
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_requests" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  const setStatus = async (id: string, status: BookingRequest["status"]) => {
    const { error } = await supabase!.from("booking_requests").update({ status }).eq("id", id);
    toast(error ? `Error: ${error.message}` : `Marked ${status}`);
    if (!error) load();
  };

  const open = reqs.filter((r) => r.status === "new").length;
  return (
    <div className="adm-sec">
      <div className="sec">Booking requests{open > 0 && <span className="adm-pill">{open} new</span>}</div>
      {reqs.map((r) => (
        <div className={`adm-req${r.status === "new" ? " new" : ""}`} key={r.id}>
          <div className="adm-member-top">
            <b>{r.name ?? "—"}{r.event_date && <span className="adm-pill">{r.event_date}</span>}</b>
            <span className="adm-ref">{r.headcount ? `${r.headcount} ppl` : ""}</span>
          </div>
          <div className="meta">
            {r.email && <><a href={`mailto:${r.email}`}>{r.email}</a>{r.phone ? " · " : ""}</>}{r.phone}
            {r.location_text && <> · {r.location_text}</>}
            {r.notes && <><br />{r.notes}</>}
          </div>
          <div className="adm-status">
            {STATUSES.map((s) => (
              <button key={s} className={r.status === s ? "on" : ""} onClick={() => setStatus(r.id, s)}>{s}</button>
            ))}
          </div>
        </div>
      ))}
      {reqs.length === 0 && <div className="h-sub">No requests yet — they land here from the Book the bar form.</div>}
    </div>
  );
}

// ───────────────────────── reserves (limited drops) ─────────────────────────
function ReservesAdmin() {
  const { toast } = useApp();
  const [rows, setRows] = useState<Reserve[]>([]);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("reserves").select("*").order("sort");
    if (data) setRows(data as Reserve[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const update = async (id: string, patch: Partial<Reserve>) => {
    const { error } = await supabase!.from("reserves").update(patch).eq("id", id);
    toast(error ? `Error: ${error.message}` : "Reserve updated");
    if (!error) load();
  };
  const add = async () => {
    const { error } = await supabase!.from("reserves").insert({
      name: "New reserve", price_cents: 1200, stock_total: 12, stock_remaining: 12, status: "draft", sort: rows.length,
    });
    toast(error ? `Error: ${error.message}` : "Reserve created — set details, then set it Live");
    if (!error) load();
  };
  const archive = async (id: string) => {
    if (typeof window !== "undefined" && !window.confirm("Archive this reserve? It disappears from the app.")) return;
    await update(id, { status: "archived" });
  };

  const active = rows.filter((r) => r.status !== "archived");
  return (
    <div className="adm-sec">
      <div className="sec">Reserves <button className="adm-btn" style={{ marginLeft: "auto" }} onClick={add}>+ Add</button></div>
      {active.map((r) => (
        <div className="adm-event" key={r.id}>
          <div className="adm-member-top">
            <input className="auth-input" style={{ fontSize: 16, padding: "9px 11px" }} maxLength={120} defaultValue={r.name} onBlur={(e) => e.target.value !== r.name && update(r.id, { name: e.target.value })} />
          </div>
          <input className="auth-input" style={{ fontSize: 16, padding: "9px 11px", marginTop: 6 }} maxLength={300} defaultValue={r.blurb ?? ""} placeholder="One line guests see" onBlur={(e) => (e.target.value.trim() || null) !== r.blurb && update(r.id, { blurb: e.target.value.trim() || null })} />
          <div className="adm-fields">
            <label>Price $<input type="text" inputMode="decimal" defaultValue={(r.price_cents / 100).toFixed(2)} onBlur={(e) => update(r.id, { price_cents: Math.max(0, Math.round(parseFloat(e.target.value || "0") * 100)) })} /></label>
            <label>Stock<input type="number" min={0} defaultValue={r.stock_total} onBlur={(e) => update(r.id, { stock_total: Math.max(0, parseInt(e.target.value) || 0) })} /></label>
            <label>Left<input type="number" min={0} defaultValue={r.stock_remaining} onBlur={(e) => update(r.id, { stock_remaining: Math.max(0, parseInt(e.target.value) || 0) })} /></label>
            <label>Limit<input type="number" min={1} defaultValue={r.per_member_limit} onBlur={(e) => update(r.id, { per_member_limit: Math.max(1, parseInt(e.target.value) || 1) })} /></label>
          </div>
          <div className="adm-fields">
            <label>Status
              <select defaultValue={r.status} onChange={(e) => update(r.id, { status: e.target.value as Reserve["status"] })}>
                <option value="draft">Draft (hidden)</option>
                <option value="live">Live</option>
                <option value="sold_out">Sold out</option>
              </select>
            </label>
            <label className="adm-check"><input type="checkbox" defaultChecked={r.member_only} onChange={(e) => update(r.id, { member_only: e.target.checked })} />Members</label>
            <button className="adm-btn ghost" onClick={() => archive(r.id)}>Archive</button>
          </div>
        </div>
      ))}
      {active.length === 0 && <div className="h-sub">No reserves yet — add a limited drop to sell to members.</div>}
    </div>
  );
}

// ───────────────────────── subscribers (read-only mirror) ─────────────────────────
function Subscribers() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("subscriptions").select("*").order("created_at", { ascending: false });
    const rows = (data as Subscription[]) ?? [];
    setSubs(rows);
    const ids = [...new Set(rows.map((r) => r.user_id))];
    if (ids.length) {
      const { data: p } = await supabase.from("profiles").select("id, display_name").in("id", ids);
      const m: Record<string, string> = {};
      (p as { id: string; display_name: string | null }[] | null)?.forEach((x) => { m[x.id] = x.display_name ?? "—"; });
      setNames(m);
    }
  }, []);
  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel("admin-subs").on("postgres_changes", { event: "*", schema: "public", table: "subscriptions" }, () => load()).subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  // Fulfillment-first ordering: trouble (past_due) and soonest-due float to the top so
  // an admin sees "who do I prep next / who needs a nudge" at a glance.
  const rank: Record<string, number> = { past_due: 0, active: 1, pending: 2, paused: 3, canceled: 4 };
  const ordered = [...subs].sort(
    (a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || ((a.current_period_end ?? "9") < (b.current_period_end ?? "9") ? -1 : 1)
  );
  const active = subs.filter((s) => s.status === "active");
  const daysTo = (d: string | null) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null);
  const dueSoon = active.filter((s) => { const n = daysTo(s.current_period_end); return n != null && n <= 3; }).length;
  const packOf = (plan: string) => { const n = plan?.match(/\d+/)?.[0]; return n ? `${n} cups · every 2 wks` : plan; };
  const renew = (s: Subscription) => {
    if (s.status === "past_due") return { text: "Payment failed — card needs updating", cls: "due" };
    const n = daysTo(s.current_period_end);
    if (n == null) return { text: packOf(s.plan), cls: "" };
    const when = n < 0 ? `overdue ${-n}d` : n === 0 ? "due today" : `fulfill in ${n}d`;
    return { text: `${packOf(s.plan)} · ${when}`, cls: n <= 0 ? "due" : n <= 3 ? "soon" : "" };
  };
  return (
    <div className="adm-sec">
      <div className="sec">Subscribers{active.length > 0 && <span className="adm-pill">{active.length} active</span>}{dueSoon > 0 && <span className="adm-pill due">{dueSoon} due soon</span>}</div>
      {ordered.map((s) => {
        const r = renew(s);
        return (
          <div className="adm-member" key={s.id}>
            <div className="adm-member-top">
              <b>{names[s.user_id] ?? "Member"}</b>
              <span className={`adm-substat ${s.status}`}>{s.status.replace("_", " ")}</span>
            </div>
            <div className={`meta sub-renew ${r.cls}`}>{r.text}</div>
          </div>
        );
      })}
      {subs.length === 0 && <div className="h-sub">No subscribers yet — members subscribe from their 3MPIRE.</div>}
    </div>
  );
}

// ───────────────────────── member management ─────────────────────────
function MemberRow({ m, onSaved }: { m: Profile; onSaved: () => void }) {
  const { toast } = useApp();
  const [pts, setPts] = useState(m.points);
  const [credit, setCredit] = useState((m.credit_cents / 100).toFixed(2));
  const [founding, setFounding] = useState(m.founding_member);
  const [busy, setBusy] = useState(false);
  const dirty = pts !== m.points || credit !== (m.credit_cents / 100).toFixed(2) || founding !== m.founding_member;

  const save = async () => {
    setBusy(true);
    const { error } = await supabase!.rpc("admin_set_member", {
      member: m.id,
      new_points: pts,
      new_credit_cents: Math.max(0, Math.round(parseFloat(credit || "0") * 100)),
      new_founding: founding,
    });
    setBusy(false);
    toast(error ? `Error: ${error.message}` : `Saved ${m.display_name ?? "member"}`);
    if (!error) onSaved();
  };
  const setRole = async (newRole: string) => {
    const { error } = await supabase!.rpc("admin_set_role", { member: m.id, new_role: newRole });
    toast(error ? `Error: ${error.message}` : `${m.display_name ?? "Member"} is now ${newRole}`);
    if (!error) onSaved();
  };

  return (
    <div className="adm-member">
      <div className="adm-member-top">
        <b>{m.display_name ?? "—"}{roleOf(m) !== "member" && <span className="adm-tag">{roleOf(m)}</span>}</b>
        <span className="adm-ref">{m.referral_code}</span>
      </div>
      <div className="adm-fields">
        <label>Role<select className="adm-role" value={roleOf(m)} onChange={(e) => setRole(e.target.value)}>
          <option value="member">member</option>
          <option value="server">server</option>
          <option value="operator">operator</option>
          <option value="event_manager">event manager</option>
          <option value="contractor">contractor</option>
          <option value="admin">admin</option>
          <option value="owner">owner</option>
        </select></label>
        <label>Points<input type="number" min={0} value={pts} onChange={(e) => setPts(Math.max(0, parseInt(e.target.value) || 0))} /></label>
        <label>Credit $<input type="text" inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} /></label>
        <label className="adm-check"><input type="checkbox" checked={founding} onChange={(e) => setFounding(e.target.checked)} />Founding</label>
        <button className={`adm-btn${dirty ? " primary" : ""}`} onClick={save} disabled={!dirty || busy}>{busy ? "…" : "Save"}</button>
      </div>
    </div>
  );
}

function Members() {
  const [members, setMembers] = useState<Profile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("profiles").select("*").order("display_name");
    if (data) setMembers(data as Profile[]);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = members.filter((m) =>
    !q || (m.display_name ?? "").toLowerCase().includes(q.toLowerCase()) || (m.referral_code ?? "").toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="adm-sec">
      <div className="sec">Members · {members.length}</div>
      {members.length > 6 && (
        <input className="auth-input" style={{ marginBottom: 4 }} placeholder="Search by name or code" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      {shown.map((m) => <MemberRow key={m.id} m={m} onSaved={load} />)}
      {loaded && members.length === 0 && <div className="h-sub">No members yet — they appear here when people sign in.</div>}
    </div>
  );
}

// ───────────────────────── events ─────────────────────────
// ───────────────────────── live event HUD (command center) ─────────────────────────
// The 3 numbers that matter mid-event, scoped to the live event. Sales = paid app orders
// + Square POS mirror (event_sales), so walk-up cart sales count too.
function EventHUD() {
  const [ev, setEv] = useState<EventRow | null>(null);
  const [stats, setStats] = useState<{ cents: number; orders: number; firstAt: string | null }>({ cents: 0, orders: 0, firstAt: null });
  const [econ, setEcon] = useState<EventEcon | null>(null);
  const [catalog, setCatalog] = useState<ProductEcon[]>([]);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data: e } = await supabase.from("events").select("*").eq("is_live", true).maybeSingle();
    setEv((e as EventRow) ?? null);
    if (!e) { setStats({ cents: 0, orders: 0, firstAt: null }); return; }
    const eid = (e as EventRow).id;
    const [{ data: ords }, { data: sales }, { data: cat }, { data: ec }] = await Promise.all([
      supabase.from("orders").select("total_cents, paid, created_at").eq("event_id", eid),
      supabase.from("event_sales").select("amount_cents, created_at").eq("event_id", eid),
      supabase.from("product_economics").select("*").eq("active", true).order("sort"),
      supabase.from("event_economics").select("*").eq("event_id", eid).maybeSingle(),
    ]);
    const o = (ords as { total_cents: number; paid: boolean; created_at: string }[]) ?? [];
    const s = (sales as { amount_cents: number; created_at: string }[]) ?? [];
    const cents = o.filter((x) => x.paid).reduce((a, x) => a + x.total_cents, 0) + s.reduce((a, x) => a + x.amount_cents, 0);
    const times = [...o.map((x) => x.created_at), ...s.map((x) => x.created_at)].filter(Boolean).sort();
    setStats({ cents, orders: o.length + s.length, firstAt: times[0] ?? null });
    setCatalog((cat as ProductEcon[]) ?? []);
    setEcon((ec as EventEcon) ?? null);
  }, []);
  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel("admin-eventhud")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "event_sales" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => load())
      .subscribe();
    // Reconcile every 15s so Square POS walk-ups + the $/hr clock advance even if a
    // realtime event is missed (matches the KDS's reconcile).
    const recon = setInterval(load, 15000);
    return () => { clearInterval(recon); supabase?.removeChannel(ch); };
  }, [load]);
  if (!ev) return null;
  const hrs = stats.firstAt ? Math.max(0.25, (Date.now() - new Date(stats.firstAt).getTime()) / 3600000) : 0;
  const perHr = hrs ? stats.cents / hrs : 0;
  // plan vs actual — feed the real gross into the projection's cost structure
  const proj = projectEvent(ev, econ ?? DEFAULT_ECON, catalog);
  const recon = reconcile(proj, stats.cents, econ ?? DEFAULT_ECON);
  const hasPlan = proj.revenueCents > 0;
  const pctOfPlan = hasPlan ? Math.round((stats.cents / proj.revenueCents) * 100) : 0;
  const netUp = recon.actualNetCents >= 0;
  return (
    <div className="adm-sec adm-hud">
      <div className="sec">{ev.title}<span className="adm-pill due">LIVE</span></div>
      <div className="adm-hud-row">
        <div className="adm-hud-stat"><b>${(stats.cents / 100).toFixed(0)}</b><span>sales</span></div>
        <div className="adm-hud-stat"><b>{stats.orders}</b><span>orders</span></div>
        <div className="adm-hud-stat"><b>${(perHr / 100).toFixed(0)}</b><span>per hr</span></div>
      </div>
      {hasPlan && (
        <>
          <div className="wrule"><span>Plan vs actual</span></div>
          <div className="adm-hud-row">
            <div className="adm-hud-stat"><b className={pctOfPlan >= 100 ? "ok" : "gold"}>{pctOfPlan}%</b><span>of plan</span></div>
            <div className="adm-hud-stat"><b className={netUp ? "ok" : "red"}>{usd(recon.actualNetCents)}</b><span>net now</span></div>
            <div className="adm-hud-stat"><b className={netUp ? "ok" : "red"}>{pctInt(recon.actualRoiPct)}%</b><span>ROI now</span></div>
          </div>
          <div className="pnl-be">Plan {usd(proj.revenueCents)} rev · {usd(proj.netCents)} net{proj.breakEvenGuests != null ? ` · break-even ${Math.ceil(proj.breakEvenGuests)} guests` : ""}</div>
        </>
      )}
    </div>
  );
}

// ───────────────────────── event ROI / P&L (telemetry money panel) ─────────────────────────
// Live projection — recomputes on every keystroke; persists on blur. Reads the
// event's own config (attendance/hours/crew/menu) so the plan tracks reality.
function EventEconomics({ e, econRow, catalog, onSave }: {
  e: EventRow; econRow: EventEcon | null; catalog: ProductEcon[];
  onSave: (econ: EventEcon) => void;
}) {
  const [econ, setEcon] = useState<EventEcon>(econRow ?? DEFAULT_ECON);
  useEffect(() => { if (econRow) setEcon(econRow); }, [econRow]);
  const proj = useMemo(() => projectEvent(e, econ, catalog), [e, econ, catalog]);
  const live = (patch: Partial<EventEcon>) => setEcon((p) => ({ ...p, ...patch }));   // live gauge
  const commit = () => onSave(econ);                                                    // persist
  const fixed = econ.booth_cents + econ.transport_cents + econ.permit_cents + econ.consumables_cents;
  const profitable = proj.netCents >= 0;
  const uncosted = proj.lines.some((l) => !l.costed);

  return (
    <div className="ev-group ev-pnl">
      <div className="ev-group-h">Economics · projected ROI</div>

      {proj.enabledLines === 0 ? (
        <div className="pnl-note">Turn on the menu lines you&apos;ll pour (above) to project revenue &amp; ROI.</div>
      ) : (
        <>
          <div className="ev-pnl-gauges">
            <div className="gauge"><div className={`gv ${profitable ? "gold" : "red"}`}>{pctInt(proj.roiPct)}%</div><div className="gl">ROI</div></div>
            <div className="gauge"><div className={`gv ${profitable ? "ok" : "red"}`}>{usd(proj.netCents)}</div><div className="gl">Net profit</div></div>
            <div className="gauge"><div className="gv">{pctInt(proj.netMarginPct)}%</div><div className="gl">Margin</div></div>
          </div>

          <div className="pnl-rows">
            <div className="pnl-row"><span className="k">Revenue · {Math.round(proj.projectedUnits)} units</span><span className="v">{usd(proj.revenueCents)}</span></div>
            <div className="pnl-row neg"><span className="k">− Product COGS</span><span className="v">−{usd(proj.cogsCents)}</span></div>
            <div className="pnl-row neg"><span className="k">− Labor</span><span className="v">−{usd(proj.laborCents)}</span></div>
            <div className="pnl-row neg"><span className="k">− Booth · transport · permit · cups</span><span className="v">−{usd(fixed)}</span></div>
            <div className={`pnl-row net ${profitable ? "" : "neg"}`}><span className="k">Net profit</span><span className="v">{usd(proj.netCents)}</span></div>
          </div>

          <div className="pnl-be">
            {proj.breakEvenGuests != null
              ? <>Break-even ≈ {Math.ceil(proj.breakEvenGuests)} buying guests · you&apos;re projecting {Math.round(proj.projectedGuests)}</>
              : <>Set a unit price to compute break-even</>}
          </div>
          {uncosted && <div className="pnl-note">Some lines use the blended {pctInt(econ.cogs_pct)}% COGS — set their unit cost in Money → Product economics for exact margin.</div>}
        </>
      )}

      <div className="ev-sub-h">Projection knobs</div>
      <div className="ev-grid">
        <label className="ev-f">Capture %<input type="number" min={0} max={100} value={pctInt(econ.capture_pct)} onChange={(ev) => live({ capture_pct: (parseFloat(ev.target.value) || 0) / 100 })} onBlur={commit} /></label>
        <label className="ev-f">Units/guest<input type="number" min={0} step={0.1} value={econ.items_per_guest} onChange={(ev) => live({ items_per_guest: parseFloat(ev.target.value) || 0 })} onBlur={commit} /></label>
        <label className="ev-f">COGS %<input type="number" min={0} max={100} value={pctInt(econ.cogs_pct)} onChange={(ev) => live({ cogs_pct: (parseFloat(ev.target.value) || 0) / 100 })} onBlur={commit} /></label>
      </div>

      <div className="ev-sub-h">Cost lines</div>
      <div className="ev-grid">
        <label className="ev-f">Labor $/hr<input type="number" min={0} value={(econ.labor_rate_cents / 100) || 0} onChange={(ev) => live({ labor_rate_cents: toCents(ev.target.value) })} onBlur={commit} /></label>
        <label className="ev-f">Booth $<input type="number" min={0} value={(econ.booth_cents / 100) || 0} onChange={(ev) => live({ booth_cents: toCents(ev.target.value) })} onBlur={commit} /></label>
        <label className="ev-f">Transport $<input type="number" min={0} value={(econ.transport_cents / 100) || 0} onChange={(ev) => live({ transport_cents: toCents(ev.target.value) })} onBlur={commit} /></label>
        <label className="ev-f">Permit $<input type="number" min={0} value={(econ.permit_cents / 100) || 0} onChange={(ev) => live({ permit_cents: toCents(ev.target.value) })} onBlur={commit} /></label>
        <label className="ev-f">Cups/ice $<input type="number" min={0} value={(econ.consumables_cents / 100) || 0} onChange={(ev) => live({ consumables_cents: toCents(ev.target.value) })} onBlur={commit} /></label>
        <label className="ev-f">Labor total<input type="text" readOnly value={usd(proj.laborCents)} tabIndex={-1} /></label>
      </div>
    </div>
  );
}

// Owner-set price + unit cost per menu line (Money tab). Drives exact per-product COGS.
function ProductCatalog() {
  const { toast } = useApp();
  const [rows, setRows] = useState<ProductEcon[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) { setLoaded(true); return; }
    const { data } = await supabase.from("product_economics").select("*").order("sort");
    if (data) setRows(data as ProductEcon[]);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async (key: string, patch: Partial<ProductEcon>) => {
    const { error } = await supabase!.from("product_economics").update(patch).eq("product_key", key);
    if (error) toast(`Error: ${error.message}`); else load();
  };
  return (
    <div className="adm-sec">
      <div className="sec">Product economics</div>
      <div className="pnl-note" style={{ marginBottom: 10 }}>Representative price &amp; unit cost per line — these set exact COGS for every event&apos;s ROI projection.</div>
      {rows.map((r) => (
        <div className="cat-row" key={r.product_key}>
          <div className="cat-name">{r.label}</div>
          <label className="ev-f">Price $<input type="number" min={0} defaultValue={(r.price_cents / 100) || 0} onBlur={(ev) => toCents(ev.target.value) !== r.price_cents && save(r.product_key, { price_cents: toCents(ev.target.value) })} /></label>
          <label className="ev-f">Cost $<input type="number" min={0} defaultValue={r.unit_cost_cents != null ? (r.unit_cost_cents / 100) : ""} placeholder="—" onBlur={(ev) => save(r.product_key, { unit_cost_cents: ev.target.value.trim() ? toCents(ev.target.value) : null })} /></label>
          <div className="cat-margin">{r.unit_cost_cents != null && r.price_cents > 0 ? `${pctInt((r.price_cents - r.unit_cost_cents) / r.price_cents)}%` : "—"}</div>
        </div>
      ))}
      {loaded && rows.length === 0 && <div className="pnl-note">No catalog yet — apply migration 0028 to seed it.</div>}
    </div>
  );
}

// Menu pours that drive the pack list — rendered as tap-to-toggle chips, not cramped checkboxes.
const EVENT_MENU: { key: "menu_nitro" | "menu_nature_aid" | "menu_salted_maple" | "menu_bottles" | "menu_broth"; label: string }[] = [
  { key: "menu_nitro", label: "Nitro" },
  { key: "menu_nature_aid", label: "Nature Aid" },
  { key: "menu_salted_maple", label: "Salted Maple" },
  { key: "menu_bottles", label: "Bottles" },
  { key: "menu_broth", label: "Broth" },
];

// Event Brief — computed prep intelligence (demand → brew/pack → ingredient pull →
// crew check → readiness → risk flags). Turns the menu/attendance config into knowledge.
function BriefPanel({ e, proj, inventory }: { e: EventRow; proj: Projection; inventory: InventoryResp }) {
  const b = useMemo(() => buildBrief(e, proj), [e, proj]);
  const inv = useMemo(() => inventoryForEvent(inventory.items, e), [inventory, e]);
  return (
    <div className="ev-group ev-brief">
      <div className="ev-group-h">Event brief · what to bring</div>
      <div className="ev-pnl-gauges">
        <div className="gauge"><div className={`gv ${b.readiness >= 80 ? "ok" : b.readiness >= 50 ? "gold" : "red"}`}>{b.readiness}%</div><div className="gl">Ready</div></div>
        <div className="gauge"><div className="gv">{b.projectedUnits}</div><div className="gl">Units</div></div>
        <div className="gauge"><div className={`gv ${b.crewOk ? "ok" : "red"}`}>{b.crewHave}/{b.crewNeeded || "–"}</div><div className="gl">Crew</div></div>
      </div>

      {b.risks.length > 0 && (
        <div className="ev-risks">
          {b.risks.map((r, i) => (<div key={i} className={`ev-risk ${r.level}`}><span className="ev-risk-dot" />{r.text}</div>))}
        </div>
      )}

      {b.prep.length > 0 && (
        <>
          <div className="ev-sub-h">Brew &amp; pack</div>
          <div className="ev-prep-list">
            {b.prep.map((p) => (
              <div key={p.key} className="ev-prep-row">
                <span className="ev-prep-n">{p.units}</span>
                <span className="ev-prep-x"><b>{p.label}</b><span>{p.prep}</span></span>
              </div>
            ))}
          </div>
          <div className="ev-sub-h">Ingredient pull</div>
          <div className="ev-ing">
            {b.ingredients.map((g, i) => (<div key={i} className="ev-ing-row"><span>{g.name}</span><span className="ev-ing-q">{g.qty}</span></div>))}
          </div>

          <div className="ev-sub-h">Inventory check{inventory.enabled && <span className="ev-inv-live"> ● live</span>}</div>
          {!inventory.enabled ? (
            <div className="pnl-note">Quantities above are estimates. Connect your Notion inventory (set <b>NOTION_TOKEN</b> + share the GT3 — Inventory DB with the integration) to check real on-hand stock against this event here.</div>
          ) : inv.low.length === 0 ? (
            <div className="ev-risk info"><span className="ev-risk-dot" />{inv.onHandCount} relevant item{inv.onHandCount === 1 ? "" : "s"} on hand · nothing below reorder point.</div>
          ) : (
            <div className="ev-invlist">
              {inv.low.map((it, i) => (
                <div key={i} className={`ev-inv-row${(it.qty ?? 0) <= 0 ? " out" : ""}`}>
                  <span className="ev-inv-n">{it.qty ?? "—"}</span>
                  <span className="ev-inv-x"><b>{it.name}</b><span>reorder at {it.reorderPoint ?? "—"}{it.unit ? ` ${it.unit}` : ""}</span></span>
                  {it.reorderLink && <a className="ev-inv-link" href={it.reorderLink} target="_blank" rel="noreferrer">Reorder ›</a>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// One event as a collapsible card: clean header when closed, full editor when open.
function EventCard({ e, index, open, onToggle, onUpdate, onRemove, onSetLive, onArchive, econRow, catalog, inventory, vendors, onLinkVendor, onSaveEcon }: {
  e: EventRow;
  index: number;
  open: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<EventRow>) => void;
  onRemove: () => void;
  onSetLive: (live: boolean) => void;
  onArchive: () => void;
  econRow: EventEcon | null;
  catalog: ProductEcon[];
  inventory: InventoryResp;
  vendors: Vendor[];
  onLinkVendor: (v: Vendor | null) => void;
  onSaveEcon: (econ: EventEcon) => void;
}) {
  const when = [e.day_label, [e.start_time, e.end_time].filter(Boolean).join("–")].filter(Boolean).join(" ");
  const sub = [when, e.location_text].filter(Boolean).join("  ·  ");
  const tag = `Event ${String(index + 1).padStart(2, "0")}${e.is_live ? " · Live" : ""}`;
  // go/no-go ROI at a glance — from saved economics, no need to expand
  const proj = useMemo(() => projectEvent(e, econRow ?? DEFAULT_ECON, catalog), [e, econRow, catalog]);
  const showRoi = catalog.length > 0 && proj.revenueCents > 0;
  return (
    <div className={`ev-card${e.is_live ? " live" : ""}${open ? " open" : ""}`}>
      <button className="ev-head" onClick={onToggle} aria-expanded={open}>
        <span className="ev-led" />
        <span className="ev-head-main">
          <span className="ev-tag">{tag}</span>
          <span className="ev-title">{e.title || "Untitled event"}</span>
          <span className="ev-sub">{sub || "Tap to set up"}</span>
        </span>
        <span className="ev-head-badges">
          {showRoi && <span className={`ev-badge roi${proj.netCents < 0 ? " neg" : ""}`}>ROI {pctInt(proj.roiPct)}%</span>}
          {e.member_only && <span className="ev-badge gold">Members</span>}
          {!!e.going_count && <span className="ev-badge">{e.going_count} going</span>}
          <span className="ev-chev">›</span>
        </span>
      </button>

      {open && (
        <div className="ev-body">
          {/* The one action that matters most gets its own banner — throw the green flag. */}
          <button className={`ev-golive${e.is_live ? " on" : ""}`} onClick={() => onSetLive(!e.is_live)}>
            <span className="ev-golive-dot" />
            <span>{e.is_live ? "Green flag out — POS & app sales tracking here" : "Throw the green flag — go live"}</span>
            <span className="ev-golive-state">{e.is_live ? "LIVE" : "OFF"}</span>
          </button>

          <VendorPicker vendors={vendors} vendorId={e.vendor_id} onLink={onLinkVendor} />

          {/* What guests see */}
          <div className="ev-group">
            <div className="ev-group-h">Guest facing</div>
            <input className="ev-input" maxLength={200} defaultValue={e.title} placeholder="Event title" aria-label="Event title"
              onBlur={(ev) => ev.target.value !== e.title && onUpdate({ title: ev.target.value })} />
            <textarea className="ev-input ev-area" maxLength={300} rows={2} defaultValue={e.blurb ?? ""} placeholder="Details guests see when they tap this event" aria-label="Event details"
              onBlur={(ev) => (ev.target.value.trim() || null) !== e.blurb && onUpdate({ blurb: ev.target.value.trim() || null })} />
            <input className="ev-input" maxLength={200} defaultValue={e.location_text ?? ""} placeholder="Location" aria-label="Location"
              onBlur={(ev) => (ev.target.value.trim() || null) !== e.location_text && onUpdate({ location_text: ev.target.value.trim() || null })} />
            <div className="ev-grid">
              <label className="ev-f">Day<input defaultValue={e.day_label ?? ""} placeholder="SAT" onBlur={(ev) => ev.target.value !== e.day_label && onUpdate({ day_label: ev.target.value })} /></label>
              <label className="ev-f">Start<input defaultValue={e.start_time ?? ""} placeholder="9:00" onBlur={(ev) => (ev.target.value.trim() || null) !== e.start_time && onUpdate({ start_time: ev.target.value.trim() || null })} /></label>
              <label className="ev-f">End<input defaultValue={e.end_time ?? ""} placeholder="2:00" onBlur={(ev) => (ev.target.value.trim() || null) !== e.end_time && onUpdate({ end_time: ev.target.value.trim() || null })} /></label>
              <label className="ev-f">Going<input type="number" min={0} defaultValue={e.going_count ?? 0} onBlur={(ev) => onUpdate({ going_count: Math.max(0, parseInt(ev.target.value) || 0) })} /></label>
            </div>
            <button className={`ev-toggle${e.member_only ? " on" : ""}`} onClick={() => onUpdate({ member_only: !e.member_only })} aria-pressed={e.member_only}>
              <span className="ev-toggle-track"><span className="ev-toggle-knob" /></span>
              Members only
            </button>
          </div>

          {/* What the crew needs */}
          <div className="ev-group">
            <div className="ev-group-h">Crew prep · pack signal</div>
            <div className="ev-grid">
              <label className="ev-f wide">Rig
                <select defaultValue={e.rig ?? ""} onChange={(ev) => onUpdate({ rig: (ev.target.value || null) as EventRow["rig"] })}>
                  <option value="">— pick —</option><option value="cart_only">Cart only</option><option value="trailer_plus_cart">Trailer + cart</option>
                </select>
              </label>
              <label className="ev-f">State<input maxLength={20} placeholder="GA" defaultValue={e.state ?? ""} onBlur={(ev) => onUpdate({ state: ev.target.value.trim() || null })} /></label>
              <label className="ev-f">County<input maxLength={40} placeholder="Fulton" defaultValue={e.county ?? ""} onBlur={(ev) => onUpdate({ county: ev.target.value.trim() || null })} /></label>
            </div>
            <div className="ev-grid">
              <label className="ev-f">Attendance<input type="number" min={0} defaultValue={e.expected_attendance ?? 0} onBlur={(ev) => onUpdate({ expected_attendance: Math.max(0, parseInt(ev.target.value) || 0) })} /></label>
              <label className="ev-f">Hours<input type="number" min={0} step={0.5} defaultValue={e.duration_hrs ?? 0} onBlur={(ev) => onUpdate({ duration_hrs: parseFloat(ev.target.value) || 0 })} /></label>
              <label className="ev-f">Crew<input type="number" min={0} defaultValue={e.staff_count ?? 0} onBlur={(ev) => onUpdate({ staff_count: Math.max(0, parseInt(ev.target.value) || 0) })} /></label>
            </div>

            <div className="ev-sub-h">Menu pouring</div>
            <div className="ev-chips">
              {EVENT_MENU.map((m) => (
                <button key={m.key} className={`ev-chip${e[m.key] ? " on" : ""}`} aria-pressed={!!e[m.key]} onClick={() => onUpdate({ [m.key]: !e[m.key] } as Partial<EventRow>)}>{m.label}</button>
              ))}
            </div>

            <div className="ev-sub-h">On site</div>
            <div className="ev-chips">
              <button className={`ev-chip${e.power_available ? " on" : ""}`} aria-pressed={!!e.power_available} onClick={() => onUpdate({ power_available: !e.power_available })}>Power</button>
              <button className={`ev-chip${e.water_available ? " on" : ""}`} aria-pressed={!!e.water_available} onClick={() => onUpdate({ water_available: !e.water_available })}>Water</button>
            </div>
          </div>

          <BriefPanel e={e} proj={proj} inventory={inventory} />

          <EventEconomics e={e} econRow={econRow} catalog={catalog} onSave={onSaveEcon} />

          <div className="ev-card-foot">
            <button className="ev-archive" onClick={onArchive}>{e.is_live ? "Close & archive" : "Archive event"}</button>
            <button className="ev-delete" onClick={onRemove}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

function EventsAdmin() {
  const { toast } = useApp();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null); // single-open accordion
  const [catalog, setCatalog] = useState<ProductEcon[]>([]);
  const [econMap, setEconMap] = useState<Record<string, EventEcon>>({});
  const [showArch, setShowArch] = useState(false);
  const [inventory, setInventory] = useState<InventoryResp>({ enabled: false, items: [] });
  const [vendors, setVendors] = useState<Vendor[]>([]);
  useEffect(() => { fetchInventory().then(setInventory); }, []); // live stock from Notion (token-gated)
  const load = useCallback(async () => {
    if (!supabase) return;
    // events + economics catalog + per-event econ + vendors in one round
    // (catalog/econ/vendors tables may not exist pre-migration — fail soft).
    const [evs, cat, ec, vs] = await Promise.all([
      supabase.from("events").select("*").order("sort"),
      supabase.from("product_economics").select("*").eq("active", true).order("sort"),
      supabase.from("event_economics").select("*"),
      supabase.from("vendors").select("*").order("sort"),
    ]);
    if (evs.data) setEvents(evs.data as EventRow[]);
    if (cat.data) setCatalog(cat.data as ProductEcon[]);
    if (vs.data) setVendors((vs.data as Vendor[]).filter((v) => !v.archived_at));
    if (ec.data) {
      const m: Record<string, EventEcon> = {};
      for (const r of ec.data as ({ event_id: string } & EventEcon)[]) m[r.event_id] = r;
      setEconMap(m);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  // link an event to a vendor → denormalize the guest-visible location
  const linkVendor = async (eventId: string, v: Vendor | null) => {
    const p: Partial<EventRow> = { vendor_id: v?.id ?? null };
    if (v) { p.location_text = v.location_text ?? v.name; }
    await supabase!.from("events").update(p).eq("id", eventId);
    toast(v ? `Linked to ${v.name}` : "Unlinked");
    load();
  };

  // upsert the full econ row (keeps DB authoritative copy in sync with the panel)
  const saveEcon = async (id: string, econ: EventEcon) => {
    setEconMap((m) => ({ ...m, [id]: econ })); // optimistic — no flicker on the live gauge
    await supabase!.from("event_economics").upsert({ event_id: id, ...econ }, { onConflict: "event_id" });
  };

  const update = async (id: string, patch: Partial<EventRow>) => {
    const { error } = await supabase!.from("events").update(patch).eq("id", id);
    toast(error ? `Error: ${error.message}` : "Event updated");
    if (!error) load();
  };
  const addEvent = async () => {
    const { data, error } = await supabase!.from("events").insert({ title: "New event", day_label: "SAT", sort: events.length }).select("id").single();
    toast(error ? `Error: ${error.message}` : "Event added");
    if (!error) { if (data) setOpenId((data as { id: string }).id); load(); } // open the new one for editing
  };
  const remove = async (id: string) => {
    if (typeof window !== "undefined" && !window.confirm("Remove this event?")) return;
    const { error } = await supabase!.from("events").delete().eq("id", id);
    toast(error ? `Error: ${error.message}` : "Event removed");
    if (!error) load();
  };
  // Mark an event live — sales (POS + app) start tracking to it; only one live at a time.
  const setLive = async (id: string, live: boolean) => {
    const { error } = await supabase!.rpc("admin_set_event_live", { p_event: id, p_live: live });
    toast(error ? `Error: ${error.message}` : live ? "Event is live — sales now track to it" : "Event closed");
    if (!error) load();
  };
  // Archive — closes the event (clears live) and files it out of the active workspace.
  // It stays in the DB for records/AAR; restore brings it back.
  const archive = async (id: string) => {
    const { error } = await supabase!.from("events").update({ archived_at: new Date().toISOString(), is_live: false }).eq("id", id);
    toast(error ? `Error: ${error.message}` : "Event archived");
    if (!error) { setOpenId(null); load(); }
  };
  const restore = async (id: string) => {
    const { error } = await supabase!.from("events").update({ archived_at: null }).eq("id", id);
    toast(error ? `Error: ${error.message}` : "Event restored");
    if (!error) load();
  };

  const active = events.filter((e) => !e.archived_at);
  const archived = events.filter((e) => e.archived_at);

  return (
    <div className="adm-sec">
      <div className="sec">Events <button className="adm-btn" style={{ marginLeft: "auto" }} onClick={addEvent}>+ Add</button></div>
      {active.length === 0 && <div className="ev-empty">No active events. Tap <b>+ Add</b> to create one{archived.length ? ", or reopen one below" : ""}.</div>}
      <div className="ev-list">
        {active.map((e, i) => (
          <EventCard
            key={e.id}
            e={e}
            index={i}
            open={openId === e.id}
            onToggle={() => setOpenId(openId === e.id ? null : e.id)}
            onUpdate={(patch) => update(e.id, patch)}
            onRemove={() => remove(e.id)}
            onSetLive={(live) => setLive(e.id, live)}
            onArchive={() => archive(e.id)}
            econRow={econMap[e.id] ?? null}
            catalog={catalog}
            inventory={inventory}
            vendors={vendors}
            onLinkVendor={(v) => linkVendor(e.id, v)}
            onSaveEcon={(econ) => saveEcon(e.id, econ)}
          />
        ))}
      </div>

      {archived.length > 0 && (
        <div className="ev-archived">
          <button className="ev-arch-head" onClick={() => setShowArch((s) => !s)} aria-expanded={showArch}>
            Archived · {archived.length}<span className={`ev-chev${showArch ? " open" : ""}`}>›</span>
          </button>
          {showArch && archived.map((e) => (
            <div className="ev-arch-row" key={e.id}>
              <span className="ev-arch-name">{e.title || "Untitled event"}</span>
              <button className="ev-arch-btn" onClick={() => restore(e.id)}>Restore</button>
              <button className="ev-arch-btn del" onClick={() => remove(e.id)}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── subscription interest (waitlist / demand signal) ─────────────────────────
function SubInterest() {
  const [rows, setRows] = useState<{ pack_size: string | null; email: string | null; created_at: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!supabase) { setLoaded(true); return; }
    supabase.from("subscription_interest").select("pack_size,email,created_at").order("created_at", { ascending: false }).limit(100)
      .then(({ data }) => { if (data) setRows(data as { pack_size: string | null; email: string | null; created_at: string }[]); setLoaded(true); });
  }, []);
  const byPack = (k: string) => rows.filter((r) => r.pack_size === k).length;
  return (
    <div className="adm-sec">
      <div className="sec">Subscription interest{rows.length > 0 && <span className="adm-pill">{rows.length}</span>}</div>
      {rows.length > 0 && <div className="meta" style={{ marginBottom: 10 }}>6-pack · {byPack("6")} &nbsp;|&nbsp; 12-pack · {byPack("12")} &nbsp;|&nbsp; 18-pack · {byPack("18")}</div>}
      {rows.map((r, i) => (
        <div className="adm-member" key={i}>
          <div className="adm-member-top">
            <b>{r.email ?? "—"}</b>
            <span className="adm-substat active">{r.pack_size ? `${r.pack_size}-pack` : "—"}</span>
          </div>
          <div className="meta">{new Date(r.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}</div>
        </div>
      ))}
      {loaded && rows.length === 0 && <div className="h-sub">No interest yet — it lands here when people tap &ldquo;Notify me&rdquo; on the subscription pitch.</div>}
    </div>
  );
}

// ───────────────────────── order history (review past orders) ─────────────────────────
function OrdersHistory() {
  const [rows, setRows] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("orders").select("*").in("status", ["done", "void"]).order("status_changed_at", { ascending: false }).limit(60);
    if (data) setRows(data as Order[]);
    setLoaded(true);
  }, []);
  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel("admin-history").on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load()).subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);
  const done = rows.filter((r) => r.status === "done").length;
  return (
    <div className="adm-sec">
      <div className="sec">Order history{done > 0 && <span className="adm-pill">{done} completed</span>}</div>
      {rows.map((o) => (
        <div className="adm-member" key={o.id}>
          <div className="adm-member-top">
            <b>{o.customer ?? "Guest"}</b>
            <span className={`adm-substat ${o.status === "void" ? "past_due" : "active"}`}>{o.status}</span>
          </div>
          <div className="meta">{groupItems(o.items).map((g) => `${g.qty > 1 ? g.qty + "× " : ""}${DRINKS[g.id as DrinkId]?.n ?? g.id}`).join(" · ")} · ${(o.total_cents / 100).toFixed(2)} · {new Date(o.status_changed_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
        </div>
      ))}
      {loaded && rows.length === 0 && <div className="h-sub">No completed orders yet — they appear here after pickup.</div>}
    </div>
  );
}

function EnableAlerts({ userId }: { userId: string | null }) {
  const [perm, setPerm] = useState<NotificationPermission | "unknown">("unknown");
  useEffect(() => { if (typeof Notification !== "undefined") setPerm(Notification.permission); }, []);
  if (perm === "unknown" || perm === "granted") return null;
  return (
    <button
      className="btn2"
      style={{ marginTop: 0, marginBottom: 4 }}
      onClick={async () => {
        const p = await Notification.requestPermission();
        setPerm(p);
        if (p === "granted") subscribePush(userId, true); // background push for the kitchen
      }}
    >
      Turn on order alerts
    </button>
  );
}

// ───────────────────────── back office: overview command center ─────────────────────────
function Overview({ onGo }: { onGo: (t: string) => void }) {
  const [s, setS] = useState({ leads: 0, active: 0, pastDue: 0, waitlist: 0, live: null as EventRow | null });
  const [low, setLow] = useState<InvItem[]>([]);
  const [invEnabled, setInvEnabled] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    const [b, subs, wl, ev, evs, invResp] = await Promise.all([
      supabase.from("booking_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("subscriptions").select("status"),
      supabase.from("subscription_interest").select("id", { count: "exact", head: true }),
      supabase.from("events").select("*").eq("is_live", true).maybeSingle(),
      supabase.from("events").select("*").order("sort"),
      fetchInventory(),
    ]);
    const rows = (subs.data as { status: string }[]) ?? [];
    setS({ leads: b.count ?? 0, active: rows.filter((x) => x.status === "active").length, pastDue: rows.filter((x) => x.status === "past_due").length, waitlist: wl.count ?? 0, live: (ev.data as EventRow) ?? null });
    // roll up low stock across all active (upcoming) events
    const upcoming = ((evs.data as EventRow[]) ?? []).filter((e) => !e.archived_at);
    setInvEnabled(invResp.enabled);
    setLow(rollupLowStock(invResp.items, upcoming));
  }, []);
  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel("admin-overview")
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_requests" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);
  return (
    <div className="adm-sec">
      <div className="sec">At a glance</div>
      <div className="bo-cards">
        <button className={`bo-card${s.leads ? " hot" : ""}`} onClick={() => onGo("bookings")}><b>{s.leads}</b><span>new leads</span></button>
        <button className="bo-card" onClick={() => onGo("money")}><b>{s.active}</b><span>active subs</span></button>
        <button className={`bo-card${s.pastDue ? " alert" : ""}`} onClick={() => onGo("money")}><b>{s.pastDue}</b><span>past due</span></button>
        <button className="bo-card" onClick={() => onGo("money")}><b>{s.waitlist}</b><span>waitlist</span></button>
      </div>
      {s.live ? (
        <div className="bo-live" role="button" tabIndex={0} onClick={() => onGo("events")} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onGo("events")}>
          <span className="adm-pill due">LIVE</span> <b>{s.live.title}</b> — running now · tap for prep
        </div>
      ) : (
        <div className="h-sub" style={{ marginTop: 12 }}>No event live. Set one live under Events when you open.</div>
      )}

      {invEnabled && low.length > 0 && (
        <>
          <div className="wrule"><span>Restock · {low.length} low for upcoming events</span></div>
          <div className="ev-invlist">
            {low.slice(0, 8).map((it, i) => (
              <div key={i} className={`ev-inv-row${(it.qty ?? 0) <= 0 ? " out" : ""}`}>
                <span className="ev-inv-n">{it.qty ?? "—"}</span>
                <span className="ev-inv-x"><b>{it.name}</b><span>reorder at {it.reorderPoint ?? "—"}{it.unit ? ` ${it.unit}` : ""}</span></span>
                {it.reorderLink && <a className="ev-inv-link" href={it.reorderLink} target="_blank" rel="noreferrer">Reorder ›</a>}
              </div>
            ))}
            {low.length > 8 && <div className="pnl-note">+ {low.length - 8} more below reorder point.</div>}
          </div>
        </>
      )}

      {(s.leads > 0 || s.pastDue > 0) && (
        <div className="bo-needs">
          <div className="adm-prep-label">Needs you</div>
          {s.leads > 0 && <button className="bo-need" onClick={() => onGo("bookings")}>{s.leads} new booking {s.leads === 1 ? "request" : "requests"} to reply to ›</button>}
          {s.pastDue > 0 && <button className="bo-need alert" onClick={() => onGo("money")}>{s.pastDue} subscription {s.pastDue === 1 ? "payment" : "payments"} failed — card needs updating ›</button>}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── vendors (relational venue records) ─────────────────────────
function VendorCard({ v, index, open, onToggle, onArchive, onChanged }: {
  v: Vendor; index: number; open: boolean; onToggle: () => void; onArchive: () => void; onChanged: () => void;
}) {
  const { toast } = useApp();
  const [name, setName] = useState(v.name);
  const [address, setAddress] = useState(v.address ?? "");
  const [busy, setBusy] = useState(false);
  const hasCoords = v.lat != null && v.lng != null;
  const patch = async (p: Partial<Vendor>, msg = "Saved") => {
    const { error } = await supabase!.from("vendors").update(p).eq("id", v.id);
    toast(error ? `Error: ${error.message}` : msg);
    if (!error) onChanged();
  };
  const saveName = () => { const nm = name.trim(); if (nm && nm !== v.name) patch({ name: nm }, "Name saved"); };
  const saveLocation = async () => {
    const q = address.trim(); if (!q) return;
    setBusy(true);
    const geo = await geocode(q);
    if (!geo) { setBusy(false); toast("Couldn't find that address — add city & state, then retry."); return; }
    const { error } = await supabase!.from("vendors").update({ address: q, location_text: q, lat: geo.lat, lng: geo.lng }).eq("id", v.id);
    setBusy(false);
    toast(error ? `Error: ${error.message}` : "Location pinned");
    if (!error) onChanged();
  };
  const remove = async () => {
    if (typeof window !== "undefined" && !window.confirm(`Delete ${v.name}? Linked stops/events will unlink.`)) return;
    const { error } = await supabase!.from("vendors").delete().eq("id", v.id);
    toast(error ? `Error: ${error.message}` : "Vendor deleted");
    if (!error) onChanged();
  };
  const sub = [v.poc_name, v.service_dates, hasCoords ? "pinned" : "no pin"].filter(Boolean).join("  ·  ");
  return (
    <div className={`ev-card${open ? " open" : ""}`}>
      <button className="ev-head" onClick={onToggle} aria-expanded={open}>
        <span className="ev-led" />
        <span className="ev-head-main">
          <span className="ev-tag">Vendor {String(index + 1).padStart(2, "0")}</span>
          <span className="ev-title">{v.name || "Untitled vendor"}</span>
          <span className="ev-sub">{sub || "Tap to set up"}</span>
        </span>
        <span className="ev-head-badges"><span className="ev-chev">›</span></span>
      </button>
      {open && (
        <div className="ev-body">
          <div className="ev-group">
            <div className="ev-group-h">Venue</div>
            <input className="ev-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} maxLength={120} placeholder="Vendor / venue name" />
            <div className="stop-addr">
              <input className="ev-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" maxLength={300} />
              <button className="ev-archive" onClick={saveLocation} disabled={busy || !address.trim()}>{busy ? "Finding…" : "Save"}</button>
            </div>
            <div className={`stop-coords${hasCoords ? " ok" : ""}`}>{hasCoords ? `Pinned · ${(v.lat as number).toFixed(4)}, ${(v.lng as number).toFixed(4)}` : "No pin yet"}</div>
          </div>
          <div className="ev-group">
            <div className="ev-group-h">Point of contact</div>
            <input className="ev-input" defaultValue={v.poc_name ?? ""} placeholder="POC name" maxLength={120} onBlur={(e) => { if ((e.target.value.trim() || null) !== (v.poc_name ?? null)) patch({ poc_name: e.target.value.trim() || null }, "Contact saved"); }} />
            <input className="ev-input" type="tel" defaultValue={v.poc_phone ?? ""} placeholder="Phone" maxLength={40} onBlur={(e) => { if ((e.target.value.trim() || null) !== (v.poc_phone ?? null)) patch({ poc_phone: e.target.value.trim() || null }, "Contact saved"); }} />
            <input className="ev-input" type="email" defaultValue={v.poc_email ?? ""} placeholder="Email" maxLength={160} onBlur={(e) => { if ((e.target.value.trim() || null) !== (v.poc_email ?? null)) patch({ poc_email: e.target.value.trim() || null }, "Contact saved"); }} />
          </div>
          <div className="ev-group"><div className="ev-group-h">Dates of service</div><input className="ev-input" defaultValue={v.service_dates ?? ""} placeholder="e.g. Saturdays · May – Aug" maxLength={200} onBlur={(e) => { if ((e.target.value.trim() || null) !== (v.service_dates ?? null)) patch({ service_dates: e.target.value.trim() || null }, "Saved"); }} /></div>
          <div className="ev-group"><div className="ev-group-h">Notes</div><textarea className="ev-input ev-area" rows={2} maxLength={1000} defaultValue={v.notes ?? ""} placeholder="Anything to remember about this vendor" onBlur={(e) => { if (e.target.value !== (v.notes ?? "")) patch({ notes: e.target.value.trim() || null }, "Saved"); }} /></div>
          <div className="ev-card-foot">
            <button className="ev-archive" onClick={onArchive}>Archive</button>
            <button className="ev-delete" onClick={remove}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

function VendorsAdmin() {
  const { toast } = useApp();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showArch, setShowArch] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("vendors").select("*").order("sort");
    if (data) setVendors(data as Vendor[]);
  }, []);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    const { data, error } = await supabase!.from("vendors").insert({ name: "New vendor", sort: vendors.length }).select("id").single();
    toast(error ? `Error: ${error.message}` : "Vendor added");
    if (!error) { if (data) setOpenId((data as { id: string }).id); load(); }
  };
  const archive = async (id: string) => { await supabase!.from("vendors").update({ archived_at: new Date().toISOString() }).eq("id", id); setOpenId(null); load(); };
  const restore = async (id: string) => { await supabase!.from("vendors").update({ archived_at: null }).eq("id", id); load(); };
  const del = async (id: string, nm: string) => { if (typeof window !== "undefined" && !window.confirm(`Delete ${nm}?`)) return; await supabase!.from("vendors").delete().eq("id", id); load(); };
  const active = vendors.filter((v) => !v.archived_at);
  const archived = vendors.filter((v) => v.archived_at);
  return (
    <div className="adm-sec">
      <div className="sec">Vendors <button className="adm-btn" style={{ marginLeft: "auto" }} onClick={add}>+ Add vendor</button></div>
      <div className="pnl-note" style={{ marginBottom: 6 }}>One record per venue/partner — linked from truck stops and events. Edit a POC here and it updates everywhere it&apos;s linked.</div>
      {active.length === 0 && <div className="ev-empty">No vendors yet. Tap <b>+ Add vendor</b> to create one.</div>}
      <div className="ev-list">
        {active.map((v, i) => (
          <VendorCard key={v.id} v={v} index={i} open={openId === v.id} onToggle={() => setOpenId(openId === v.id ? null : v.id)} onArchive={() => archive(v.id)} onChanged={load} />
        ))}
      </div>
      {archived.length > 0 && (
        <div className="ev-archived">
          <button className="ev-arch-head" onClick={() => setShowArch((s) => !s)} aria-expanded={showArch}>Archived vendors · {archived.length}<span className={`ev-chev${showArch ? " open" : ""}`}>›</span></button>
          {showArch && archived.map((v) => (
            <div className="ev-arch-row" key={v.id}><span className="ev-arch-name">{v.name}</span><button className="ev-arch-btn" onClick={() => restore(v.id)}>Restore</button><button className="ev-arch-btn del" onClick={() => del(v.id, v.name)}>Delete</button></div>
          ))}
        </div>
      )}
    </div>
  );
}

// Reusable venue picker — links a stop/event to a vendor and denormalizes the public
// location. Shows the linked vendor's POC live (relational), edit-once-updates-everywhere.
function VendorPicker({ vendors, vendorId, onLink }: { vendors: Vendor[]; vendorId: string | null | undefined; onLink: (v: Vendor | null) => void }) {
  const linked = vendors.find((v) => v.id === vendorId) || null;
  return (
    <div className="ev-group">
      <div className="ev-group-h">Venue · vendor</div>
      <select className="ev-input" value={vendorId ?? ""} onChange={(e) => onLink(vendors.find((v) => v.id === e.target.value) || null)}>
        <option value="">— not linked —</option>
        {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      {linked && (linked.poc_name || linked.poc_phone || linked.poc_email || linked.service_dates) && (
        <div className="vlink">
          {linked.poc_name && <div className="vlink-row"><span>POC</span><b>{linked.poc_name}</b></div>}
          {linked.poc_phone && <div className="vlink-row"><span>Phone</span><a href={`tel:${linked.poc_phone}`}>{linked.poc_phone}</a></div>}
          {linked.poc_email && <div className="vlink-row"><span>Email</span><a href={`mailto:${linked.poc_email}`}>{linked.poc_email}</a></div>}
          {linked.service_dates && <div className="vlink-row"><span>Service</span><b>{linked.service_dates}</b></div>}
          <div className="vlink-note">Managed in Vendors — edits there update everywhere.</div>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const { ready, enabled, user, profile } = useAuth();
  const { section, setSection } = useOperatorSection();

  if (!enabled) return <section className="screen"><div className="h-title">Admin</div><div className="h-sub">The live backend isn&apos;t configured here.</div></section>;
  if (!ready) return <section className="screen" />;
  if (!user) return <SignIn />;

  // Raw role read — roleOf() collapses the expanded set; profiles.role carries
  // member/server/operator/event_manager/contractor/admin/owner (0031).
  const role = (profile?.role as string | undefined) ?? (profile?.is_admin ? "owner" : "member");
  if (role === "member") {
    return (
      <section className="screen">
        <div className="toprow"><div className="eyb">Admin</div><Link className="pf" href="/">‹</Link></div>
        <div className="h-title">Staff only.</div>
        <div className="h-sub">This area is for GT3PB staff. If that&apos;s you, ask the owner to add you.</div>
      </section>
    );
  }

  const isOwner = role === "owner";
  const isAdmin = role === "admin" || isOwner;
  const canManage = isAdmin || role === "event_manager";
  const canPrep = canManage || role === "operator" || role === "contractor";

  // The operator nav owns the section; clamp to what this role may see.
  const allowed = sectionsForRole(role);
  const sec: OpSection = allowed.includes(section) ? section : "now";
  const LABEL: Record<OpSection, string> = { now: "Now", prep: "Prep", plan: "Plan", money: "Money", team: "Team" };
  const SUB: Record<OpSection, string> = {
    now: "The live shift — sales, dispatch & the order pass.",
    prep: "Stock, readiness & the pack list for what's next.",
    plan: "Events, vendors & bookings.",
    money: "Pricing, subscriptions & order history.",
    team: "People, roles & training.",
  };

  // Overview's jump links map onto the operator sections.
  const goSection = (t: string) => {
    const map: Record<string, OpSection> = { events: "plan", vendors: "plan", bookings: "plan", money: "money", members: "team" };
    setSection(map[t] ?? "prep");
  };

  return (
    <section className="screen admin">
      <div className="toprow">
        <div className="eyb">GT3PB · Crew</div>
        <Link className="pf" href="/3mpire" aria-label="Exit Crew Mode">‹</Link>
      </div>
      <div className="op-head">
        <div className="op-head-t">{LABEL[sec]}</div>
        <div className="op-head-s">{SUB[sec]}</div>
      </div>

      {sec === "now" && (
        <>
          <MyTasks userId={user?.id ?? null} />
          {canManage && <EventHUD />}
          {canManage && <LiveControl />}
          <EnableAlerts userId={user?.id ?? null} />
          <Kitchen />
        </>
      )}

      {sec === "prep" && canPrep && <EventPrep onGo={goSection} />}

      {sec === "plan" && canManage && (
        <>
          <EventsAdmin />
          <VendorsAdmin />
          <Bookings />
          <ReservesAdmin />
        </>
      )}

      {sec === "money" && isAdmin && (
        <>
          <ProductCatalog />
          <Subscribers />
          <SubInterest />
          <OrdersHistory />
        </>
      )}

      {sec === "team" && isAdmin && (
        <>
          <Link href="/academy" className="opx-link">
            <span className="opx-link-t">GT3 Academy</span>
            <span className="opx-link-s">Training, certifications &amp; the cookbook →</span>
          </Link>
          {isOwner && <Members />}
        </>
      )}
    </section>
  );
}
