"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth, roleOf, type Profile } from "@/components/AuthProvider";
import { useOperatorSection, sectionsForRole, type OpSection } from "@/components/OperatorNav";
import TrailerLoadout from "@/components/TrailerLoadout";
import GearLibrary from "@/components/GearLibrary";
import InventoryLibrary from "@/components/InventoryLibrary";
import Reports from "@/components/Reports";
import SnapshotReport from "@/components/SnapshotReport";
import EventPnlReport from "@/components/EventPnlReport";
import SignIn from "@/components/SignIn";
import InputSheet from "@/components/InputSheet";
import { supabase } from "@/lib/supabase";
import AskGT3 from "@/components/AskGT3";
import Studio from "@/components/Studio";
import MenuManager from "@/components/MenuManager";
import PlanEditor from "@/components/PlanEditor";
import CompanyCalendar from "@/components/CompanyCalendar";
import EventDayPlanner from "@/components/EventDayPlanner";
import EventGenerator from "@/components/EventGenerator";
import Markdown from "@/components/Markdown";
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
import { fetchAssets, type AssetsResp } from "@/lib/assets";
import type { Stop, LiveStatus, EventRow, EventTask, BookingRequest, Order, Reserve, Subscription, Vendor, MeetingNote, Alert, Comment } from "@/lib/db";

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

// ───────────────────────── alerts: the "don't-miss" spine ─────────────────────────
// Leadership = the tier that gets (and raises) can't-miss alerts. Matches the alerts RLS.
const LEADERSHIP = ["event_manager", "admin", "owner"];
const isLeader = (role: string | null | undefined) => LEADERSHIP.includes(role ?? "");

// Raise an alert: write the row (drives the in-app inbox via realtime) AND fire the dispatcher
// Edge Function (Teams + web push), best-effort. Producers across the console call this.
async function raiseAlert(a: {
  severity?: "critical" | "important" | "fyi"; category?: string; title: string;
  body?: string; link?: string; target_user_id?: string | null; created_by?: string | null;
}) {
  if (!supabase) return;
  const { data } = await supabase.from("alerts").insert({
    severity: a.severity ?? "important", category: a.category ?? null, title: a.title,
    body: a.body ?? null, link: a.link ?? "/admin", target_user_id: a.target_user_id ?? null,
    created_by: a.created_by ?? null,
  }).select("*").single();
  if (!data) return;
  supabase.functions.invoke("push", { body: { table: "alerts", type: "INSERT", record: data } }).catch(() => {});
}

// How many comments hang off each subject — drives the count badge on a 💬 toggle so activity is
// visible at a glance without opening every thread (organization/management at scale).
async function commentCounts(col: "event_task_id" | "meeting_note_id" | "alert_id", ids: string[]): Promise<Record<string, number>> {
  if (!supabase || ids.length === 0) return {};
  const { data } = await supabase.from("comments").select(col).in(col, ids);
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as Record<string, string | null>[]) { const k = r[col]; if (k) out[k] = (out[k] ?? 0) + 1; }
  return out;
}

// The "don't-miss" inbox — unacknowledged alerts for me (or all-leadership), critical first.
// Realtime, so a new alert lands at the top of the Now screen the instant it's raised.
function AlertsInbox({ userId }: { userId: string | null }) {
  const { profile } = useAuth();
  const meName = profile?.display_name?.trim() || "Me";
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("alerts").select("*").is("ack_at", null).order("created_at", { ascending: false }).limit(50);
    const rows = (data as Alert[]) ?? [];
    setAlerts(rows);
    setCounts(await commentCounts("alert_id", rows.map((r) => r.id)));
  }, []);
  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel("admin-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  const ack = async (a: Alert) => {
    if (!supabase) return;
    setAlerts((p) => p.filter((x) => x.id !== a.id)); // optimistic
    await supabase.from("alerts").update({ ack_at: new Date().toISOString(), ack_by: userId }).eq("id", a.id);
  };

  // Show alerts addressed to me or to all-leadership (target null). RLS already scopes to leadership.
  const mine = alerts.filter((a) => a.target_user_id == null || a.target_user_id === userId);
  if (mine.length === 0) return null;
  const rank = (s: string) => (s === "critical" ? 0 : s === "important" ? 1 : 2);
  const sorted = [...mine].sort((a, b) => rank(a.severity) - rank(b.severity));
  const crit = mine.filter((a) => a.severity === "critical").length;

  return (
    <div className="adm-sec">
      <div className="sec">Alerts <span className={`adm-pill${crit ? " due" : ""}`}>{mine.length}{crit ? ` · ${crit} critical` : ""}</span></div>
      {sorted.map((a) => (
        <div key={a.id} className={`alert sev-${a.severity}`}>
          <div className="alert-row">
            <div className="alert-main">
              <span className="alert-title">{a.title}</span>
              {a.body && <span className="alert-body">{a.body}</span>}
            </div>
            <button type="button" className="alert-discuss" onClick={() => setOpenThread(openThread === a.id ? null : a.id)} aria-label="Discuss">💬{counts[a.id] ? <span className="cmt-count">{counts[a.id]}</span> : null}</button>
            <button type="button" className="alert-ack" onClick={() => ack(a)}>Got it</button>
          </div>
          {openThread === a.id && (
            <CommentThread subject={{ col: "alert_id", id: a.id }} notifyIds={[a.target_user_id, a.created_by]} label={a.title} meId={userId} meName={meName} />
          )}
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── discussion threads (two-way collaboration) ─────────────────────────
// One reusable thread, keyed to any subject (a task, a meeting note, or an alert). A new reply
// notifies the counterparties + anyone @mentioned through the alert spine (push + inbox + Teams),
// so the back-and-forth lives in the app instead of Teams/text.
function CommentThread({ subject, notifyIds, label, meId, meName }: {
  subject: { col: "event_task_id" | "meeting_note_id" | "alert_id"; id: string };
  notifyIds: (string | null)[];
  label: string;
  meId: string | null;
  meName: string;
}) {
  const { toast } = useApp();
  const [comments, setComments] = useState<Comment[]>([]);
  const [staff, setStaff] = useState<{ id: string; display_name: string | null }[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("comments").select("*").eq(subject.col, subject.id).order("created_at");
    setComments((data as Comment[]) ?? []);
  }, [subject.col, subject.id]);
  useEffect(() => {
    load();
    if (!supabase) return;
    supabase.from("profiles").select("id, display_name").neq("role", "member").then(({ data }) => setStaff((data as { id: string; display_name: string | null }[]) ?? []));
    const ch = supabase.channel(`comments-${subject.col}-${subject.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "comments", filter: `${subject.col}=eq.${subject.id}` }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load, subject.col, subject.id]);

  const nameOf = (uid: string | null) => (uid && uid === meId ? "You" : (staff.find((s) => s.id === uid)?.display_name?.trim() || "Crew"));
  const firstOf = (uid: string | null) => nameOf(uid).split(" ")[0];

  const send = async () => {
    if (!supabase || !text.trim() || sending) return;
    setSending(true);
    const sent = text.trim();
    // @firstname → user id (case-insensitive). Lightweight; good enough for a small crew.
    const lower = sent.toLowerCase();
    const mentionIds = staff.filter((s) => { const fn = (s.display_name || "").trim().split(" ")[0].toLowerCase(); return fn.length > 1 && lower.includes("@" + fn); }).map((s) => s.id);
    const { error } = await supabase.from("comments").insert({ [subject.col]: subject.id, body: sent, author_id: meId, mentions: mentionIds });
    setSending(false);
    if (error) { toast(`Error: ${error.message}`, "error"); return; }
    setText("");
    load();
    // Ping the counterparties + mentions (never myself) so the reply doesn't go unseen.
    const recips = Array.from(new Set([...notifyIds, ...mentionIds])).filter((id): id is string => !!id && id !== meId);
    const meFirst = meName.split(" ")[0] || "Someone";
    recips.forEach((rid) => raiseAlert({
      severity: "important", category: "comment",
      title: `${meFirst} replied`, body: `${label}: ${sent.slice(0, 140)}`,
      target_user_id: rid, created_by: meId,
    }));
  };
  const del = async (c: Comment) => {
    if (!supabase) return;
    setComments((p) => p.filter((x) => x.id !== c.id)); // optimistic; RLS allows author-only delete
    await supabase.from("comments").delete().eq("id", c.id);
  };

  return (
    <div className="cmt">
      {comments.map((c) => (
        <div key={c.id} className={`cmt-row${c.author_id === meId ? " me" : ""}`}>
          <span className="cmt-av">{(nameOf(c.author_id).charAt(0) || "?").toUpperCase()}</span>
          <div className="cmt-bub">
            <span className="cmt-meta">{firstOf(c.author_id)} · {new Date(c.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              {c.author_id === meId && <button type="button" className="cmt-del" onClick={() => del(c)} aria-label="Delete comment">×</button>}
            </span>
            <span className="cmt-body">{c.body}</span>
          </div>
        </div>
      ))}
      <div className="cmt-add">
        <input className="note-in" placeholder="Reply… (@name to notify)" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
        <button type="button" className="note-fu-addbtn" onClick={send} disabled={!text.trim() || sending}>Send</button>
      </div>
    </div>
  );
}

// ───────────────────────── pre-flight readiness ─────────────────────────
// ───────────────────────── my tasks: what's assigned to me, by priority ─────────────────────────
type MyTaskRow = EventTask & {
  events: { title: string | null; day: string | null; is_live: boolean | null } | null;
  meeting_notes: { title: string | null } | null;
};

// MY DAY — the personal rollup: what's on today, the flags & pings aimed at YOU (alerts targeted
// to your user), and your assigned tasks. The home base "where do my flags go?" answer.
function MyDay({ userId, meName, isLeader }: { userId: string | null; meName: string; isLeader: boolean }) {
  const [flags, setFlags] = useState<{ id: string; severity: string; title: string; body: string | null }[]>([]);
  const [today, setToday] = useState<{ id: string; title: string | null; day_label: string | null; is_live: boolean | null }[]>([]);

  const loadFlags = useCallback(async () => {
    if (!supabase || !userId || !isLeader) { setFlags([]); return; }
    const { data } = await supabase.from("alerts").select("id, severity, title, body").eq("target_user_id", userId).is("ack_at", null).order("created_at", { ascending: false }).limit(20);
    setFlags((data as typeof flags) ?? []);
  }, [userId, isLeader]);

  useEffect(() => {
    loadFlags();
    if (!supabase || !userId) return;
    const ch = supabase.channel("my-day-flags").on("postgres_changes", { event: "*", schema: "public", table: "alerts", filter: `target_user_id=eq.${userId}` }, () => loadFlags()).subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [loadFlags, userId]);
  useEffect(() => {
    if (!supabase) return;
    const d = new Date().toISOString().slice(0, 10);
    supabase.from("events").select("id, title, day_label, is_live").eq("day", d).is("archived_at", null).then(({ data }) => setToday(data ?? []));
  }, []);

  const ack = async (id: string) => { setFlags((f) => f.filter((x) => x.id !== id)); await supabase?.from("alerts").update({ ack_at: new Date().toISOString(), ack_by: userId }).eq("id", id); };
  const hr = new Date().getHours();
  const greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const first = meName.split(" ")[0];

  return (
    <>
      <div className="myday-hero">
        <div className="myday-greet">{greet}{first && first !== "Me" ? `, ${first}` : ""}</div>
        <div className="myday-date">{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</div>
      </div>
      {today.length > 0 && (
        <div className="myday-today">
          {today.map((e) => <div key={e.id} className="myday-ev">{e.is_live && <span className="myday-live">LIVE</span>}<span>📍 {e.title || e.day_label || "Event"}</span></div>)}
        </div>
      )}
      {isLeader && (
        <>
          <div className="sec">Flags &amp; pings for you{flags.length ? ` · ${flags.length}` : ""}</div>
          {flags.length === 0 ? (
            <div className="myday-clear">✓ Nothing needs you right now.</div>
          ) : flags.map((f) => (
            <div key={f.id} className={`myday-flag sev-${f.severity}`}>
              <div className="myday-flag-b">
                <div className="myday-flag-t">{f.title}</div>
                {f.body && <div className="myday-flag-x">{f.body}</div>}
              </div>
              <button type="button" className="myday-ack" onClick={() => ack(f.id)}>Got it</button>
            </div>
          ))}
        </>
      )}
      <div className="sec">My tasks</div>
      <MyTasks userId={userId} />
    </>
  );
}

function MyTasks({ userId }: { userId: string | null }) {
  const [tasks, setTasks] = useState<MyTaskRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !userId) { setTasks([]); setLoaded(true); return; }
    const { data } = await supabase
      .from("event_tasks")
      .select("*, events(title, day, is_live), meeting_notes(title)")
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
            <span className="mytask-ev">{t.meeting_notes ? `Follow-up · ${t.meeting_notes.title ?? "Meeting"}` : `${t.events?.title ?? "Event"}${t.events?.is_live ? " · LIVE" : t.events?.day ? ` · ${whenBucket(t.events.day).label}` : ""}`}</span>
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

type PrepTarget = { kind: "event" | "stop"; id: string };

function PrepCard({ title, when, location, live, r, onOpen }: { title: string; when: string; location: string | null; live: boolean; r: Readiness; onOpen: () => void }) {
  const status = r.total === 0 ? "Not started" : r.done === r.total ? "Ready to roll" : `Loaded ${r.done}/${r.total}`;
  const cls = r.total === 0 ? "none" : r.done === r.total ? "ok" : r.crit ? "miss" : "mid";
  const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
  return (
    <button className={`prep-card${live ? " live" : ""}`} onClick={onOpen} aria-label={`Prep ${title} — ${status}`}>
      <div className="prep-card-top">
        <span className="prep-card-when">{when || "—"}</span>
        {live && <span className="prep-card-livetag">● Live</span>}
      </div>
      <div className="prep-card-title">{title}</div>
      {location && <div className="prep-card-loc">{location}</div>}
      <div className="prep-card-foot">
        <span className={`prep-card-status ${cls}`}>{status}</span>
        {r.crit > 0 && <span className="prep-card-crit">{r.crit} critical</span>}
        <span className="prep-card-go">Prep ›</span>
      </div>
      {r.total > 0 && <div className="prep-card-bar"><span style={{ width: `${pct}%` }} /></div>}
    </button>
  );
}

// The picker: truck locations + events, each with its own independent pick list (0040).
// Tapping a card opens that target's checklist (PrepDetail).
// AGENT #2 — prep/readiness. On-demand: asks Claude if stock covers the next two weeks of events,
// shows the verdict, and (when there's a real gap) raises it on the alert spine.
function ReadinessAgent() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ headline: string; severity: string; gaps: { item: string; detail: string }[] } | null>(null);
  const run = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/agents/readiness", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: "{}" });
      const j = await r.json();
      if (!j.ok) toast(String(j.error ?? "").includes("ANTHROPIC") ? "AI isn't switched on yet — add the API key" : `Error: ${j.error ?? r.status}`, "error");
      else if (j.skipped) { setRes(null); toast("No upcoming events to check"); }
      else setRes({ headline: j.headline, severity: j.severity, gaps: j.gaps ?? [] });
    } catch { toast("Couldn't reach the readiness agent", "error"); }
    setBusy(false);
  };
  return (
    <div className="adm-sec">
      <div className="sec">Readiness</div>
      <div className="rdy">
        <div className="rdy-top">
          <span className="rdy-blurb">Ask the prep agent if you&apos;re stocked for the next two weeks.</span>
          <button type="button" className="rdy-run" onClick={run} disabled={busy}>{busy ? "Checking…" : "✨ Check"}</button>
        </div>
        {res && (
          <div className={`rdy-out sev-${res.severity}`}>
            <span className="rdy-head">{res.headline}</span>
            {res.gaps.length > 0 && <ul className="rdy-gaps">{res.gaps.map((g, i) => <li key={i}><b>{g.item}</b> — {g.detail}</li>)}</ul>}
          </div>
        )}
      </div>
    </div>
  );
}

// OPERATOR MODE — the crew's pocket brain. The chat itself lives in components/AskGT3 so the
// Ask tab and the floating QuickDock share ONE assistant.
function OperatorAssistant() {
  return <div className="adm-sec"><AskGT3 /></div>;
}

// INSPECTION AGENT (admin) — research a jurisdiction's permit/inspection requirements, get a
// what-to-expect brief + prep checklist, and review agent-proposed compliance rows before they
// go live. "We have an inspection in GA tomorrow" → grounded answer + a do-list on the event.
type InspRule = { id: string; label: string; kind: string; critical: boolean; link: string | null };
type InspResult = { place: string; researched: boolean; summary: string; checklist: string[]; confidence: string; proposed: InspRule[]; tasksAdded: number };

function InspectionPrep() {
  const { toast } = useApp();
  const [state, setState] = useState("");
  const [county, setCounty] = useState("");
  const [events, setEvents] = useState<{ id: string; title: string | null; day: string | null; day_label: string | null }[]>([]);
  const [eventId, setEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<InspResult | null>(null);
  const [wait, setWait] = useState<string | null>(null); // background-research banner ("Researching…" / "Writing up…")
  const [open, setOpen] = useState(false); // collapsed until needed — keeps the Prep screen clean
  const aliveRef = useRef(true); // stop polling if the screen unmounts mid-research
  useEffect(() => () => { aliveRef.current = false; }, []);

  useEffect(() => {
    if (!open || !supabase) return;
    const today = new Date().toISOString().slice(0, 10);
    supabase.from("events").select("id, title, day, day_label").is("archived_at", null).gte("day", today).order("day").limit(40)
      .then(({ data }) => setEvents(data ?? []));
  }, [open]);

  // Uncovered jurisdictions research in the background (the route returns a job id and runs the lean
  // research after the response is flushed). Poll the job row — staff RLS allows the read — keeping the
  // waiting banner up until it finishes or the deadline (~3 min).
  const waitForJob = async (jobId: string): Promise<{ status: string; result: InspResult | null; error: string | null; place: string } | null> => {
    if (!supabase) return null;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && aliveRef.current) {
      await new Promise((r) => setTimeout(r, 3000));
      if (!aliveRef.current) return null;
      const { data } = await supabase.from("inspection_research_jobs").select("status, result, error, place").eq("id", jobId).maybeSingle();
      if (!data) continue;
      if (data.status === "done" || data.status === "error") return data as { status: string; result: InspResult | null; error: string | null; place: string };
      setWait("Researching the jurisdiction…");
    }
    return null;
  };

  const run = async () => {
    if (!supabase || busy || !state.trim()) return;
    setBusy(true); setRes(null); setWait(null);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/agents/inspection", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ state, county, event_id: eventId }) });
      const j = await r.json();
      if (!j.ok) { toast(String(j.error ?? "").includes("ANTHROPIC") ? "AI isn't switched on yet — add the API key" : `Error: ${j.error ?? r.status}`, "error"); setBusy(false); return; }
      if (j.status === "pending" && j.job_id) {
        setWait("Researching the jurisdiction…");
        const done = await waitForJob(j.job_id);
        setWait(null);
        if (!aliveRef.current) return;
        if (!done) { toast(`Research for ${j.place} took too long — try again, or add a county to narrow it`, "error"); setBusy(false); return; }
        if (done.status === "error" || !done.result) { toast(`Couldn't finish researching ${j.place} — try again, or add a county to narrow it`, "error"); setBusy(false); return; }
        const out = { ...done.result, place: done.place };
        setRes(out);
        toast(`Researched ${out.place}${out.proposed?.length ? ` — ${out.proposed.length} rules to review` : ""}`);
      } else {
        setRes(j);
        toast(j.researched ? `Researched ${j.place}${j.proposed.length ? ` — ${j.proposed.length} rules to review` : ""}` : `Brief ready for ${j.place}`);
      }
    } catch { toast("Couldn't reach the inspection agent", "error"); setWait(null); }
    setBusy(false);
  };

  const decide = async (id: string, approve: boolean) => {
    if (!supabase) return;
    if (approve) await supabase.from("compliance_rules").update({ active: true, verified: true }).eq("id", id);
    else await supabase.from("compliance_rules").delete().eq("id", id);
    setRes((r) => r ? { ...r, proposed: r.proposed.filter((p) => p.id !== id) } : r);
    toast(approve ? "Approved — now in the official checklist" : "Dismissed");
  };

  return (
    <div className="adm-sec">
      <button type="button" className="prep-collapse" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="prep-collapse-l"><b>Inspection prep</b><span>Permit / health-dept research — open it when one is coming up</span></span>
        <span className={`ev-chev${open ? " open" : ""}`}>›</span>
      </button>
      {open && (
      <div className="rdy" style={{ marginTop: 10 }}>
        <div className="insp-form">
          <input className="insp-in insp-st" value={state} onChange={(e) => setState(e.target.value)} placeholder="State (GA)" maxLength={4} />
          <input className="insp-in" value={county} onChange={(e) => setCounty(e.target.value)} placeholder="County (optional)" />
          <select className="insp-in" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">No event — just brief me</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.day_label || ev.day || ""} · {ev.title || "Event"}</option>)}
          </select>
          <button type="button" className="rdy-run" onClick={run} disabled={busy || !state.trim()}>{busy ? "Researching…" : "✨ Research"}</button>
        </div>
        {wait && (
          <div className="insp-wait" role="status" aria-live="polite">
            <span className="insp-wait-dot" /><span>{wait}</span><span className="insp-wait-sub">this can take a minute or two — you can keep working</span>
          </div>
        )}
        {res && (
          <div className="insp-out">
            <div className="insp-head">{res.place}{res.researched ? "" : " · from your records"}{res.confidence === "low" ? " · low confidence — verify with the county" : ""}</div>
            <p className="insp-sum">{res.summary}</p>
            {res.checklist.length > 0 && (
              <><div className="insp-lbl">Prep checklist{res.tasksAdded ? ` · added ${res.tasksAdded} to the event` : ""}</div>
              <ul className="rdy-gaps">{res.checklist.map((c, i) => <li key={i}>{c}</li>)}</ul></>
            )}
            {res.proposed.length > 0 && (
              <><div className="insp-lbl">Proposed rules — approve to make official</div>
              {res.proposed.map((p) => (
                <div key={p.id} className="insp-rule">
                  <span className="insp-rule-t">{p.critical ? "⚠️ " : ""}<b>{p.kind}</b> — {p.label}{p.link ? <a href={p.link} target="_blank" rel="noreferrer" className="insp-src"> source</a> : null}</span>
                  <span className="insp-rule-act">
                    <button type="button" className="insp-yes" onClick={() => decide(p.id, true)}>Approve</button>
                    <button type="button" className="insp-no" onClick={() => decide(p.id, false)}>Dismiss</button>
                  </span>
                </div>
              ))}</>
            )}
            <p className="insp-foot">Always confirm with the jurisdiction's health department for your specific date.</p>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function EventPrep({ onGo }: { onGo: (t: string) => void }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [liveStopId, setLiveStopId] = useState<string | null>(null);
  const [ready, setReady] = useState<Record<string, Readiness>>({});
  const [selected, setSelected] = useState<PrepTarget | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [sheet, setSheet] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: evs }, { data: sts }, { data: ls }, { data: t }] = await Promise.all([
      supabase.from("events").select("*").order("sort"),
      supabase.from("stops").select("*").order("sort"),
      supabase.from("live_status").select("current_stop_id, is_live").maybeSingle(),
      supabase.from("event_tasks").select("event_id, stop_id, done, critical"),
    ]);
    const evList = ((evs as EventRow[]) ?? []).filter((e) => !e.archived_at);
    setEvents(evList);
    setStops(((sts as Stop[]) ?? []).filter((s) => !s.archived_at));
    const lstat = ls as { current_stop_id: string | null; is_live: boolean } | null;
    setLiveStopId(lstat?.is_live ? lstat.current_stop_id : null);
    const map: Record<string, Readiness> = {};
    for (const row of (t as { event_id: string | null; stop_id: string | null; done: boolean; critical: boolean }[]) ?? []) {
      const key = row.event_id ?? row.stop_id;
      if (!key) continue;
      const m = (map[key] ??= { done: 0, total: 0, crit: 0 });
      m.total++;
      if (row.done) m.done++;
      else if (row.critical) m.crit++;
    }
    setReady(map);
    setSelected((prev) => prev ?? (evList.find((e) => e.is_live) ? { kind: "event", id: evList.find((e) => e.is_live)!.id } : null));
    setLoaded(true);
  }, []);
  useEffect(() => {
    load();
    // Deep-link from an event editor's "Open prep".
    try {
      const tgt = localStorage.getItem("gt3-prep-open");
      if (tgt) { localStorage.removeItem("gt3-prep-open"); setSelected({ kind: "event", id: tgt }); }
    } catch { /* ignore */ }
    if (!supabase) return;
    const ch = supabase.channel("admin-prep-index")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "stops" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "event_tasks" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  if (selected) return <PrepDetail target={selected} onBack={() => setSelected(null)} />;

  // events grouped by date/when; dir flips order
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
    {/* Overview + loadout show on the list only — opening a target gives prep the full screen. */}
    <Overview onGo={onGo} />
    <div className="adm-sec adm-prep">
      <div className="sec">Prep
        <button className="adm-prep-view" onClick={() => setSheet(true)} aria-haspopup="dialog">View ⌄</button>
      </div>
      {!loaded && <div className="h-sub">Loading…</div>}
      {loaded && events.length === 0 && stops.length === 0 && <div className="h-sub">Nothing to prep yet — add an event (Plan → Events) or a truck location (Now → Live truck).</div>}

      {stops.length > 0 && (
        <div className="prep-group">
          <div className="prep-group-h">Truck locations <span>{stops.length}</span></div>
          <div className="prep-cards">
            {stops.map((s) => (
              <PrepCard key={s.id} title={s.name} when={s.id === liveStopId ? "Live now" : (s.when_label ?? "Stop")} location={s.location_text} live={s.id === liveStopId}
                r={ready[s.id] ?? { done: 0, total: 0, crit: 0 }} onOpen={() => setSelected({ kind: "stop", id: s.id })} />
            ))}
          </div>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.label} className="prep-group">
          <div className="prep-group-h">{g.label} <span>{g.items.length}</span></div>
          <div className="prep-cards">
            {g.items.map((ev) => (
              <PrepCard key={ev.id} title={ev.title} when={[ev.day_label, ev.start_time].filter(Boolean).join(" · ")} location={ev.location_text} live={!!ev.is_live}
                r={ready[ev.id] ?? { done: 0, total: 0, crit: 0 }} onOpen={() => setSelected({ kind: "event", id: ev.id })} />
            ))}
          </div>
        </div>
      ))}
      {sheet && <PrepViewSheet dir={dir} setDir={setDir} onClose={() => setSheet(false)} />}
    </div>
    <TrailerLoadout />
    <GearLibrary />
    <InventoryLibrary />
    </>
  );
}

// Detail: a per-target pick list. For an EVENT it's the full thing (auto-generate from
// rig/menu, crew roster, owner+manager sign-off). For a TRUCK STOP it's the same checklist
// engine (assign, supply/gear picker, My Tasks) minus the event-only bits. Owner = event_id
// XOR stop_id (migration 0040).
function PrepDetail({ target, onBack }: { target: { kind: "event" | "stop"; id: string }; onBack: () => void }) {
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const isAdmin = roleOf(profile) === "admin" || roleOf(profile) === "owner";
  const isEvent = target.kind === "event";
  const ownerCol = isEvent ? "event_id" : "stop_id";
  const [ev, setEv] = useState<EventRow | null>(null); // full event row (events only; drives generate)
  const [name, setName] = useState<string | null>(null); // display name for either kind
  const [loadedOk, setLoadedOk] = useState(false);
  const [tasks, setTasks] = useState<EventTask[]>([]);
  const [crew, setCrew] = useState<{ id: string; user_id: string; role_label: string | null }[]>([]);
  const [staff, setStaff] = useState<{ id: string; display_name: string | null; role?: string | null }[]>([]);
  const [approvals, setApprovals] = useState<{ approver_id: string }[]>([]);
  const [newTask, setNewTask] = useState("");
  const [generating, setGenerating] = useState(false);
  const [assignFor, setAssignFor] = useState<EventTask | null>(null);
  const [showSupplies, setShowSupplies] = useState(false);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    if (!supabase) return;
    // Resolve the target's display name (+ the full event row for events).
    if (isEvent) {
      const { data: e } = await supabase.from("events").select("*").eq("id", target.id).maybeSingle();
      setEv((e as EventRow) ?? null);
      setName((e as EventRow)?.title ?? null);
    } else {
      const { data: s } = await supabase.from("stops").select("name").eq("id", target.id).maybeSingle();
      setEv(null);
      setName((s as { name: string } | null)?.name ?? null);
    }
    setLoadedOk(true);
    const { data: t } = await supabase.from("event_tasks").select("*").eq(ownerCol, target.id).order("sort");
    const seen = new Set<string>();
    const deduped = ((t as EventTask[]) ?? []).filter((x) => { const k = `${x.section ?? ""}|${x.label}`; if (seen.has(k)) return false; seen.add(k); return true; });
    setTasks(deduped);
    commentCounts("event_task_id", deduped.map((x) => x.id)).then(setCounts);
    // Crew + sign-off are event-only.
    if (isEvent) {
      const [{ data: c }, { data: ap }] = await Promise.all([
        supabase.from("event_staff").select("id, user_id, role_label").eq("event_id", target.id),
        supabase.from("event_approvals").select("*").eq("event_id", target.id),
      ]);
      setCrew((c as { id: string; user_id: string; role_label: string | null }[]) ?? []);
      setApprovals((ap as { approver_id: string }[]) ?? []);
    } else { setCrew([]); setApprovals([]); }
    if (isAdmin) {
      const { data: p } = await supabase.from("profiles").select("id, display_name, role").neq("role", "member");
      setStaff((p as { id: string; display_name: string | null; role?: string | null }[]) ?? []);
    }
  }, [target.id, isEvent, ownerCol, isAdmin]);
  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel("admin-prepdetail")
      .on("postgres_changes", { event: "*", schema: "public", table: "event_tasks" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "event_staff" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "event_approvals" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, () => load())
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
      // Can't-miss: a leader assigning another leader → raise a critical alert (Teams + inbox).
      const assigneeRole = staff.find((s) => s.id === next)?.role ?? null;
      if (next !== user?.id && isLeader(roleOf(profile)) && isLeader(assigneeRole)) {
        raiseAlert({
          severity: "critical", category: "assignment",
          title: `${profile?.display_name?.split(" ")[0] || "A manager"} assigned you: ${t.label}`,
          body: name ? `On ${isEvent ? "event" : "location"} · ${name}` : undefined,
          target_user_id: next, created_by: user?.id ?? null,
        });
      }
    }
  };
  const addTask = async () => {
    if (!supabase || !newTask.trim()) return;
    const { error } = await supabase.from("event_tasks").insert({ [ownerCol]: target.id, label: newTask.trim(), kind: "task", section: "Task", sort: tasks.length });
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
    if (!supabase || items.length === 0) return;
    const have = new Set(tasks.map((t) => t.label.trim().toLowerCase()));
    const rows = items
      .filter((i) => !have.has(i.label.trim().toLowerCase()))
      .map((i, idx) => ({ [ownerCol]: target.id, label: i.label.trim(), section: "Supplies", kind: "pack", critical: i.critical, sort: 40 + idx }));
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

  if (loadedOk && name === null) return (
    <div className="adm-sec adm-prep">
      <button className="adm-prep-back" onClick={onBack}>‹ All prep</button>
      <div className="h-sub">{isEvent ? "Event" : "Location"} not found — it may have been removed.</div>
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
      <button className="adm-prep-back" onClick={onBack}>‹ All prep</button>
      <div className="sec">{name ?? "…"} · prep{isEvent && ev?.is_live && <span className="adm-pill due">LIVE</span>}{!isEvent && <span className="adm-pill">Location</span>}</div>
      {total > 0 ? (
        <>
          <div className={`adm-ready-bar${ready ? " ok" : critOut.length ? " miss" : ""}`}>
            <b>Loaded {doneN}/{total}</b>
            {critOut.length > 0 && <span className="adm-ready-miss"> · {critOut.length} critical to load: {critOut.slice(0, 2).map((t) => t.label).join(", ")}{critOut.length > 2 ? ` +${critOut.length - 2}` : ""}</span>}
            {ready && <span> · ready to roll</span>}
          </div>
          {isAdmin && (
            <div className="adm-prep-actions">
              {isEvent && <button className="adm-regen" onClick={() => generate(true)} disabled={generating}>↻ Regenerate from menu</button>}
              <button className="adm-regen" onClick={() => setShowSupplies(true)}>+ Add supplies</button>
            </div>
          )}
        </>
      ) : isAdmin ? (
        isEvent
          ? <button className="adm-btn primary" onClick={() => generate()} disabled={generating}>{generating ? "Generating…" : "Generate pack list from menu"}</button>
          : <button className="adm-btn primary" onClick={() => setShowSupplies(true)}>+ Build this location&apos;s list</button>
      ) : <div className="h-sub">No pick list yet.</div>}

      {isEvent && isAdmin && (
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

      {isEvent && total > 0 && (
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
            <div key={t.id} className="adm-task-wrap">
              <div className={`adm-task${t.done ? " done" : ""}${t.critical ? " crit" : t.warn ? " warn" : ""}`}>
                <button type="button" className="task-check" aria-pressed={t.done} onClick={() => toggle(t)} aria-label={`${t.done ? "Mark not loaded" : "Mark loaded"}: ${t.label}`}>
                  <span className="task-box">{t.done && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>}</span>
                  <span className="task-label">{t.label}</span>
                </button>
                <div className="task-right">
                  {t.link && <a className="adm-task-link" href={t.link} target="_blank" rel="noopener noreferrer" aria-label="Open reference / application">↗</a>}
                  <button type="button" className="task-discuss" onClick={() => setOpenThread(openThread === t.id ? null : t.id)} aria-label={`Discuss ${t.label}`}>💬{counts[t.id] ? <span className="cmt-count">{counts[t.id]}</span> : null}</button>
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
              {openThread === t.id && (
                <CommentThread subject={{ col: "event_task_id", id: t.id }} notifyIds={[t.assignee]} label={t.label} meId={user?.id ?? null} meName={profile?.display_name?.trim() || "Me"} />
              )}
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
        <SupplyPicker ev={ev} title={name ?? (isEvent ? "this event" : "this location")} have={new Set(tasks.map((t) => t.label.trim().toLowerCase()))} onAdd={addSupplies} onClose={() => setShowSupplies(false)} />
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

type SupplyItem = { name: string; category: string; qty: number | null; unit: string | null; critical: boolean };

// Supply picker — one searchable catalog over BOTH Notion DBs: inventory (consumables,
// /api/inventory) and assets/gear (/api/assets). Pre-selects what the event needs, and
// anything in neither DB can be typed in off-catalog. (GearLibrary stays the manuals view.)
function SupplyPicker({ ev, title, have, onAdd, onClose }: {
  ev: EventRow | null; // null for a truck stop (no menu/rig to pre-select from)
  title: string;
  have: Set<string>;
  onAdd: (items: { label: string; critical: boolean }[]) => void;
  onClose: () => void;
}) {
  const [inv, setInv] = useState<InventoryResp | null>(null);
  const [assets, setAssets] = useState<AssetsResp | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());

  useEffect(() => { fetchInventory().then(setInv); fetchAssets().then(setAssets); }, []);
  // Pre-check the consumables this event actually draws on (from its menu/rig answers).
  // A stop has no menu/rig, so nothing is pre-selected — the operator picks what to bring.
  useEffect(() => {
    if (!inv || !ev) return;
    const relevant = inventoryForEvent(inv.items, ev).relevant;
    setSel(new Set(relevant.filter((it) => !have.has(it.name.trim().toLowerCase())).map((it) => it.name)));
  }, [inv, ev]); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge both catalogs into one list (inventory wins on a name clash so qty/critical stick).
  const invItems: SupplyItem[] = (inv?.items ?? []).map((it) => ({ name: it.name, category: it.category || "Supplies", qty: it.qty, unit: it.unit, critical: it.critical }));
  const seenInv = new Set(invItems.map((i) => i.name.trim().toLowerCase()));
  const gearItems: SupplyItem[] = (assets?.items ?? [])
    .filter((it) => !seenInv.has(it.name.trim().toLowerCase()))
    .map((it) => ({ name: it.name, category: it.category?.[0] || it.brand || "Gear", qty: it.qty, unit: null, critical: false }));
  const items: SupplyItem[] = [...invItems, ...gearItems];
  const loaded = inv !== null && assets !== null;
  const enabled = Boolean(inv?.enabled || assets?.enabled);

  const ql = q.trim().toLowerCase();
  const onList = (name: string) => have.has(name.trim().toLowerCase());
  const relevantNames = inv && ev ? new Set(inventoryForEvent(inv.items, ev).relevant.map((it) => it.name)) : new Set<string>();
  const filtered = ql ? items.filter((it) => it.name.toLowerCase().includes(ql) || it.category.toLowerCase().includes(ql)) : items;
  const exactMatch = items.some((it) => it.name.trim().toLowerCase() === ql);
  const toggle = (name: string) => setSel((p) => { const n = new Set(p); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const confirm = () => onAdd(items.filter((it) => sel.has(it.name) && !onList(it.name)).map((it) => ({ label: it.name, critical: it.critical })));
  const addCustom = () => { if (ql) onAdd([{ label: q.trim(), critical: false }]); };
  const selCount = [...sel].filter((n) => !onList(n)).length;

  // Group: what this event needs first, then by catalog category — easier to scan than one flat list.
  const groupsMap = new Map<string, SupplyItem[]>();
  for (const it of filtered) {
    const g = relevantNames.has(it.name) ? "Needed for this event" : (it.category || "Other");
    const arr = groupsMap.get(g) ?? [];
    if (arr.length === 0) groupsMap.set(g, arr);
    arr.push(it);
  }
  const groupEntries = [...groupsMap.entries()].sort((a, b) =>
    a[0] === "Needed for this event" ? -1 : b[0] === "Needed for this event" ? 1 : a[0].localeCompare(b[0])
  );

  const Item = (it: SupplyItem) => {
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
          <div className="assign-sheet-h">Supplies for · <b>{title}</b></div>
          <input className="subpitch-email" style={{ marginBottom: 0 }} placeholder="Search inventory + gear…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search supplies" autoFocus />
          {ql && !exactMatch && (
            <button type="button" className="assign-row me" style={{ marginTop: 8 }} onClick={addCustom}>
              <span className="assign-av none">+</span>
              <span className="assign-name">Add &ldquo;{q.trim()}&rdquo; <span className="supply-off">off-catalog</span></span>
            </button>
          )}
        </div>
        <div className="supply-list">
          {!loaded && <div className="h-sub" style={{ margin: "6px 0" }}>Loading inventory + gear…</div>}
          {loaded && !enabled && <div className="h-sub" style={{ margin: "6px 0" }}>Catalogs (Notion) aren&apos;t connected — type a name above and tap <b>Add</b> to put it on the list.</div>}
          {loaded && enabled && groupEntries.length === 0 && <div className="h-sub" style={{ margin: "6px 0" }}>No matches{ql ? ` for “${q.trim()}”` : ""}. Type to add it off-catalog.</div>}
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
  const [editAddr, setEditAddr] = useState(false);
  const hasCoords = s.lat != null && s.lng != null;

  // every update carries a WHERE (id) — safe with the safeupdate guard
  const patch = async (p: Partial<Stop>, msg = "Saved") => {
    const { error } = await supabase!.from("stops").update(p).eq("id", s.id);
    toast(error ? `Error: ${error.message}` : msg);
    if (!error) onChanged();
  };
  const saveName = () => { const nm = name.trim(); if (nm && nm !== s.name) patch({ name: nm }, "Name saved"); };
  const saveLocation = async (): Promise<boolean> => {
    const q = address.trim(); if (!q) return false;
    setBusy(true);
    const geo = await geocode(q);
    if (!geo) { setBusy(false); toast("Couldn't find that address — add city & state, then retry."); return false; }
    const { error } = await supabase!.from("stops").update({ address: q, location_text: q, lat: geo.lat, lng: geo.lng }).eq("id", s.id);
    setBusy(false);
    toast(error ? `Error: ${error.message}` : "Location pinned — directions are now accurate");
    if (!error) onChanged();
    return !error;
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
            <button type="button" className="ev-fieldbtn" onClick={() => setEditAddr(true)}>
              <span className="ev-fieldbtn-l">Address</span>
              <span className={`ev-fieldbtn-v${address.trim() ? "" : " ph"}`}>{address.trim() || "Tap to add — we'll pin it on the map"}</span>
              <span className="ev-fieldbtn-chev">›</span>
            </button>
            <div className={`stop-coords${hasCoords ? " ok" : ""}`}>{hasCoords ? `Pinned · ${(s.lat as number).toFixed(4)}, ${(s.lng as number).toFixed(4)}` : "No pin yet — add an address for accurate directions"}</div>
            {editAddr && (
              <InputSheet
                title="Street address" value={address} onChange={setAddress}
                placeholder="123 Main St, City, ST" inputMode="text" maxLength={300}
                busy={busy} doneLabel="Save & pin"
                hint="Add city & state for an accurate pin — or paste a Google Maps link."
                help={{ label: "Where do I find this?", detail: (<>On Google Maps, find the spot → <b>Share</b> → <b>Copy link</b> and paste it here — or type the full street address with city &amp; state. We geocode it and drop the live-map pin guests follow.</>) }}
                onClose={() => setEditAddr(false)}
                onDone={async () => { if (await saveLocation()) setEditAddr(false); }}
              />
            )}
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
    // Authoritative + atomic via the SECURITY-DEFINER RPC (demotes other stops, promotes this
    // one, upserts live_status) — same robustness path as go-offline, not piecemeal client writes.
    const { error } = await supabase!.rpc("admin_set_live", { stop: stopId, live: true });
    if (error) {
      setErr(error.message);
      toast(error.message.includes("not authorized") ? "Go live failed — your account isn't an owner/admin." : `Couldn't go live — ${error.message}`, "error");
      load();
      return;
    }
    // Verify against the source of truth before claiming success.
    const { data: chk } = await supabase!.from("live_status").select("is_live").eq("id", 1).maybeSingle();
    if (!chk || (chk as { is_live: boolean }).is_live !== true) {
      setErr("Go live didn't persist — confirm your owner role (RLS).");
      toast("Go live didn't save — see banner.", "error");
    } else {
      toast("Truck is LIVE — members updated");
    }
    load();
  };
  const pause = async () => {
    // Going offline closes out the current stop: it's archived off the live screen and the
    // next stop on the route becomes the visible "next". Confirm — it drops the truck for all.
    const finished = stops.find((s) => s.id === live?.current_stop_id) ?? null;
    const next = stops.find((s) => !s.archived_at && s.status !== "done" && s.id !== finished?.id) ?? null;
    const msg = finished
      ? `Close out ${finished.name} and go offline?\n\nIt gets archived off the live screen${next ? `, and ${next.name} is up next` : ""}. Customers stop seeing the truck as live.`
      : "Take the truck OFFLINE?\n\nCustomers will immediately stop seeing it as live on the Truck page.";
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    stopBroadcast();
    setLive((l) => (l ? { ...l, is_live: false, current_stop_id: null, truck_lat: null, truck_lng: null, pos_updated_at: null } : { id: 1, current_stop_id: null, is_live: false, next_eta: null }));
    // Authoritative, atomic go-offline via the SECURITY-DEFINER RPC — clears is_live,
    // current_stop_id and the live position, and demotes the live stop, all server-side.
    // (Replaces the piecemeal client writes that could report success without sticking.)
    const { error } = await supabase!.rpc("admin_set_offline");
    if (error) {
      setErr(error.message);
      toast(error.message.includes("not authorized") ? "Go offline failed — your account isn't an owner/admin." : `Couldn't go offline — ${error.message}`, "error");
      load();
      return;
    }
    // Archive the just-finished stop off the live screen (record kept).
    if (finished) await supabase!.from("stops").update({ status: "done", archived_at: new Date().toISOString() }).eq("id", finished.id);
    // Verify against the source of truth — never claim offline if it didn't take.
    const { data: chk } = await supabase!.from("live_status").select("is_live").eq("id", 1).maybeSingle();
    if (chk && (chk as { is_live: boolean }).is_live === true) {
      setErr("Go offline didn't persist — confirm your owner role (RLS).");
      toast("Go offline didn't save — see banner.", "error");
    } else {
      toast(next ? `Offline — ${next.name} is next` : "Truck is offline");
    }
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
    // If it's the live stop, take the truck offline authoritatively first (atomic RPC).
    if (wasLive) await supabase!.rpc("admin_set_offline");
    await supabase!.from("stops").update({ archived_at: new Date().toISOString(), status: "upcoming" }).eq("id", id);
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

// ───────────────────────── meeting notes (in-app system of record) ─────────────────────────
const fmtNoteDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

// Meeting notes live in Supabase (operational, relational, tenant-scoped) — not Notion. A note's
// follow-ups become event_tasks owned by meeting_note_id, so they ride the same assign + My Tasks +
// push engine as event/stop prep. Leadership-only (RLS gates to event_manager/admin/owner).
function MeetingNotes() {
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const isAdmin = roleOf(profile) === "admin" || roleOf(profile) === "owner";
  const meId = user?.id ?? null;
  const meName = profile?.display_name?.trim() || "Me";
  const [notes, setNotes] = useState<MeetingNote[]>([]);
  const [events, setEvents] = useState<{ id: string; title: string }[]>([]);
  const [staff, setStaff] = useState<{ id: string; display_name: string | null; role?: string | null }[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [cTitle, setCTitle] = useState("");
  const [cDate, setCDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cSummary, setCSummary] = useState("");
  const [cBody, setCBody] = useState("");
  const [cActions, setCActions] = useState<{ title: string; category: string; critical: boolean }[]>([]);
  const [cEvent, setCEvent] = useState("");
  const [saving, setSaving] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"active" | "archived">("active");

  const summarize = async () => {
    if (!supabase || summarizing) return;
    const src = (cBody.trim() || cSummary.trim());
    if (!src) { toast("Add a transcript or recap first"); return; }
    setSummarizing(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/agents/summarize", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ text: src }) });
      const j = await r.json();
      if (j.ok) {
        setCSummary(j.summary);
        if (!cTitle.trim() && j.title) setCTitle(j.title);   // fill the title only if you haven't typed one
        setCActions(j.actionItems ?? []);
        toast(`Recap ready${j.actionItems?.length ? ` · ${j.actionItems.length} task${j.actionItems.length === 1 ? "" : "s"} to add on save` : ""}`);
      } else toast(String(j.error ?? "").includes("ANTHROPIC") ? "AI isn't switched on yet — add the API key" : `Error: ${j.error}`, "error");
    } catch { toast("Couldn't reach the summarizer", "error"); }
    setSummarizing(false);
  };
  const archive = async (n: MeetingNote, on: boolean) => {
    if (!supabase) return;
    await supabase.from("meeting_notes").update({ archived_at: on ? new Date().toISOString() : null }).eq("id", n.id);
    toast(on ? "Note archived" : "Note restored"); load();
  };

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("meeting_notes").select("*").order("met_on", { ascending: false }).order("created_at", { ascending: false });
    setNotes((data as MeetingNote[]) ?? []);
  }, []);
  useEffect(() => {
    load();
    if (!supabase) return;
    supabase.from("events").select("id, title").is("archived_at", null).order("day", { ascending: false }).then(({ data }) => setEvents((data as { id: string; title: string }[]) ?? []));
    supabase.from("profiles").select("id, display_name, role").neq("role", "member").then(({ data }) => setStaff((data as { id: string; display_name: string | null; role?: string | null }[]) ?? []));
    const ch = supabase.channel("admin-notes")
      .on("postgres_changes", { event: "*", schema: "public", table: "meeting_notes" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  const save = async () => {
    if (!supabase || !cTitle.trim() || saving) return;
    setSaving(true);
    const { data, error } = await supabase.from("meeting_notes").insert({
      title: cTitle.trim(), met_on: cDate, summary: cSummary.trim() || null,
      body: cBody.trim() || null, event_id: cEvent || null, created_by: meId,
    }).select("id").single();
    // AI-extracted action items become the note's follow-up tasks (My Tasks / note follow-ups).
    const noteId = (data as { id: string } | null)?.id;
    if (!error && noteId && cActions.length) {
      await supabase.from("event_tasks").insert(cActions.map((a, i) => ({
        meeting_note_id: noteId, label: a.title, kind: "task", section: "Follow-up", critical: a.critical, sort: 1000 + i,
      })));
    }
    setSaving(false);
    if (error) { toast(`Error: ${error.message}`, "error"); return; }
    toast(`Note saved${cActions.length ? ` · ${cActions.length} task${cActions.length === 1 ? "" : "s"} added` : ""}`);
    setCTitle(""); setCSummary(""); setCBody(""); setCEvent(""); setCActions([]); setComposing(false);
    load();
  };
  const remove = async (n: MeetingNote) => {
    if (!supabase || !isAdmin) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete "${n.title}"? This also removes its follow-ups.`)) return;
    await supabase.from("meeting_notes").delete().eq("id", n.id);
    toast("Note deleted"); load();
  };

  return (
    <div className="adm-sec">
      <div className="sec">Meeting notes <span className="adm-pill">{notes.length}</span></div>
      <div className="h-sub note-intro">Your talking points, in the app. Paste a recap, tag follow-ups, assign them — they land in everyone&apos;s My&nbsp;Tasks with a notification.</div>

      {!composing ? (
        <button type="button" className="note-new" onClick={() => setComposing(true)}>+ New note</button>
      ) : (
        <div className="note-composer">
          <input className="note-in" placeholder="What did you meet about?" value={cTitle} onChange={(e) => setCTitle(e.target.value)} />
          <div className="note-row">
            <input type="date" className="note-in" value={cDate} onChange={(e) => setCDate(e.target.value)} aria-label="Meeting date" />
            <select className="note-in" value={cEvent} onChange={(e) => setCEvent(e.target.value)} aria-label="Link to event">
              <option value="">No event link</option>
              {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
            </select>
          </div>
          <textarea className="note-area" placeholder="Recap / summary — paste from your notes app, or ✨ generate below…" value={cSummary} onChange={(e) => setCSummary(e.target.value)} rows={cSummary.length > 200 ? 10 : 3} />
          <textarea className="note-area" placeholder="Paste the full transcript here — then ✨ summarize" value={cBody} onChange={(e) => setCBody(e.target.value)} rows={4} />
          <button type="button" className="note-suggest note-sum" onClick={summarize} disabled={summarizing}>{summarizing ? "Summarizing…" : "✨ Summarize transcript → title · recap · tasks"}</button>
          {cActions.length > 0 && (
            <div className="note-tasks-prev">
              <b>{cActions.length} follow-up task{cActions.length === 1 ? "" : "s"}</b> will be created when you save:
              <ul>{cActions.map((a, i) => <li key={i}>{a.critical ? "⚠️ " : ""}{a.title}</li>)}</ul>
            </div>
          )}
          <div className="note-actions">
            <button type="button" className="note-cancel" onClick={() => { setComposing(false); setCActions([]); }}>Cancel</button>
            <button type="button" className="note-save" disabled={!cTitle.trim() || saving} onClick={save}>{saving ? "Saving…" : "Save note"}</button>
          </div>
        </div>
      )}

      {(() => {
        const archivedCount = notes.filter((n) => n.archived_at).length;
        const q = query.trim().toLowerCase();
        const shown = notes.filter((n) => (tab === "archived" ? n.archived_at : !n.archived_at))
          .filter((n) => !q || n.title.toLowerCase().includes(q) || (n.summary || "").toLowerCase().includes(q) || (events.find((e) => e.id === n.event_id)?.title || "").toLowerCase().includes(q));
        return (
          <>
            <div className="note-filter">
              <input className="note-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes…" />
              <div className="note-tabs">
                <button type="button" className={`note-tab${tab === "active" ? " on" : ""}`} onClick={() => setTab("active")}>Active</button>
                <button type="button" className={`note-tab${tab === "archived" ? " on" : ""}`} onClick={() => setTab("archived")}>Archived{archivedCount ? ` ${archivedCount}` : ""}</button>
              </div>
            </div>
            {shown.map((n) => (
              <MeetingNoteCard
                key={n.id} note={n} open={openId === n.id} onToggle={() => setOpenId(openId === n.id ? null : n.id)}
                staff={staff} meId={meId} meName={meName} isAdmin={isAdmin}
                eventTitle={events.find((e) => e.id === n.event_id)?.title ?? null} onDelete={() => remove(n)}
                onArchive={() => archive(n, !n.archived_at)}
              />
            ))}
            {shown.length === 0 && !composing && <div className="h-sub">{q ? "No notes match your search." : tab === "archived" ? "No archived notes." : "No notes yet — tap “New note” after your next sit-down."}</div>}
          </>
        );
      })()}
    </div>
  );
}

function MeetingNoteCard({ note, open, onToggle, staff, meId, meName, isAdmin, eventTitle, onDelete, onArchive }: {
  note: MeetingNote;
  open: boolean;
  onToggle: () => void;
  staff: { id: string; display_name: string | null; role?: string | null }[];
  meId: string | null;
  meName: string;
  isAdmin: boolean;
  eventTitle: string | null;
  onDelete: () => void;
  onArchive: () => void;
}) {
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const [items, setItems] = useState<EventTask[]>([]);
  const [newItem, setNewItem] = useState("");
  const [assignFor, setAssignFor] = useState<EventTask | null>(null);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [suggesting, setSuggesting] = useState(false);
  const [resolving, setResolving] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("event_tasks").select("*").eq("meeting_note_id", note.id).order("sort");
    const rows = (data as EventTask[]) ?? [];
    setItems(rows);
    setCounts(await commentCounts("event_task_id", rows.map((r) => r.id)));
  }, [note.id]);
  useEffect(() => {
    if (!open) return;
    load();
    if (!supabase) return;
    const ch = supabase.channel(`note-items-${note.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_tasks", filter: `meeting_note_id=eq.${note.id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [open, load, note.id]);

  const staffName = (uid: string) => staff.find((s) => s.id === uid)?.display_name?.trim() || (uid === meId ? meName : "Unnamed crew");
  const firstNameOf = (uid: string) => staffName(uid).split(" ")[0];

  const add = async () => {
    if (!supabase || !newItem.trim()) return;
    const { error } = await supabase.from("event_tasks").insert({ meeting_note_id: note.id, label: newItem.trim(), kind: "task", section: "Follow-up", sort: items.length });
    setNewItem("");
    if (error) toast(`Error: ${error.message}`, "error"); else load();
  };
  // Agent #1 — let Claude pull the follow-ups out of the recap, proposed for review.
  // Propose how to COMPLETE a follow-up (surfacing answers we already have). Persists on the task.
  const resolve = useCallback(async (t: EventTask) => {
    if (!supabase || t.ai_proposal || resolving.has(t.id)) return;
    setResolving((s) => new Set(s).add(t.id));
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/agents/resolve", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ task_id: t.id }) });
      const j = await r.json();
      if (j.ok) setItems((p) => p.map((x) => (x.id === t.id ? { ...x, ai_proposal: j.proposal, ai_has_answer: j.have_answer } : x)));
    } catch { /* */ }
    setResolving((s) => { const n = new Set(s); n.delete(t.id); return n; });
  }, [resolving]);

  const suggest = async () => {
    if (!supabase || suggesting) return;
    setSuggesting(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/agents/recap", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ note_id: note.id }) });
      const j = await r.json();
      if (!j.ok) toast(j.error === "AI not configured (set ANTHROPIC_API_KEY)" ? "AI isn't switched on yet — add the API key" : `Error: ${j.error ?? r.status}`, "error");
      else {
        toast(j.added ? `Added ${j.added} follow-up${j.added === 1 ? "" : "s"} — proposing how to finish each…` : "No new action items found");
        await load();
        // Auto-propose a completion for the freshly generated items.
        const { data: fresh } = await supabase.from("event_tasks").select("*").eq("meeting_note_id", note.id).is("ai_proposal", null).order("sort", { ascending: false }).limit(8);
        for (const t of (fresh as EventTask[] ?? [])) await resolve(t);
      }
    } catch { toast("Couldn't reach the recap agent", "error"); }
    setSuggesting(false);
  };
  const toggle = async (t: EventTask) => {
    if (!supabase) return;
    const next = !t.done;
    setItems((p) => p.map((x) => (x.id === t.id ? { ...x, done: next } : x)));
    const { error } = await supabase.from("event_tasks").update({ done: next, done_by: next ? user?.id ?? null : null, done_at: next ? new Date().toISOString() : null }).eq("id", t.id);
    if (error) { toast(`Error: ${error.message}`, "error"); load(); }
  };
  const assign = async (t: EventTask, uid: string) => {
    if (!supabase) return;
    const prev = t.assignee ?? null;
    const next = uid || null;
    setAssignFor(null);
    if (next === prev) return;
    setItems((p) => p.map((x) => (x.id === t.id ? { ...x, assignee: next } : x))); // optimistic
    const { error } = await supabase.from("event_tasks").update({ assignee: next }).eq("id", t.id);
    if (error) { toast(`Error: ${error.message}`, "error"); load(); return; }
    toast(next ? `Assigned to ${firstNameOf(next)}` : "Unassigned");
    if (next) {
      supabase.functions
        .invoke("push", { body: { table: "event_tasks", type: "UPDATE", record: { ...t, assignee: next }, old_record: { ...t, assignee: prev } } })
        .catch(() => {});
      // Can't-miss: a leader assigning another leader a follow-up → raise a critical alert.
      const assigneeRole = staff.find((s) => s.id === next)?.role ?? null;
      if (next !== user?.id && isLeader(roleOf(profile)) && isLeader(assigneeRole)) {
        raiseAlert({
          severity: "critical", category: "assignment",
          title: `${profile?.display_name?.split(" ")[0] || "A manager"} assigned you: ${t.label}`,
          body: `Follow-up · ${note.title}`, target_user_id: next, created_by: user?.id ?? null,
        });
      }
    }
  };
  // Promote a follow-up to a can't-miss alert (the "flag this" the talking-point becomes urgent).
  const flag = async (t: EventTask) => {
    await raiseAlert({
      severity: "critical", category: "note",
      title: `Flagged: ${t.label}`, body: `From meeting · ${note.title}`,
      target_user_id: t.assignee ?? null, created_by: user?.id ?? null,
    });
    toast("Flagged — sent to alerts");
  };
  const removeItem = async (t: EventTask) => {
    if (!supabase) return;
    setItems((p) => p.filter((x) => x.id !== t.id));
    await supabase.from("event_tasks").delete().eq("id", t.id);
  };

  const openCount = items.filter((i) => !i.done).length;
  return (
    <div className={`note-card${open ? " open" : ""}`}>
      <button type="button" className="note-head" onClick={onToggle} aria-expanded={open}>
        <div className="note-head-main">
          <span className="note-title">{note.title}{note.source === "email" && <span className="note-src">email</span>}</span>
          <span className="note-meta">{fmtNoteDate(note.met_on)}{eventTitle ? ` · ${eventTitle}` : ""}{items.length ? ` · ${openCount}/${items.length} follow-ups` : ""}</span>
        </div>
        <span className="note-chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="note-body">
          {note.summary && <Markdown source={note.summary} className="note-summary" />}
          {note.body && <details className="note-full"><summary>Full notes</summary><p>{note.body}</p></details>}
          <div className="note-fu-h">Follow-ups
            <button type="button" className="note-suggest" onClick={suggest} disabled={suggesting}>{suggesting ? "Reading…" : "✨ Suggest"}</button>
          </div>
          {items.map((t) => (
            <div key={t.id} className="note-fu-wrap">
              <div className={`note-fu${t.done ? " done" : ""}`}>
                <button type="button" className="task-check" onClick={() => toggle(t)} aria-label={`Mark done: ${t.label}`}>
                  <span className="task-box">{t.done && <svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-11" /></svg>}</span>
                </button>
                <span className="note-fu-label">{t.label}</span>
                <button type="button" className="note-fu-assign" onClick={() => setAssignFor(t)}>{t.assignee ? firstNameOf(t.assignee) : "Assign"}</button>
                <button type="button" className="note-fu-flag" onClick={() => setOpenThread(openThread === t.id ? null : t.id)} aria-label="Discuss" title="Discuss">💬{counts[t.id] ? <span className="cmt-count">{counts[t.id]}</span> : null}</button>
                <button type="button" className="note-fu-flag" onClick={() => flag(t)} aria-label="Flag as can't-miss" title="Flag as can't-miss">⚑</button>
                {!t.ai_proposal && <button type="button" className="note-fu-solve" onClick={() => resolve(t)} disabled={resolving.has(t.id)} title="Propose how to complete this">{resolving.has(t.id) ? "…" : "💡"}</button>}
                {isAdmin && <button type="button" className="note-fu-x" onClick={() => removeItem(t)} aria-label="Remove follow-up">×</button>}
              </div>
              {t.ai_proposal && (
                <div className={`fu-prop${t.ai_has_answer ? " has" : ""}`}>
                  <div className="fu-prop-h">{t.ai_has_answer ? "✓ We already have this" : "💡 Proposed"}</div>
                  <div className="fu-prop-b">{t.ai_proposal}</div>
                </div>
              )}
              {openThread === t.id && (
                <CommentThread subject={{ col: "event_task_id", id: t.id }} notifyIds={[t.assignee, note.created_by]} label={t.label} meId={meId} meName={meName} />
              )}
            </div>
          ))}
          <div className="note-fu-add">
            <input className="note-in" placeholder="Add a follow-up…" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
            <button type="button" className="note-fu-addbtn" onClick={add} disabled={!newItem.trim()}>Add</button>
          </div>
          <div className="note-foot">
            <button type="button" className="note-arch" onClick={onArchive}>{note.archived_at ? "Restore" : "Archive"}</button>
            {isAdmin && <button type="button" className="note-del" onClick={onDelete}>Delete note</button>}
          </div>
        </div>
      )}
      {assignFor && (
        <AssignSheet task={assignFor} staff={staff} crewIds={[]} meId={meId} meName={meName}
          onPick={(uid) => assign(assignFor, uid)} onClose={() => setAssignFor(null)} />
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
  const packOf = (plan: string) => { const n = plan?.match(/\d+/)?.[0]; return n ? `${n} bottles · every 2 wks` : plan; };
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
// The full role set lives in profiles.role (migration 0031). roleOf() COLLAPSES it
// (operator/event_manager/contractor → member), so the team console never uses it — it reads
// the raw role and maps each to a tier, a human label, and the exact sections it unlocks
// (kept in lockstep with OperatorNav's scope so "what can they see" is never a guess).
type RoleKey = "owner" | "admin" | "event_manager" | "operator" | "contractor" | "server" | "member";
const ROLE_META: Record<RoleKey, { label: string; tier: "lead" | "crew" | "member"; scope: string; tone: string }> = {
  owner:         { label: "Owner",         tier: "lead",   scope: "Full access — every section",    tone: "red" },
  admin:         { label: "Admin",         tier: "lead",   scope: "Full access — every section",    tone: "red" },
  event_manager: { label: "Event Manager", tier: "lead",   scope: "Now · Prep · Plan",              tone: "gold" },
  operator:      { label: "Operator",      tier: "crew",   scope: "Now · Prep",                     tone: "cream" },
  contractor:    { label: "Contractor",    tier: "crew",   scope: "Now · Prep — event hire",        tone: "cream" },
  server:        { label: "Server",        tier: "crew",   scope: "Now — order pass only",          tone: "cream" },
  member:        { label: "Member",        tier: "member", scope: "Customer — loyalty only",        tone: "muted" },
};
const ROLE_ORDER: RoleKey[] = ["owner", "admin", "event_manager", "operator", "contractor", "server", "member"];
const TIERS: { key: "lead" | "crew" | "member"; title: string; hint: string }[] = [
  { key: "lead", title: "Leadership", hint: "Run the business" },
  { key: "crew", title: "Crew", hint: "Work the shifts" },
  { key: "member", title: "Members", hint: "Customers" },
];
const rawRole = (m: { role?: string | null }): RoleKey => {
  const r = m.role as RoleKey;
  return ROLE_ORDER.includes(r) ? r : "member";
};
const initials = (name: string | null) =>
  (name ?? "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "·";

function MemberRow({ m, isSelf, ownerCount, onPatch, onSaved }: { m: Profile; isSelf: boolean; ownerCount: number; onPatch: (id: string, role: string) => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [name, setName] = useState(m.display_name ?? "");
  const role = rawRole(m);
  const meta = ROLE_META[role];
  const [pts, setPts] = useState(m.points);
  const [credit, setCredit] = useState((m.credit_cents / 100).toFixed(2));
  const [founding, setFounding] = useState(m.founding_member);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  // Keep the loyalty inputs honest if a realtime reload changes them underneath us.
  useEffect(() => { setPts(m.points); setCredit((m.credit_cents / 100).toFixed(2)); setFounding(m.founding_member); }, [m.points, m.credit_cents, m.founding_member]);
  const dirty = name !== (m.display_name ?? "") || pts !== m.points || credit !== (m.credit_cents / 100).toFixed(2) || founding !== m.founding_member;

  const save = async () => {
    setBusy(true);
    if (name !== (m.display_name ?? "")) await supabase!.rpc("admin_set_display_name", { member: m.id, name });
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
  const setRole = async (next: string) => {
    if (next === role) return;
    const name = m.display_name ?? "this person";
    // Safety rails: never strand the business without an owner; double-check elevations + demotions.
    if (role === "owner" && next !== "owner" && ownerCount <= 1) { toast("Can't remove the last owner — promote someone else first."); return; }
    if (isSelf && role === "owner" && next !== "owner") { if (!window.confirm("Demote yourself from Owner? You'll lose full access immediately.")) return; }
    else if (next === "owner" || next === "admin" || role === "owner") { if (!window.confirm(`Set ${name} to ${ROLE_META[next as RoleKey].label}?`)) return; }
    onPatch(m.id, next); // optimistic — reflect the pick instantly
    const { error } = await supabase!.rpc("admin_set_role", { member: m.id, new_role: next });
    if (error) { onPatch(m.id, role); toast(`Error: ${error.message}`); }
    else { toast(`${m.display_name ?? "Member"} → ${ROLE_META[next as RoleKey].label}`); onSaved(); }
  };

  return (
    <div className="adm-member tm-row">
      <div className="tm-head">
        <span className={`tm-av tone-${meta.tone}`}>{initials(m.display_name)}</span>
        <div className="tm-id">
          <b>{m.display_name ?? "Unnamed"}{isSelf && <span className="tm-you">you</span>}</b>
          <span className="adm-ref">{m.referral_code || "—"}</span>
        </div>
        <span className={`tm-badge tone-${meta.tone}`}>{meta.label}</span>
      </div>
      <label className="tm-rolepick">
        <select className="adm-role" value={role} onChange={(e) => setRole(e.target.value)} aria-label={`Role for ${m.display_name ?? "member"}`}>
          {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
        </select>
        <i className="tm-scope">{meta.scope}</i>
      </label>
      <button className="tm-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Hide loyalty" : "Loyalty & credit"}</button>
      {open && (
        <div className="adm-fields tm-loyalty">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" /></label>
          <label>Points<input type="number" min={0} value={pts} onChange={(e) => setPts(Math.max(0, parseInt(e.target.value) || 0))} /></label>
          <label>Credit $<input type="text" inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} /></label>
          <label className="adm-check"><input type="checkbox" checked={founding} onChange={(e) => setFounding(e.target.checked)} />Founding</label>
          <button className={`adm-btn${dirty ? " primary" : ""}`} onClick={save} disabled={!dirty || busy}>{busy ? "…" : "Save"}</button>
        </div>
      )}
    </div>
  );
}

function Members() {
  const { user } = useAuth();
  const [members, setMembers] = useState<Profile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("profiles").select("*").order("display_name");
    if (data) setMembers(data as Profile[]);
    setLoaded(true);
  }, []);
  // Optimistic local patch so a role pick reflects instantly, before the round-trip.
  const patch = useCallback((id: string, role: string) =>
    setMembers((ms) => ms.map((x) => (x.id === id ? { ...x, role: role as Profile["role"] } : x))), []);
  // Real-time: any role/loyalty change (this manager, another manager, or the affected user's
  // own session re-reading their access) lands here live — no refresh.
  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel("admin-members")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  const ql = q.trim().toLowerCase();
  const shown = members.filter((m) =>
    !ql || (m.display_name ?? "").toLowerCase().includes(ql) || (m.referral_code ?? "").toLowerCase().includes(ql) || ROLE_META[rawRole(m)].label.toLowerCase().includes(ql)
  );
  const counts = { lead: 0, crew: 0, member: 0 };
  members.forEach((m) => { counts[ROLE_META[rawRole(m)].tier]++; });
  const ownerCount = members.filter((m) => rawRole(m) === "owner").length;

  return (
    <div className="adm-sec tm">
      <div className="sec">Team · {members.length}</div>
      <div className="tm-counts">
        <span><b>{counts.lead}</b> leadership</span>
        <span><b>{counts.crew}</b> crew</span>
        <span><b>{counts.member}</b> members</span>
        <span className="tm-live">● live</span>
      </div>
      {members.length > 5 && (
        <input className="auth-input tm-search" placeholder="Search name, code, or role" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      {TIERS.map((tier) => {
        const rows = shown
          .filter((m) => ROLE_META[rawRole(m)].tier === tier.key)
          .sort((a, b) => ROLE_ORDER.indexOf(rawRole(a)) - ROLE_ORDER.indexOf(rawRole(b)) || (a.display_name ?? "").localeCompare(b.display_name ?? ""));
        if (rows.length === 0) return null;
        return (
          <div key={tier.key} className="tm-group">
            <div className="tm-gh"><span>{tier.title}</span><i>{tier.hint}</i><b>{rows.length}</b></div>
            {rows.map((m) => <MemberRow key={m.id} m={m} isSelf={m.id === user?.id} ownerCount={ownerCount} onPatch={patch} onSaved={load} />)}
          </div>
        );
      })}
      {loaded && members.length === 0 && <div className="h-sub">No one here yet — people appear when they sign in.</div>}
      {loaded && members.length > 0 && shown.length === 0 && <div className="h-sub">No match for &ldquo;{q}&rdquo;.</div>}
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
            <div className="pnl-row neg"><span className="k">− Booth · transport · permit · bottles</span><span className="v">−{usd(fixed)}</span></div>
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
        <label className="ev-f">Bottles/ice $<input type="number" min={0} value={(econ.consumables_cents / 100) || 0} onChange={(ev) => live({ consumables_cents: toCents(ev.target.value) })} onBlur={commit} /></label>
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
function EventCard({ e, index, open, onToggle, onUpdate, onRemove, onSetLive, onArchive, econRow, catalog, inventory, vendors, onLinkVendor, onSaveEcon, onOpenPrep }: {
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
  onOpenPrep: (id: string) => void;
}) {
  const [prep, setPrep] = useState<{ done: number; total: number; crit: number } | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planCount, setPlanCount] = useState<number | null>(null);
  useEffect(() => {
    if (!open || !supabase) return;
    supabase.from("event_schedule_items").select("id", { count: "exact", head: true }).eq("event_id", e.id).then(({ count }) => setPlanCount(count ?? 0));
    supabase.from("event_tasks").select("done, critical").eq("event_id", e.id).then(({ data }) => {
      const rows = (data as { done: boolean; critical: boolean }[]) ?? [];
      setPrep({ done: rows.filter((r) => r.done).length, total: rows.length, crit: rows.filter((r) => r.critical && !r.done).length });
    });
  }, [open, e.id]);
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

          {/* Relational link to this event's pack/pick list (lives in Prep) */}
          <button type="button" className={`ev-prep${prep && prep.total > 0 && prep.done === prep.total ? " ok" : prep && prep.crit ? " miss" : ""}`} onClick={() => onOpenPrep(e.id)}>
            <span className="ev-prep-main">
              <b>Prep · pick list</b>
              <span>{prep === null ? "…" : prep.total === 0 ? "Not generated yet — open Prep to build it" : `Loaded ${prep.done}/${prep.total}${prep.crit ? ` · ${prep.crit} critical to load` : prep.done === prep.total ? " · ready" : ""}`}</span>
            </span>
            <span className="ev-prep-go">Open ›</span>
          </button>

          {/* Multi-day run of show — leave home → drive → setup → service → teardown, time by time */}
          <button type="button" className={`ev-prep${planCount && planCount > 0 ? " ok" : ""}`} onClick={() => setPlanOpen(true)}>
            <span className="ev-prep-main">
              <b>🗓️ Daily schedule · run of show</b>
              <span>{planCount === null ? "…" : planCount === 0 ? "Build a time-by-time plan for each day" : `${planCount} block${planCount === 1 ? "" : "s"} across ${Math.max(1, e.plan_days ?? 1)} day${Math.max(1, e.plan_days ?? 1) === 1 ? "" : "s"}`}</span>
            </span>
            <span className="ev-prep-go">Plan ›</span>
          </button>
          {planOpen && (
            <EventDayPlanner
              eventId={e.id} title={e.title} eventDay={e.day} planDays={Math.max(1, e.plan_days ?? 1)}
              onPlanDays={(n) => onUpdate({ plan_days: n })}
              onClose={() => { setPlanOpen(false); if (supabase) supabase.from("event_schedule_items").select("id", { count: "exact", head: true }).eq("event_id", e.id).then(({ count }) => setPlanCount(count ?? 0)); }}
            />
          )}

          {/* What guests see */}
          <div className="ev-group">
            <div className="ev-group-h">Guest facing</div>
            <label className="ev-fld">Title<input className="ev-input" maxLength={200} defaultValue={e.title} placeholder="Event title" aria-label="Event title"
              onBlur={(ev) => ev.target.value !== e.title && onUpdate({ title: ev.target.value })} /></label>
            <label className="ev-fld">Details guests see<textarea className="ev-input ev-area" maxLength={300} rows={2} defaultValue={e.blurb ?? ""} placeholder="One line guests read when they tap this event" aria-label="Event details"
              onBlur={(ev) => (ev.target.value.trim() || null) !== e.blurb && onUpdate({ blurb: ev.target.value.trim() || null })} /></label>
            <label className="ev-fld">Location / venue<input className="ev-input" maxLength={200} defaultValue={e.location_text ?? ""} placeholder="e.g. Duncan Town Square" aria-label="Location"
              onBlur={(ev) => (ev.target.value.trim() || null) !== e.location_text && onUpdate({ location_text: ev.target.value.trim() || null })} /></label>
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
  const { setSection } = useOperatorSection();
  const openPrep = (id: string) => { try { localStorage.setItem("gt3-prep-open", id); } catch { /* ignore */ } setSection("prep"); };
  const [events, setEvents] = useState<EventRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null); // single-open accordion
  const [genOpen, setGenOpen] = useState(false); // "create from notes" agent
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
      <div className="sec">Events
        <button className="adm-btn eg-btn" style={{ marginLeft: "auto" }} onClick={() => setGenOpen(true)}>✨ From notes</button>
        <button className="adm-btn" onClick={addEvent}>+ Add</button>
      </div>
      {genOpen && <EventGenerator onClose={() => setGenOpen(false)} onCreated={load} />}
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
            onOpenPrep={openPrep}
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

type VendorSug = { kind: "stop" | "event"; id: string; name: string; sub: string; stop?: Stop; event?: EventRow };

function VendorsAdmin() {
  const { toast } = useApp();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showArch, setShowArch] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: v }, { data: s }, { data: e }] = await Promise.all([
      supabase.from("vendors").select("*").order("sort"),
      supabase.from("stops").select("*"),
      supabase.from("events").select("*"),
    ]);
    if (v) setVendors(v as Vendor[]);
    setStops(((s as Stop[]) ?? []).filter((x) => !x.archived_at));
    setEvents(((e as EventRow[]) ?? []).filter((x) => !x.archived_at));
  }, []);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    const { data, error } = await supabase!.from("vendors").insert({ name: "New vendor", sort: vendors.length }).select("id").single();
    toast(error ? `Error: ${error.message}` : "Vendor added");
    if (!error) { if (data) setOpenId((data as { id: string }).id); load(); }
  };
  // Relational fill: materialize a vendor from an existing stop/event and link the source,
  // so "I had vendor events" turns into populated vendor records with one tap.
  const createFrom = async (sug: VendorSug) => {
    let payload: Partial<Vendor> = { name: sug.name, sort: vendors.length };
    if (sug.kind === "stop" && sug.stop) {
      const s = sug.stop;
      payload = { ...payload, location_text: s.location_text, address: s.address, lat: s.lat, lng: s.lng, poc_name: s.poc_name, poc_phone: s.poc_phone, poc_email: s.poc_email, service_dates: s.service_dates };
    } else if (sug.event) {
      payload = { ...payload, location_text: sug.event.location_text };
    }
    const { data, error } = await supabase!.from("vendors").insert(payload).select("id").single();
    if (error) { toast(`Error: ${error.message}`, "error"); return; }
    const vid = (data as { id: string }).id;
    if (sug.kind === "stop") await supabase!.from("stops").update({ vendor_id: vid }).eq("id", sug.id);
    else await supabase!.from("events").update({ vendor_id: vid }).eq("id", sug.id);
    toast(`Vendor created from ${sug.name} — now linked`);
    load();
  };
  const archive = async (id: string) => { await supabase!.from("vendors").update({ archived_at: new Date().toISOString() }).eq("id", id); setOpenId(null); load(); };
  const restore = async (id: string) => { await supabase!.from("vendors").update({ archived_at: null }).eq("id", id); load(); };
  const del = async (id: string, nm: string) => { if (typeof window !== "undefined" && !window.confirm(`Delete ${nm}?`)) return; await supabase!.from("vendors").delete().eq("id", id); load(); };
  const active = vendors.filter((v) => !v.archived_at);
  const archived = vendors.filter((v) => v.archived_at);

  // Suggestions = stops/events not yet linked to a vendor, whose name isn't already a vendor.
  const vendorNames = new Set(vendors.map((v) => v.name.trim().toLowerCase()));
  const seen = new Set<string>();
  const suggestions: VendorSug[] = [
    ...stops.filter((s) => !s.vendor_id && s.name).map((s) => ({ kind: "stop" as const, id: s.id, name: s.name, sub: s.location_text ?? s.address ?? "Stop", stop: s })),
    ...events.filter((e) => !e.vendor_id && e.title).map((e) => ({ kind: "event" as const, id: e.id, name: e.title, sub: e.location_text ?? "Event", event: e })),
  ].filter((x) => {
    const k = x.name.trim().toLowerCase();
    if (vendorNames.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return (
    <div className="adm-sec">
      <div className="sec">Vendors <button className="adm-btn" style={{ marginLeft: "auto" }} onClick={add}>+ Add vendor</button></div>
      <div className="pnl-note" style={{ marginBottom: 6 }}>One record per venue/partner — linked from truck stops and events. Edit a POC here and it updates everywhere it&apos;s linked.</div>
      {suggestions.length > 0 && (
        <div className="vendor-sugs">
          <div className="ev-group-h" style={{ marginBottom: 8 }}>Create from your stops &amp; events</div>
          {suggestions.map((sug) => (
            <div className="vendor-sug" key={`${sug.kind}-${sug.id}`}>
              <div className="vendor-sug-main"><b>{sug.name}</b><span>{sug.kind === "stop" ? "Stop" : "Event"}{sug.sub ? ` · ${sug.sub}` : ""}</span></div>
              <button className="adm-btn" onClick={() => createFrom(sug)}>+ Create</button>
            </div>
          ))}
        </div>
      )}
      {active.length === 0 && suggestions.length === 0 && <div className="ev-empty">No vendors yet. Tap <b>+ Add vendor</b> to create one.</div>}
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
  const [planTab, setPlanTab] = useState<"calendar" | "notes" | "events" | "vendors" | "bookings" | "reserves">("calendar");
  const [planCounts, setPlanCounts] = useState<{ bookings: number; events: number }>({ bookings: 0, events: 0 });
  useEffect(() => {
    if (sec !== "plan" || !canManage || !supabase) return;
    const today = new Date().toISOString().slice(0, 10);
    (async () => {
      const [b, e] = await Promise.all([
        supabase!.from("booking_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
        supabase!.from("events").select("id", { count: "exact", head: true }).is("archived_at", null).gte("day", today),
      ]);
      setPlanCounts({ bookings: b.count ?? 0, events: e.count ?? 0 });
    })();
  }, [sec, canManage, planTab]); // refetch when you switch tabs so badges reflect what you just did
  const LABEL: Record<OpSection, string> = { day: "My Day", now: "Now", ask: "Ask GT3", prep: "Prep", plan: "Plan", studio: "Studio", money: "Money", team: "Team" };
  const SUB: Record<OpSection, string> = {
    day: "Your tasks, your flags & what's on today.",
    now: "The live shift — sales, dispatch & the order pass.",
    ask: "Recipes, the why, gear, stock & how-to — from the GT3 playbook.",
    prep: "Stock, readiness & the pack list for what's next.",
    plan: "Notes, events, vendors & bookings.",
    studio: "Brand & marketing — draft, collaborate, schedule.",
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

      {sec === "day" && <MyDay userId={user?.id ?? null} meName={profile?.display_name?.trim() || "Me"} isLeader={canManage} />}

      {sec === "now" && (
        <>
          {canManage && <AlertsInbox userId={user?.id ?? null} />}
          <MyTasks userId={user?.id ?? null} />
          {canManage && <EventHUD />}
          {canManage && <LiveControl />}
          <EnableAlerts userId={user?.id ?? null} />
          <Kitchen />
        </>
      )}

      {sec === "ask" && <OperatorAssistant />}

      {sec === "prep" && canPrep && (
        <>
          {canManage && <ReadinessAgent />}
          {canManage && <InspectionPrep />}
          <EventPrep onGo={goSection} />
        </>
      )}

      {sec === "plan" && canManage && (
        <>
          <div className="subnav" role="tablist" aria-label="Plan">
            {/* This week — what's hot at this stage */}
            {([["calendar", "Calendar", 0], ["events", "Events", planCounts.events], ["bookings", "Bookings", planCounts.bookings], ["notes", "Notes", 0]] as const).map(([k, label, n]) => (
              <button key={k} type="button" role="tab" aria-selected={planTab === k} className={`subnav-tab${planTab === k ? " on" : ""}`} onClick={() => setPlanTab(k)}>
                {label}{n > 0 && <span className={`subnav-badge${k === "bookings" ? " hot" : ""}`}>{n}</span>}
              </button>
            ))}
            <span className="subnav-div" aria-hidden />
            {/* Back office — rarely touched */}
            {([["vendors", "Vendors"], ["reserves", "Reserves"]] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={planTab === k} className={`subnav-tab back${planTab === k ? " on" : ""}`} onClick={() => setPlanTab(k)}>{label}</button>
            ))}
          </div>
          {planTab === "calendar" && <CompanyCalendar />}
          {planTab === "notes" && <MeetingNotes />}
          {planTab === "events" && <EventsAdmin />}
          {planTab === "vendors" && <VendorsAdmin />}
          {planTab === "bookings" && <Bookings />}
          {planTab === "reserves" && <ReservesAdmin />}
        </>
      )}

      {sec === "studio" && canManage && <Studio />}

      {sec === "money" && isAdmin && (
        <>
          <MenuManager />
          <Reports />
          <SnapshotReport />
          <EventPnlReport />
          <ProductCatalog />
          <PlanEditor />
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
