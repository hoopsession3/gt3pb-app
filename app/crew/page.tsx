"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApp } from "@/components/AppProvider";
import FieldOpSheet from "@/components/FieldOpSheet";
import { useAuth, roleOf, LEADERSHIP_ROLES, type Profile } from "@/components/AuthProvider";
import { raiseAlertClient } from "@/lib/clientAlerts";
import { authedFetch } from "@/lib/authedFetch";
import { normalizeCategory, type AlertCategory } from "@/lib/alertKinds";
import { useMyAlerts, type MyFlag } from "@/lib/useMyAlerts";
import { localToday, etToday, dayKey, relativeDay } from "@/lib/dates";
import { brewStartOverdue } from "@/lib/brewMath";
import { useWorkStreams, streamOfCategory } from "@/lib/streams";
import { useRealtimeTable } from "@/lib/realtime";
import { useOperatorSection, sectionsForRole, streamGroups, SECTION_LABEL, TODAY_GROUP, type OpSection } from "@/components/OperatorNav";
import { useTaskSheet } from "@/components/TaskSheet";
import GtmCard from "@/components/GtmCard";
import { CrumbProvider, Breadcrumbs, useCrumb } from "@/components/Crumbs";
import { recordRecent } from "@/components/recents";
import { queueOrderStatus, isNetworkError, saveSnapshot, readSnapshot, readQueue, OFFLINE_EVENT } from "@/components/offline";
import { snapshotUsable } from "@/lib/offline";
import MenuRigChips, { MENU_RIG_COLUMNS, type MenuRigPatch, type MenuRigValue } from "@/components/MenuRigChips";
import TrailerLoadout from "@/components/TrailerLoadout";
import DropOps from "@/components/DropOps";
import OfficeOrders from "@/components/OfficeOrders";
import SiteCopyEditor from "@/components/SiteCopyEditor";
import OfficeSettings from "@/components/OfficeSettings";
import CopilotDirectory from "@/components/CopilotDirectory";
import AiSpend from "@/components/AiSpend";
import BroadcastEditor from "@/components/BroadcastEditor";
import MaintenanceLog from "@/components/MaintenanceLog";
import OpsPlan from "@/components/OpsPlan";
import NoteAttach from "@/components/NoteAttach";
import Goals from "@/components/Goals";
import PlanningBoard from "@/components/PlanningBoard";
import { useSiteCopy } from "@/lib/copy";
import { completeTask } from "@/lib/tasks";
import AiTraining from "@/components/AiTraining";
import PromoEditor from "@/components/PromoEditor";
import EightySix from "@/components/EightySix";
import ReviewsAdmin from "@/components/ReviewsAdmin";
import DeliveryOps from "@/components/DeliveryOps";
import PackPlan from "@/components/PackPlan";
import OrgChart from "@/components/OrgChart";
import WorkloadBoard from "@/components/WorkloadBoard";
import InviteTeammate from "@/components/InviteTeammate";
import CrmPanel from "@/components/CrmPanel";
import CodesPanel from "@/components/CodesPanel";
import CustomerKpis from "@/components/CustomerKpis";
import VipQueue from "@/components/VipQueue";
import FunnelReport from "@/components/FunnelReport";
import { TeamKpis, PrepKpis, GarageKpis } from "@/components/CrewKpis";
import PrepBoard from "@/components/PrepBoard";
import InlineCreate from "@/components/InlineCreate";
import Changelog from "@/components/Changelog";
import CommandBoard from "@/components/CommandBoard";
import FounderDigest from "@/components/FounderDigest";
import SpendBudget from "@/components/SpendBudget";
import DriverDash from "@/components/DriverDash";
import PipelinePanel from "@/components/PipelinePanel";
import GearLibrary from "@/components/GearLibrary";
import InventoryLibrary from "@/components/InventoryLibrary";
import Reports from "@/components/Reports";
import SnapshotReport from "@/components/SnapshotReport";
import EventPnlReport from "@/components/EventPnlReport";
import SignIn from "@/components/SignIn";
import InputSheet from "@/components/InputSheet";
import Sheet from "@/components/Sheet";
import { NumberRoll } from "@/components/CountUp";
import PourFill from "@/components/PourFill";
import AlertAction, { alertHasInlineAction } from "@/components/AlertAction";
import { supabase } from "@/lib/supabase";
import AskGT3 from "@/components/AskGT3";
import Studio from "@/components/Studio";
import ShootPlanner from "@/components/ShootPlanner";
import MenuManager from "@/components/MenuManager";
import PaymentSettings from "@/components/PaymentSettings";
import MoneyKpis from "@/components/MoneyKpis";
import PlanEditor from "@/components/PlanEditor";
import CompanyCalendar from "@/components/CompanyCalendar";
import EventDayPlanner from "@/components/EventDayPlanner";
import EventGenerator from "@/components/EventGenerator";
import EventPrepAI from "@/components/EventPrepAI";
import TroubleshootAI from "@/components/TroubleshootAI";
import BrewPlanner from "@/components/BrewPlanner";
import CogsCalculator from "@/components/CogsCalculator";
import AddToCalendar from "@/components/AddToCalendar";
import { calFromEvent, calFromStop } from "@/lib/ics";
import AssetMaintenance from "@/components/AssetMaintenance";
import ChiefOfStaff from "@/components/ChiefOfStaff";
import ChiefOfSales from "@/components/ChiefOfSales";
import SmartIntake from "@/components/SmartIntake";
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
import type { Stop, LiveStatus, EventRow, EventTask, BookingRequest, Order, Reserve, Subscription, Vendor, VendorLocation, MeetingNote, Alert, Comment } from "@/lib/db";
import { resolveVendor, addVendorLocation, type VendorMatch, type ResolveDecision } from "@/lib/vendorLink";
import VendorResolve from "@/components/VendorResolve";

// money helpers for the economics panels
// Per-lane phase labels: the Service lane reads as the operator's loop — Plan → Prep → Run → Delivery
// — instead of the old ad-hoc Live Ops · Readiness · Route · Delivery. Only overrides labels inside a
// given lane's toggle, so shared sections (prep/now) keep their normal names elsewhere.
const PHASE_LABEL: Record<string, Partial<Record<OpSection, string>>> = {
  service: { stops: "Schedule", prep: "Prep", now: "Run", driver: "Delivery" },
};
const usd = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const toCents = (s: string) => Math.max(0, Math.round((parseFloat(s) || 0) * 100));
const pctInt = (n: number) => Math.round(n * 100);
// local YYYY-MM-DD (not UTC) — for date inputs / "is it past due in the operator's timezone"
const localYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dueLabel = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

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

// Kitchen mounts in the Now list AND full-screen Service mode; a fixed channel name races
// removeChannel on the toggle (realtime channels are keyed by name). Unique per subscription.
let kdsChanSeq = 0;
function Kitchen() {
  const { toast } = useApp();
  const [orders, setOrders] = useState<Order[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [, setTick] = useState(0);
  const [err, setErr] = useState("");
  const [staleAt, setStaleAt] = useState(0); // >0 = board hydrated from the offline snapshot
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
    if (error) {
      // No signal on a fresh open → show the last-known board (clearly labeled) instead of an
      // error over a blank pass. Taps still work; writes queue and sync when the signal returns.
      if (!seeded.current && isNetworkError(error.message)) {
        const snap = readSnapshot<Order[]>("gt3-kds-snap");
        if (snap && snapshotUsable(snap.at, Date.now())) { setOrders(snap.data); setStaleAt(snap.at); seeded.current = true; return; }
      }
      setErr(error.message); return;
    }
    setErr(""); setStaleAt(0);
    if (data) { setOrders(data as Order[]); saveSnapshot("gt3-kds-snap", data); }
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
  // "I'm OUTSIDE" rings the pass once per order — the customer is at the window, call the name.
  const rungOutside = useRef<Set<string>>(new Set());
  const announceOutside = useCallback((row: Order) => {
    if (!seeded.current || !row.eta_status || row.eta_status !== "outside" || rungOutside.current.has(row.id)) return;
    rungOutside.current.add(row.id);
    if (!mutedRef.current) { chime(); haptic(HAPTIC.alert); }
    setFlash((p) => new Set(p).add(row.id));
    setTimeout(() => setFlash((p) => { const n = new Set(p); n.delete(row.id); return n; }), 6000);
  }, []);

  useEffect(() => {
    load();
    const tick = setInterval(() => setTick((n) => n + 1), 1000);   // live clocks/colours
    const recon = setInterval(() => load(), 15000);                // reconcile safety net
    // When the offline queue drains (OfflineChip replayed it), reconcile immediately so the
    // board swaps from optimistic/snapshot state to server truth.
    const onQueue = () => { if (readQueue().length === 0) load(); };
    window.addEventListener(OFFLINE_EVENT, onQueue);
    if (!supabase) return () => { clearInterval(tick); clearInterval(recon); window.removeEventListener(OFFLINE_EVENT, onQueue); };
    const ch = supabase
      .channel(`admin-kds-${++kdsChanSeq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (p) => {
        const row = (p.eventType === "DELETE" ? p.old : p.new) as Order;
        apply(row, p.eventType === "DELETE");
        if (p.eventType === "INSERT" && row?.status === "new") announceNew(row);
        if (p.eventType === "UPDATE" && row) announceOutside(row);
      })
      .subscribe();
    return () => { clearInterval(tick); clearInterval(recon); window.removeEventListener(OFFLINE_EVENT, onQueue); supabase?.removeChannel(ch); };
  }, [load, apply, announceNew, announceOutside]);

  // Instant: patch local state synchronously, fire the write, no refetch on success.
  const move = async (o: Order, to: Order["status"] | null) => {
    if (!to || !supabase) return;
    apply({ ...o, status: to, status_changed_at: new Date().toISOString() } as Order, false);
    haptic(HAPTIC.tap);
    // Ready = tell the customer off-app too (SMS/email, env-gated server-side). Fire-and-forget:
    // the board never waits on a notification provider.
    if (to === "ready") {
      void (async () => {
        try {
          await authedFetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "order_ready", id: o.id }) });
        } catch { /* best-effort */ }
      })();
    }
    // Definer RPC so a 'server' can advance status without table-wide write access.
    const { error } = await supabase.rpc("staff_set_order_status", { p_order: o.id, p_status: to });
    if (error) {
      // No signal ≠ stop service: keep the optimistic board, park the write for replay
      // (coalesced per order — the final state wins), and say so calmly.
      if (isNetworkError(error.message)) { queueOrderStatus(o.id, to); toast("No signal — saved, will sync", "info"); return; }
      setErr(error.message); toast(`Couldn't update — ${error.message}`, "error"); load();
    }
  };
  const advance = (o: Order) => move(o, NEXT[o.status]);
  const recall = (o: Order) => move(o, PREV[o.status]);
  const voidOrder = async (o: Order) => {
    if (typeof window !== "undefined" && !window.confirm(`Void ${o.customer ?? "this order"}? This can't be undone.`)) return;
    if (!supabase) return;
    apply(o, true);
    const { error } = await supabase.rpc("staff_set_order_status", { p_order: o.id, p_status: "void" });
    if (error) {
      if (isNetworkError(error.message)) { queueOrderStatus(o.id, "void"); toast("No signal — void saved, will sync", "info"); return; }
      setErr(error.message); toast(`Couldn't void — ${error.message}`, "error"); load();
    }
  };

  const toggle = (k: string) => setCollapsed((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleMute = () => setMuted((m) => { const v = !m; try { localStorage.setItem("kds_muted", v ? "1" : "0"); } catch { /* */ } unlockAudio(); return v; });
  const active = orders.filter((o) => o.status !== "done");
  const done = orders.filter((o) => o.status === "done").sort((a, b) => (a.status_changed_at < b.status_changed_at ? 1 : -1));
  const late = active.filter((o) => o.status !== "ready" && ageMin(o.created_at) >= 8);

  return (
    <div className="adm-sec" id="kitchen-pass">
      <div className="sec">The pass{active.length > 0 && <span className="adm-pill">{active.length} active</span>}
        <button type="button" className="kds-mute" onClick={toggleMute} aria-pressed={muted}>{muted ? "🔇 Muted" : "🔔 Sound"}</button>
      </div>

      {err && <div className="adm-attn" role="alert">Backend error: {err}</div>}
      {staleAt > 0 && (
        <div className="adm-attn" role="alert">
          <b>Offline</b> — showing the last-known board (from {ago(new Date(staleAt).toISOString())}). Taps still work and will sync when the signal returns.
        </div>
      )}
      {late.length > 0 && (
        <div className="adm-attn" role="alert">
          <b>{late.length} guest{late.length === 1 ? "" : "s"}</b> past 8 min — step over and reassure.
        </div>
      )}

      <div aria-live="polite">
        {STAGES.map((st) => {
          const list = orders.filter((o) => o.status === st.key);
          const isCol = collapsed.has(st.key);
          return (
            <div className="kds-stage" key={st.key}>
              <button type="button" className="kds-stage-h" onClick={() => toggle(st.key)} aria-expanded={!isCol}>
                <span className={`kds-caret${isCol ? " col" : ""}`} aria-hidden="true">›</span>
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
                    {o.eta_status && (
                      <span className={`kds-eta ${o.eta_status}`}>
                        {o.eta_status === "outside" ? "📍 OUTSIDE — call the name" : o.eta_status === "on_way" ? "🏃 On the way" : "⏰ Running late"}
                      </span>
                    )}
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
              <span className={`kds-caret${!doneOpen ? " col" : ""}`} aria-hidden="true">›</span>
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

// ───────────────────────── service pulse: the glance before the work ─────────────────────────
// Now doesn't render the boards anymore — it renders their PULSE. One hero button carries the
// live counts (orders on the pass, items 86'd) and opens Service mode, where the work happens.
function ServicePulse({ onEnter }: { onEnter: () => void }) {
  const [pass, setPass] = useState<number | null>(null);
  const [out, setOut] = useState(0);
  const load = useCallback(async () => {
    if (!supabase) return;
    const [o, p] = await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }).neq("status", "void").neq("status", "done"),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("active", true).eq("sold_out", true),
    ]);
    if (o.count !== null) setPass(o.count);
    if (p.count !== null) setOut(p.count);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["orders", "products"], load);
  return (
    <button type="button" className={`svc-enter${(pass ?? 0) > 0 ? " hot" : ""}`} onClick={onEnter}>
      <span className="svc-enter-t">▶ The Pass</span>
      <span className="svc-enter-s">
        {pass === null ? "The pass, pickups & the 86 board — one screen"
          : <>{pass > 0 ? <><b><NumberRoll value={pass} ms={450} /></b> on the pass</> : "The pass is clear"}{out > 0 && <> · <b><NumberRoll value={out} ms={450} /></b> 86&rsquo;d</>} — tap to work</>}
      </span>
    </button>
  );
}

// ───────────────────────── alerts: the "don't-miss" spine ─────────────────────────
// Leadership tier comes from the one shared definition (AuthProvider) — the audit found this list
// re-typed seven ways with drift. Alerts themselves are staff-wide since 0157.
const isLeader = (role: string | null | undefined) => (LEADERSHIP_ROLES as readonly string[]).includes(role ?? "");

// Raise an alert. The INSERT is the whole contract — the alerts_push_fanout trigger (0157)
// delivers push + Teams for every row, same as the server and pg_cron producers. Category is the
// closed lib/alertKinds vocabulary, so misrouted "Open →" buttons are a type error now.
// ONE alert producer (lib/clientAlerts) — this shim keeps the crew page's historical call shape but
// delegates to the shared helper, so the payload can never drift from every other surface again.
async function raiseAlert(a: {
  severity?: "critical" | "important" | "fyi"; category: AlertCategory; title: string;
  body?: string; link?: string; target_user_id?: string | null; created_by?: string | null;
  kind?: string; subject_id?: string | null; // 0174 action contract
}) {
  return raiseAlertClient({
    severity: a.severity ?? "important", category: a.category, title: a.title,
    body: a.body, link: a.link ?? "/crew", targetUserId: a.target_user_id,
    kind: a.kind, subjectId: a.subject_id ?? undefined, createdBy: a.created_by,
  });
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

// Where an alert lives — route it to the screen that owns it, so you can act on it immediately.
// Reservation alerts don't route at all: callers pop the drop sheet (DropOps) in place instead,
// so "Open" always visibly does something even when the alert's home is the screen you're on.
function alertIsReservation(title: string | null | undefined): boolean {
  return /reservation/i.test(title || "");
}
function alertDest(category: string | null | undefined, title?: string | null): { section: OpSection; planTab?: string; anchor?: string } {
  // normalizeCategory folds the legacy vocabulary (orders/billing/assignment/note/…) into the
  // closed set, so historic rows route correctly too. The audit found the old router matched
  // "order" (which nothing emitted) while every real order ping fell through to My Day.
  const cat = normalizeCategory(category);
  if (cat === "order") return { section: "now", anchor: "kitchen-pass" };  // land ON the pass, even from the pass screen
  if (cat === "money") return { section: "money" };
  if (cat === "brew") return { section: "brew" };
  if (cat === "booking") return { section: "pipeline" };
  if (cat === "prep") return { section: "prep" };
  if (cat === "content" && !/content ready for review/i.test(title || "")) return { section: "studio" };
  if (cat === "strategy") return { section: "goals" };
  return { section: "day" }; // task + system → My Day (tasks live there)
}
// After a section switch React needs a beat to mount the destination before we can scroll to it.
function scrollToAnchor(anchor?: string) {
  if (!anchor) return;
  setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
}

// Content-review alerts are handled IN PLACE (like reservations) — no jump to the noisy calendar.
function alertIsContentReview(title: string | null | undefined): boolean {
  return /content ready for review/i.test(title || "");
}
function postIdFromLink(link: string | null | undefined): string | null {
  const m = /[?&]post=([a-f0-9-]{6,})/i.exec(link || "");
  return m ? m[1] : null;
}

// Pop-out sheet to approve or revise a post right from the notification. Edit the caption, approve
// (saves the edit), or request changes with a note. Acting notifies the creator and clears the alert.
function ContentApprovalSheet({ contentId, meName, meId, onClose, onActioned }: { contentId: string; meName: string; meId: string | null; onClose: () => void; onActioned: () => void }) {
  const { toast } = useApp();
  type Post = { id: string; title: string; caption: string | null; hashtags: string[] | null; status: string; kind: string; channel: string; created_by: string | null };
  const [item, setItem] = useState<Post | null>(null);
  const [caption, setCaption] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    supabase.from("content_items").select("id, title, caption, hashtags, status, kind, channel, created_by").eq("id", contentId).maybeSingle()
      .then(({ data }) => { if (data) { setItem(data as Post); setCaption((data as Post).caption || ""); } });
  }, [contentId]);

  const decide = async (status: "approved" | "changes") => {
    if (!supabase || busy) return;
    if (status === "changes" && !note.trim()) { toast("Add a quick note on what to change", "error"); return; }
    setBusy(true);
    const patch: Record<string, unknown> = { status };
    if (caption !== (item?.caption ?? "")) patch.caption = caption;           // revise inline
    if (status === "changes") patch.review_note = note.trim();
    await supabase.from("content_items").update(patch).eq("id", contentId);
    const t = (item?.title || "Untitled").slice(0, 80);
    if (item?.created_by && item.created_by !== meId) {
      await raiseAlert(status === "approved"
        ? { severity: "fyi", category: "content", kind: "content_approved", subject_id: contentId, title: `✅ Approved — ${t}`.slice(0, 180), body: `${meName} approved "${t}". Ready to schedule/publish.`.slice(0, 300), link: `/crew?post=${contentId}`, target_user_id: item.created_by }
        : { severity: "important", category: "content", kind: "content_changes", subject_id: contentId, title: `✏️ Changes requested — ${t}`.slice(0, 180), body: note.trim().slice(0, 300), link: `/crew?post=${contentId}`, target_user_id: item.created_by });
    }
    setBusy(false);
    toast(status === "approved" ? "Approved" : "Changes requested");
    onActioned(); // acks the review alert so it clears
  };

  return (
    <Sheet open onClose={onClose} header={<div style={{ display: "flex", alignItems: "center" }}><span>Review post</span><button type="button" className="drop-sheet-x" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close">✕</button></div>}>
        {!item ? <div className="dops-empty"><PourFill size={38} label="Pulling it up…" /></div> : (
          <div className="capprove">
            <div className="capprove-meta">{item.kind} · {item.channel}{item.status ? ` · ${item.status}` : ""}</div>
            <div className="capprove-t">{item.title}</div>
            <label className="prod-f"><span>Caption — edit here to revise</span><textarea rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} /></label>
            {item.hashtags?.length ? <div className="capprove-tags">{item.hashtags.map((h) => `#${h}`).join(" ")}</div> : null}
            <input className="ev-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What to change (only if requesting changes)" />
            <div className="capprove-acts">
              <button type="button" className="oa-cta" disabled={busy} onClick={() => decide("approved")}>{busy ? "…" : "✓ Approve"}</button>
              <button type="button" className="studio-act" disabled={busy} onClick={() => decide("changes")}>Request changes</button>
            </div>
            <p className="insp-foot">Approving saves your caption edits. Once you act, this alert clears.</p>
          </div>
        )}
    </Sheet>
  );
}

// Pop-out card for reservation alerts — the full DropOps manager (brew totals, pickup checklist,
// bottles-in toggles) in a centered sheet, so a flag can be handled without leaving the screen.
function DropSheet({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth();
  const canPlan = (profile?.is_admin ?? false) || ["owner", "admin", "event_manager"].includes(profile?.role ?? "");
  return (
    <Sheet open onClose={onClose} header={<div style={{ display: "flex", alignItems: "center" }}><span>This week&rsquo;s drop</span><button type="button" className="drop-sheet-x" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close">✕</button></div>}>
        <DropOps canPlan={canPlan} />
        <button type="button" className="drop-sheet-done" onClick={onClose}>Done</button>
    </Sheet>
  );
}

// The "don't-miss" inbox — unacknowledged alerts for me (or all-leadership), critical first.
// Realtime, so a new alert lands at the top of the Now screen the instant it's raised.
// Notification management (0177) — mute a category's non-critical pings, set a quiet window. Own-row
// prefs, realtime. Criticals always come through; this only quiets the rest.
const NOTIF_CATS: { key: string; label: string }[] = [
  { key: "order", label: "Orders & the pass" },
  { key: "money", label: "Money & refunds" },
  { key: "brew", label: "Brew ladder" },
  { key: "prep", label: "Prep & tasks" },
  { key: "content", label: "Studio / content" },
  { key: "strategy", label: "Pipeline & strategy" },
];
function NotifPrefsSheet({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const { toast } = useApp();
  const [muted, setMuted] = useState<string[]>([]);
  const [qs, setQs] = useState<string>("");
  const [qe, setQe] = useState<string>("");
  useEffect(() => {
    if (!supabase || !userId) return;
    supabase.from("notif_prefs").select("muted_categories, quiet_start, quiet_end").eq("user_id", userId).maybeSingle()
      .then(({ data }) => { const p = data as { muted_categories?: string[]; quiet_start?: number | null; quiet_end?: number | null } | null; if (p) { setMuted(p.muted_categories ?? []); setQs(p.quiet_start != null ? String(p.quiet_start) : ""); setQe(p.quiet_end != null ? String(p.quiet_end) : ""); } });
  }, [userId]);
  const save = async (nextMuted: string[], nqs: string, nqe: string) => {
    if (!supabase || !userId) return;
    await supabase.from("notif_prefs").upsert({ user_id: userId, muted_categories: nextMuted,
      quiet_start: nqs === "" ? null : Math.max(0, Math.min(23, parseInt(nqs, 10) || 0)),
      quiet_end: nqe === "" ? null : Math.max(0, Math.min(23, parseInt(nqe, 10) || 0)), updated_at: new Date().toISOString() });
  };
  const toggle = (k: string) => { const next = muted.includes(k) ? muted.filter((x) => x !== k) : [...muted, k]; setMuted(next); save(next, qs, qe); };
  return (
    <Sheet open onClose={onClose} label="Notifications" header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>Notifications</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close">✕</button></div>}>
      <p className="h-sub" style={{ marginTop: 0 }}>Quiet the categories you don&rsquo;t need. Critical alerts always come through.</p>
      <div className="notif-cats">
        {NOTIF_CATS.map((c) => (
          <button key={c.key} type="button" className={`notif-cat${muted.includes(c.key) ? " muted" : ""}`} onClick={() => toggle(c.key)} aria-pressed={muted.includes(c.key)}>
            <span>{c.label}</span><span className="notif-cat-s">{muted.includes(c.key) ? "🔕 Muted" : "🔔 On"}</span>
          </button>
        ))}
      </div>
      <div className="notif-quiet">
        <span className="adm-prep-label">Quiet hours (optional)</span>
        <p className="h-sub" style={{ margin: "0 0 8px" }}>During these hours, non-critical alerts are held into a morning digest instead of pinging you — they surface on their own when quiet hours end. Critical alerts always come through.</p>
        <div className="notif-quiet-r">
          <label>From<input inputMode="numeric" placeholder="22" value={qs} onChange={(e) => setQs(e.target.value)} onBlur={() => { save(muted, qs, qe); toast("Saved"); }} /></label>
          <label>to<input inputMode="numeric" placeholder="7" value={qe} onChange={(e) => setQe(e.target.value)} onBlur={() => { save(muted, qs, qe); toast("Saved"); }} /></label>
          <span className="notif-quiet-h">hour of day, 0&ndash;23</span>
        </div>
      </div>
    </Sheet>
  );
}

function AlertsInbox({ userId, compact = false, title = "Alerts" }: { userId: string | null; compact?: boolean; title?: string }) {
  const { profile } = useAuth();
  const { setSection } = useOperatorSection();
  const meName = profile?.display_name?.trim() || "Me";
  // One source of truth for "what needs me" — the same hook drives My Day's flags and the nav
  // badge, so the three counters that used to disagree now agree by construction. Ack semantics
  // live in the hook: row-ack for targeted alerts, per-user read for broadcasts (0157).
  const { flags: mine, held, quietActive, critCount: crit, ack, clearAll, clearHeld, snooze } = useMyAlerts(userId);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [digestOpen, setDigestOpen] = useState(false);
  const streams = useWorkStreams();
  const myLane = (cat: string | null) => streams.some((s) => s.owner_user_id === userId && s.categories.includes(normalizeCategory(cat)));
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const loadCounts = useCallback(async () => { setCounts(await commentCounts("alert_id", mine.map((r) => r.id))); }, [mine]);
  useEffect(() => { loadCounts(); }, [loadCounts]);
  useRealtimeTable("comments", loadCounts);
  // Respond immediately: reservation alerts pop the drop sheet right here; everything else jumps
  // to the screen that owns it.
  const [dropSheet, setDropSheet] = useState(false);
  const [reviewPost, setReviewPost] = useState<{ id: string; alert: MyFlag } | null>(null);
  const gotoAlert = (a: MyFlag) => {
    if (alertIsReservation(a.title)) { setDropSheet(true); return; }
    if (alertIsContentReview(a.title)) { const pid = postIdFromLink(a.link); if (pid) { setReviewPost({ id: pid, alert: a }); return; } }
    const d = alertDest(a.category, a.title);
    if (d.planTab) { try { localStorage.setItem("gt3-plan-tab", d.planTab); } catch { /* ignore */ } }
    setSection(d.section);
    scrollToAnchor(d.anchor);
  };

  if (mine.length === 0 && held.length === 0) return null;
  const rank = (s: string) => (s === "critical" ? 0 : s === "important" ? 1 : 2);
  const sorted = [...mine].sort((a, b) => rank(a.severity) - rank(b.severity));

  // Compact strip (used in Now) — alerts have ONE home, the My Day inbox. During service Now shows
  // just a one-line pointer so the same cards don't render in two places; tap jumps to My Day.
  if (compact) {
    if (mine.length === 0) return null;   // during quiet hours the held digest stays off the service strip
    return (
      <button type="button" className={`alerts-strip${crit ? " crit" : ""}`} onClick={() => setSection("day")}>
        <span className="alerts-strip-i" aria-hidden>{crit ? "⚠️" : "🔔"}</span>
        <span className="alerts-strip-t"><b>{mine.length} {mine.length === 1 ? "alert needs" : "alerts need"} you</b>{crit ? ` · ${crit} critical` : ""}</span>
        <span className="alerts-strip-go">Open in My Day →</span>
      </button>
    );
  }

  return (
    <div className="adm-sec">
      {dropSheet && <DropSheet onClose={() => setDropSheet(false)} />}
      {reviewPost && <ContentApprovalSheet contentId={reviewPost.id} meName={meName} meId={userId} onClose={() => setReviewPost(null)} onActioned={() => { ack(reviewPost.alert); setReviewPost(null); }} />}
      <div className="sec">{title} {mine.length > 0 && <span className={`adm-pill${crit ? " due" : ""}`}>{mine.length}{crit ? ` · ${crit} critical` : ""}</span>}{mine.length > 1 && <button type="button" className="alert-clearall" onClick={() => clearAll()}>Clear all</button>}<button type="button" className="alert-prefs-btn" onClick={() => setPrefsOpen(true)} aria-label="Notification settings">⚙</button></div>
      {prefsOpen && <NotifPrefsSheet userId={userId} onClose={() => setPrefsOpen(false)} />}

      {/* Quiet-hours digest (0177 + S·5b): non-criticals that arrived during your quiet window are
          held off the glance and gathered here — the morning digest. They surface on their own when
          quiet hours end; review or clear them anytime. Criticals never land here. */}
      {held.length > 0 && (
        <div className="digest">
          <button type="button" className="digest-head" onClick={() => setDigestOpen((v) => !v)} aria-expanded={digestOpen}>
            <span className="digest-i" aria-hidden>🌙</span>
            <span className="digest-t"><b>Quiet hours</b> · {held.length} held · surfaces when quiet hours end</span>
            <span className="digest-x">{digestOpen ? "Hide" : "Review"}</span>
          </button>
          {digestOpen && (
            <div className="digest-body">
              {held.map((a) => (
                <div key={a.id} className={`digest-item sev-${a.severity}`}>
                  <button type="button" className="digest-item-go" onClick={() => gotoAlert(a)}>
                    <span className="digest-item-t">{a.title}</span>
                    {a.body && <span className="digest-item-b">{a.body}</span>}
                  </button>
                  <button type="button" className="digest-item-x" onClick={() => ack(a)} aria-label={`Dismiss ${a.title}`}>✕</button>
                </div>
              ))}
              <button type="button" className="digest-clear" onClick={() => clearHeld()}>Mark all read</button>
            </div>
          )}
        </div>
      )}

      {sorted.map((a) => (
        <div key={a.id} className={`alert sev-${a.severity}`}>
          <div className="alert-row">
            <div className="alert-main">
              <span className="alert-title">{a.title}{myLane(a.category) && <span className="myday-lane">your lane</span>}</span>
              {a.body && <span className="alert-body">{a.body}</span>}
            </div>
            {counts[a.id] ? <button type="button" className="alert-discuss" onClick={() => setOpenThread(openThread === a.id ? null : a.id)} aria-label="Discuss">💬<span className="cmt-count">{counts[a.id]}</span></button> : null}
            <button type="button" className={alertHasInlineAction(a.kind) ? "alert-open ghost" : "alert-open"} onClick={() => gotoAlert(a)}>{alertHasInlineAction(a.kind) ? "Open" : "Open →"}</button>
            {a.severity !== "critical" && <button type="button" className="alert-snz" onClick={() => snooze(a, new Date(Date.now() + 3600_000))} aria-label="Snooze 1 hour" title="Snooze 1 hour">⏰</button>}
            <button type="button" className="alert-ack" onClick={() => ack(a)} aria-label="Got it">✓</button>
          </div>
          {alertHasInlineAction(a.kind) && <AlertAction flag={a} meId={userId} onResolved={() => ack(a)} />}
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
  }, [load]);
  useRealtimeTable({ table: "comments", filter: `${subject.col}=eq.${subject.id}` }, load);

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
      severity: "important", category: "task", kind: `thread_reply_${subject.col === "event_task_id" ? "task" : subject.col === "meeting_note_id" ? "note" : "alert"}`, subject_id: subject.id,
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
  goals: { title: string | null } | null;
  source?: "event" | "todo";      // 'todo' rows are delegated to-dos (0210) folded into one plate
  category?: string | null;       // todos carry a category instead of an event/goal parent
};

// MY DAY — the personal rollup: what's on today, the flags & pings aimed at YOU (alerts targeted
// to your user), and your assigned tasks. The home base "where do my flags go?" answer.
// OWNER DETAILS — the identity (name, date, place, status) of an event or stop, editable inline so the
// prep view is the single place to manage the thing end to end — no hopping to the calendar or Live
// truck to change a name or date. Self-contained; works for events or stops. (Go-live + GPS stay in
// Now ▸ Live truck, which owns the broadcast.)
function OwnerDetails({ ownerType, ownerId, isAdmin, onSaved, onRemoved }: { ownerType: "event" | "stop"; ownerId: string; isAdmin: boolean; onSaved: (name: string) => void; onRemoved: () => void }) {
  const { toast } = useApp();
  const isEvent = ownerType === "event";
  const table = isEvent ? "events" : "stops";
  // recap now lives on the staff-only sibling (event_ops / stop_ops, 0181), off the public row.
  const opsTable = isEvent ? "event_ops" : "stop_ops";
  const opsKey = isEvent ? "event_id" : "stop_id";
  const nameCol = isEvent ? "title" : "name";
  const what = isEvent ? "event" : "truck stop";
  const [f, setF] = useState<Record<string, string | null> | null>(null);
  const [edit, setEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wrapping, setWrapping] = useState(false); // capturing the after-action to complete an event
  const [recap, setRecap] = useState("");
  const [dupWarn, setDupWarn] = useState<string | null>(null);
  // Per-stop order-ahead / pickup (0191) — kept out of `f` so the boolean/number types stay clean.
  const [oa, setOa] = useState(false);
  const [pk, setPk] = useState(false);
  const [lead, setLead] = useState("");
  // What starts_at was when loaded — if a save CHANGES the schedule, the stale hand-set
  // when/time labels are cleared so guests see the new time (same rule as FieldOpSheet).
  const origStartsAt = useRef<string | null>(null);

  // Remove from the active lists (keeps the record, reversible). The standard "delete" for a real
  // event/stop — same as the calendar's Remove and Live truck's Archive.
  const archive = async () => {
    if (!supabase) return;
    if (typeof window !== "undefined" && !window.confirm(`Archive this ${what}?\n\nIt comes off the active lists (calendar, prep, route) but the record is kept — you can restore it.`)) return;
    setSaving(true);
    await supabase.from(table).update({ archived_at: new Date().toISOString() }).eq("id", ownerId);
    setSaving(false); toast(`${isEvent ? "Event" : "Stop"} archived`); onRemoved();
  };
  // Hard delete — gone for good, plus its prep, schedule, crew, links (FK cascade).
  const del = async () => {
    if (!supabase) return;
    if (typeof window !== "undefined" && !window.confirm(`DELETE this ${what} for good?\n\nThis permanently removes it AND its prep list, schedule, crew, and brew links. This can't be undone. (Use Archive instead if you just want it off the lists.)`)) return;
    setSaving(true);
    const { error } = await supabase.from(table).delete().eq("id", ownerId);
    setSaving(false);
    if (error) { toast(`Couldn't delete — ${error.message}`, "error"); return; }
    toast(`${isEvent ? "Event" : "Stop"} deleted`); onRemoved();
  };

  // Change the item's TYPE (event ↔ truck stop). They're separate tables, so this re-creates the row
  // in the target table with the shared fields (name, date, location, vendor, buffer) and archives the
  // original — the fix for "I picked the wrong type." Prep lists / brew links stay with the archived
  // copy (they'd need re-pointing across tables), so this is cleanest right after creation.
  const convertType = async () => {
    if (!supabase) return;
    const toEvent = !isEvent;
    const toLabel = toEvent ? "event" : "truck stop";
    if (typeof window !== "undefined" && !window.confirm(`Change this ${what} into a ${toLabel}?\n\nIt's re-created as a ${toLabel} with the same name, date, location & vendor. The original is archived — any prep list or brew links stay with the archived copy.`)) return;
    setSaving(true);
    const { data: src } = await supabase.from(table).select("*").eq("id", ownerId).maybeSingle();
    const s = (src as Record<string, unknown>) ?? {};
    let error = null;
    if (toEvent) {
      const day = s.starts_at ? new Date(String(s.starts_at)).toLocaleDateString("en-CA") : null;
      const r = await supabase.from("events").insert({ title: String(s.name || "Event"), day, location_text: (s.location_text as string) ?? null, category: "event", vendor_id: (s.vendor_id as string) ?? null, default_buffer_min: (s.default_buffer_min as number) ?? null }).select("id").single();
      error = r.error;
    } else {
      const startsAt = s.day ? new Date(`${String(s.day)}T11:00:00`).toISOString() : null;
      const r = await supabase.from("stops").insert({ name: String(s.title || "Stop"), starts_at: startsAt, location_text: (s.location_text as string) ?? null, status: "upcoming", vendor_id: (s.vendor_id as string) ?? null, default_buffer_min: (s.default_buffer_min as number) ?? null, sort: 0 }).select("id").single();
      error = r.error;
    }
    if (error) { setSaving(false); toast(`Couldn't convert — ${error.message}`, "error"); return; }
    await supabase.from(table).update({ archived_at: new Date().toISOString() }).eq("id", ownerId);
    setSaving(false); toast(`Changed to ${toLabel} — the original is archived`); onRemoved();
  };

  // Complete (wrap) an event OR a stop: mark it done, stamp when, and file the after-action.
  // Optionally archive it off the active lists in the same move. DB triggers keep the world
  // consistent: a completed event can't stay is_live, and completing the live STOP takes the
  // truck offline (0125).
  const complete = async (alsoArchive: boolean) => {
    if (!supabase) return;
    setSaving(true);
    const now = new Date().toISOString();
    const patch: Record<string, string | boolean | null> = isEvent
      ? { stage: "done", completed_at: now, is_live: false }
      : { status: "done", completed_at: now };
    if (alsoArchive) patch.archived_at = now;
    const { error } = await supabase.from(table).update(patch).eq("id", ownerId);
    // recap lives on the staff-only ops sibling now — write it there (best-effort; the completion
    // status is the important part, and it already committed above).
    await supabase.from(opsTable).upsert({ [opsKey]: ownerId, recap: recap.trim() || null }, { onConflict: opsKey });
    setSaving(false);
    if (error) { toast(`Couldn't complete — ${error.message}`, "error"); return; }
    setWrapping(false);
    toast(alsoArchive ? `${isEvent ? "Event" : "Stop"} completed + archived` : `${isEvent ? "Event" : "Stop"} completed — nice work`);
    if (alsoArchive) { onRemoved(); return; }
    setF((p) => ({ ...(p ?? {}), ...(isEvent ? { stage: "done" } : { status: "done" }), completed_at: now, recap: recap.trim() || null }));
  };

  const load = useCallback(async () => {
    if (!supabase) return;
    // recap moved to the staff-only ops sibling (event_ops / stop_ops, 0181); the per-stop order-ahead
    // columns stay on the public stop row. Fetch both in parallel and merge so the UI is unchanged.
    const sel = isEvent ? "title, day, location_text, stage, default_buffer_min, completed_at" : "name, starts_at, location_text, address, status, default_buffer_min, completed_at, order_ahead_enabled, pickup_enabled, order_ahead_lead_min";
    const [{ data }, { data: ops }] = await Promise.all([
      supabase.from(table).select(sel).eq("id", ownerId).maybeSingle(),
      supabase.from(opsTable).select("recap").eq(opsKey, ownerId).maybeSingle(),
    ]);
    const d = (data as unknown as Record<string, unknown>) ?? {};
    setF({ ...(d as Record<string, string | null>), recap: (ops as { recap?: string | null } | null)?.recap ?? null });
    if (!isEvent) { origStartsAt.current = (d.starts_at as string | null) ?? null; setOa(!!d.order_ahead_enabled); setPk(!!d.pickup_enabled); setLead(d.order_ahead_lead_min != null ? String(d.order_ahead_lead_min) : ""); }
  }, [table, opsTable, opsKey, ownerId, isEvent]);
  useEffect(() => { load(); }, [load]);

  const set = (k: string, v: string | null) => setF((p) => ({ ...(p ?? {}), [k]: v }));
  // date <-> column: events.day is a plain date; stops.starts_at is a timestamp (preserve time of day)
  const dateVal = !f ? "" : isEvent ? (f.day || "") : (f.starts_at ? new Date(f.starts_at).toLocaleDateString("en-CA") : "");
  const onDate = (v: string) => {
    if (isEvent) { set("day", v || null); return; }
    if (!v) { set("starts_at", null); return; }
    const old = f?.starts_at ? new Date(f.starts_at) : null;
    const hh = old ? `${String(old.getHours()).padStart(2, "0")}:${String(old.getMinutes()).padStart(2, "0")}` : "11:00";
    set("starts_at", new Date(`${v}T${hh}:00`).toISOString());
  };
  // Start time — stops carry a real timestamp; this finally lets you SET the time of day, not just the date.
  const timeVal = !f || isEvent || !f.starts_at ? "" : (() => { const d = new Date(f.starts_at); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; })();
  // Same-day-same-place guard — warn (never block) if another ACTIVE event OR stop already sits at
  // this location on this date. Events and stops live in two tables, so it checks both; this is the
  // common "did I already make this?" duplicate the two-table split makes easy to miss.
  const locKey = (f?.location_text ?? "").trim();
  useEffect(() => {
    if (!supabase || !edit || !locKey || !dateVal) { setDupWarn(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const [{ data: evs }, { data: sts }] = await Promise.all([
          supabase.from("events").select("id, title").is("archived_at", null).eq("day", dateVal).ilike("location_text", locKey),
          supabase.from("stops").select("id, name").is("archived_at", null).ilike("location_text", locKey).gte("starts_at", `${dateVal}T00:00:00`).lte("starts_at", `${dateVal}T23:59:59`),
        ]);
        if (cancelled) return;
        const other = [
          ...((evs as { id: string; title: string }[]) ?? []).filter((e) => e.id !== ownerId).map((e) => e.title || "an event"),
          ...((sts as { id: string; name: string }[]) ?? []).filter((s) => s.id !== ownerId).map((s) => s.name || "a stop"),
        ][0];
        setDupWarn(other ? `“${other}” is already at ${locKey} that day — same place, same date. Duplicate?` : null);
      } catch { setDupWarn(null); }
    })();
    return () => { cancelled = true; };
  }, [edit, locKey, dateVal, ownerId]);
  const onTime = (v: string) => {
    if (isEvent || !v) return;
    const dayKey = f?.starts_at ? new Date(f.starts_at).toLocaleDateString("en-CA") : new Date().toLocaleDateString("en-CA");
    set("starts_at", new Date(`${dayKey}T${v}:00`).toISOString());
  };

  const save = async () => {
    if (!supabase || !f) return;
    setSaving(true);
    const nm = (f[nameCol] || "").trim() || (isEvent ? "Event" : "Stop");
    const buf = f.default_buffer_min != null && String(f.default_buffer_min).trim() !== "" ? Math.max(0, Number(f.default_buffer_min)) : null;
    const patch: Record<string, string | number | boolean | null> = isEvent
      ? { title: nm, day: f.day || null, location_text: f.location_text?.trim() || null, stage: f.stage || "confirmed", default_buffer_min: buf }
      : { name: nm, starts_at: f.starts_at || null, location_text: f.location_text?.trim() || null, address: f.address?.trim() || null, status: f.status || "upcoming", default_buffer_min: buf,
          order_ahead_enabled: oa, pickup_enabled: pk, order_ahead_lead_min: oa && lead.trim() !== "" ? Math.max(0, Number(lead)) : null };
    // For stops, geocode the address (or location) so it pins on the map + customer directions work.
    if (!isEvent) {
      // schedule changed → derived values must beat stale hand-set labels on the guest page
      if ((f.starts_at || null) !== origStartsAt.current) { patch.when_label = null; patch.time_label = null; }
      const q = (f.address?.trim() || f.location_text?.trim() || "");
      if (q) { const g = await geocode(q).catch(() => null); if (g) { patch.lat = g.lat; patch.lng = g.lng; } }
    }
    const { error } = await supabase.from(table).update(patch).eq("id", ownerId);
    setSaving(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    setEdit(false); onSaved(nm); toast(isEvent ? "Details saved" : "Saved — address pinned on the map");
  };

  if (!f) return null;
  if (!edit) {
    const date = dateVal ? new Date(`${dateVal}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "No date set";
    const place = f.location_text || f.address || "";
    const status = isEvent ? f.stage : f.status;
    const cal = isEvent
      ? calFromEvent({ id: ownerId, title: f.title ?? "", day: f.day ?? null, location_text: f.location_text })
      : calFromStop({ id: ownerId, name: f.name ?? "", starts_at: f.starts_at ?? null, location_text: f.location_text, address: f.address });
    const STAGE_LABEL: Record<string, string> = { lead: "Lead", confirmed: "Confirmed", prep: "Prep", live: "Live", done: "Done", upcoming: "Upcoming" };
    const done = f.completed_at != null || (isEvent ? f.stage === "done" : f.status === "done");
    return (
      <div className="ownerdet">
        <span className="ownerdet-meta">📅 {date}{place ? ` · 📍 ${place}` : ""}</span>
        <div className="ownerdet-life">
          <span className={`ownerdet-stage st-${status ?? (isEvent ? "confirmed" : "upcoming")}`}>{STAGE_LABEL[status ?? ""] ?? status}</span>
          {done ? (
            <span className="ownerdet-completed">✓ Completed{f.completed_at ? ` ${new Date(f.completed_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}</span>
          ) : isAdmin ? (
            <button type="button" className="ownerdet-complete" onClick={() => { setRecap(f.recap ?? ""); setWrapping((w) => !w); }}>✓ Complete {isEvent ? "event" : "stop"}</button>
          ) : null}
        </div>
        {wrapping && (
          <div className="ownerdet-wrap">
            <div className="ownerdet-wrap-lbl">After-action <span>optional — what sold, what ran short, one change for next time</span></div>
            <textarea className="note-in" rows={3} value={recap} onChange={(e) => setRecap(e.target.value)} placeholder="e.g. Rise + Tide sold out by noon; ran short on ice; bring a second cooler next time." />
            <div className="ownerdet-wrap-actions">
              <button type="button" className="ownerdet-complete" onClick={() => complete(false)} disabled={saving}>Mark complete</button>
              <button type="button" className="ownerdet-arch" onClick={() => complete(true)} disabled={saving}>Complete &amp; archive</button>
              <button type="button" className="ownerdet-cancel" onClick={() => setWrapping(false)} disabled={saving}>Cancel</button>
            </div>
          </div>
        )}
        {done && f.recap && !wrapping && <div className="ownerdet-recap"><b>Recap</b> {f.recap}{isAdmin && <button type="button" className="ownerdet-recap-edit" onClick={() => { setRecap(f.recap ?? ""); setWrapping(true); }}>edit</button>}</div>}
        <AddToCalendar ev={cal} defaultBuffer={Number(f.default_buffer_min) || 0} />
        {isAdmin && <button type="button" className="ownerdet-edit" onClick={() => setEdit(true)}>Edit details</button>}
      </div>
    );
  }
  return (
    <div className="ownerdet editing">
      <input className="note-in" value={f[nameCol] ?? ""} onChange={(e) => set(nameCol, e.target.value)} placeholder={isEvent ? "Event name" : "Stop name"} />
      <div className="ownerdet-typehint">{isEvent
        ? "📅 Event — a booked gig with prep, a crew & a run-of-show. (A quick roll-up-and-serve visit is a Truck stop.)"
        : "📍 Truck stop — you roll up, serve, and leave. (A booked gig with prep & crew should be an Event.)"}</div>
      {dupWarn && <div className="ownerdet-warn" role="status">⚠ {dupWarn}</div>}
      <div className="prod-grid" style={{ marginTop: 8 }}>
        <label className="prod-f"><span>Date</span><input type="date" value={dateVal} onChange={(e) => onDate(e.target.value)} /></label>
        {isEvent
          ? <label className="prod-f"><span>Location</span><input value={f.location_text ?? ""} onChange={(e) => set("location_text", e.target.value)} placeholder="Where" /></label>
          : <label className="prod-f"><span>Start time</span><input type="time" value={timeVal} onChange={(e) => onTime(e.target.value)} /></label>}
      </div>
      {!isEvent && <label className="prod-f" style={{ marginTop: 8 }}><span>Where</span><input value={f.location_text ?? ""} onChange={(e) => set("location_text", e.target.value)} placeholder="Where" /></label>}
      {!isEvent && <label className="prod-f" style={{ marginTop: 8 }}><span>Address (tap-to-map)</span><input value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} placeholder="123 Peach St, Atlanta GA" /></label>}
      <label className="prod-f" style={{ marginTop: 8 }}><span>Status</span>
        {isEvent ? (
          <select value={f.stage ?? "confirmed"} onChange={(e) => set("stage", e.target.value)}>
            <option value="lead">Lead</option><option value="confirmed">Confirmed</option><option value="prep">Prep</option><option value="live">Live</option><option value="done">Done</option>
          </select>
        ) : (
          <select value={f.status ?? "upcoming"} onChange={(e) => set("status", e.target.value)}>
            <option value="upcoming">Upcoming</option><option value="done">Done</option>
          </select>
        )}
      </label>
      <label className="prod-f" style={{ marginTop: 8 }}><span>Calendar buffer (min) — travel + setup blocked before service</span><input type="number" min={0} step={15} value={f.default_buffer_min ?? ""} onChange={(e) => set("default_buffer_min", e.target.value)} placeholder="e.g. 90" /></label>
      {!isEvent && (
        <div className="oa-set">
          <div className="oa-set-h">Ordering at this stop</div>
          <div className="oa-toggles">
            <button type="button" role="switch" aria-checked={oa} className={`oa-toggle${oa ? " on" : ""}`} onClick={() => setOa((v) => !v)}>🕐 Order ahead<span>{oa ? "On" : "Off"}</span></button>
            <button type="button" role="switch" aria-checked={pk} className={`oa-toggle${pk ? " on" : ""}`} onClick={() => setPk((v) => !v)}>🥡 Pickup<span>{pk ? "On" : "Off"}</span></button>
          </div>
          {oa && <label className="prod-f" style={{ marginTop: 8 }}><span>Order-ahead lead time (min) — blank uses the global window</span><input type="number" min={0} step={15} value={lead} onChange={(e) => setLead(e.target.value)} placeholder="e.g. 240" /></label>}
          <div className="ownerdet-hint">When on, guests can order ahead{pk ? " and choose pickup" : ""} for this stop. Off = the truck’s global setting applies.</div>
        </div>
      )}
      {!isEvent && <div className="ownerdet-hint">Go live &amp; broadcast GPS in Now ▸ Live truck.</div>}
      <div className="ownerdet-convert">
        <span className="ownerdet-convert-l">Wrong type?</span>
        <button type="button" className="ownerdet-convert-b" onClick={convertType} disabled={saving}>Change to {isEvent ? "truck stop" : "event"} ⇄</button>
      </div>
      <div className="ownerdet-danger">
        <button type="button" className="ownerdet-arch" onClick={archive} disabled={saving}>Archive {what}</button>
        <button type="button" className="ownerdet-del" onClick={del} disabled={saving}>Delete for good</button>
      </div>
      <div className="prod-actions" style={{ marginTop: 12 }}>
        <button type="button" className="note-arch" onClick={() => { setEdit(false); load(); }} disabled={saving}>Cancel</button>
        <button type="button" className="note-save" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save details"}</button>
      </div>
    </div>
  );
}

// INCIDENT LOG — every field problem the Troubleshoot agent logged for this event/stop. Read it back,
// flip resolved, or delete one. Self-contained; owner-generic.
function IncidentLog({ ownerCol, ownerId }: { ownerCol: "event_id" | "stop_id"; ownerId: string }) {
  type Inc = { id: string; problem: string; severity: string; resolved: boolean; created_at: string; symptom: string | null };
  const [rows, setRows] = useState<Inc[]>([]);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("incident_log").select("id, problem, severity, resolved, created_at, symptom").eq(ownerCol, ownerId).order("created_at", { ascending: false });
    setRows((data as Inc[]) ?? []);
  }, [ownerCol, ownerId]);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable({ table: "incident_log", filter: `${ownerCol}=eq.${ownerId}` }, load);
  const toggle = async (r: Inc) => {
    if (!supabase) return;
    setRows((p) => p.map((x) => x.id === r.id ? { ...x, resolved: !x.resolved } : x));
    await supabase.from("incident_log").update({ resolved: !r.resolved, resolved_at: !r.resolved ? new Date().toISOString() : null }).eq("id", r.id);
  };
  const del = async (id: string) => {
    if (!supabase) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this incident from the log?")) return;
    setRows((p) => p.filter((x) => x.id !== id));
    await supabase.from("incident_log").delete().eq("id", id);
  };
  if (rows.length === 0) return null;
  return (
    <div className="inclog">
      <div className="brewlink-h">🔧 Incident log</div>
      {rows.map((r) => (
        <div key={r.id} className={`inc-row${r.resolved ? " done" : ""}`}>
          <button type="button" className="inc-ck" onClick={() => toggle(r)} aria-label={r.resolved ? "Mark unresolved" : "Mark resolved"}>{r.resolved ? "✓" : "○"}</button>
          <span className="inc-main"><b className={r.severity === "blocker" ? "inc-blk" : ""}>{r.problem}</b><span>{[r.symptom, r.resolved ? "resolved" : null, new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })].filter(Boolean).join(" · ")}</span></span>
          <button type="button" className="inc-x" onClick={() => del(r.id)} aria-label="Delete incident">✕</button>
        </div>
      ))}
    </div>
  );
}

// MENU & RIG — the same menu/site flags an event carries, on the prep hub for events AND stops, so
// "Generate pack list from menu" builds the right kit either way. Self-contained load/save;
// the chips themselves are the shared MenuRigChips (one option set with Plan › Events).
function MenuEditor({ ownerType, ownerId, isAdmin, onChanged }: { ownerType: "event" | "stop"; ownerId: string; isAdmin: boolean; onChanged: () => void }) {
  const table = ownerType === "event" ? "events" : "stops";
  const [f, setF] = useState<MenuRigValue | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from(table).select(MENU_RIG_COLUMNS).eq("id", ownerId).maybeSingle();
    setF((data as MenuRigValue | null) ?? {});
  }, [table, ownerId]);
  useEffect(() => { load(); }, [load]);

  const save = async (patch: MenuRigPatch) => {
    if (!supabase || !f) return;
    setF({ ...f, ...patch });
    await supabase.from(table).update(patch).eq("id", ownerId);
    onChanged();
  };
  if (!isAdmin || !f) return null;

  return (
    <div className="menued">
      <button type="button" className="prep-collapse" style={{ marginTop: 10 }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="prep-collapse-l"><b>🍹 Menu &amp; setup</b><span>what we&apos;re pouring · the rig · power &amp; water</span></span>
        <span className={`ev-chev${open ? " open" : ""}`}>›</span>
      </button>
      {open && (
        <div className="menued-body">
          <MenuRigChips variant="ts" value={f} onPatch={save} ownerType={ownerType} ownerId={ownerId} />
        </div>
      )}
    </div>
  );
}

// DAY-OF BRIEF — how the crew shows up: dress code + call time / parking / what to bring. Leadership
// edits it; assigned crew read it. Self-contained (loads + saves its own row), works for events or stops.
function DayBrief({ ownerCol, ownerId, isAdmin }: { ownerCol: "event_id" | "stop_id"; ownerId: string; isAdmin: boolean }) {
  // crew_brief + dress_code now live on the staff-only sibling (event_ops / stop_ops, 0181), keyed
  // by the parent id — off the world-readable events/stops row.
  const opsTable = ownerCol === "stop_id" ? "stop_ops" : "event_ops";
  const [dress, setDress] = useState("");
  const [brief, setBrief] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [edit, setEdit] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from(opsTable).select("dress_code, crew_brief").eq(ownerCol, ownerId).maybeSingle();
    setDress((data as { dress_code?: string | null } | null)?.dress_code ?? "");
    setBrief((data as { crew_brief?: string | null } | null)?.crew_brief ?? "");
    setLoaded(true);
  }, [opsTable, ownerCol, ownerId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!supabase) return;
    setSaving(true);
    // Upsert the staff-only ops row (create it on first save; the parent may have none yet).
    await supabase.from(opsTable).upsert({ [ownerCol]: ownerId, dress_code: dress.trim() || null, crew_brief: brief.trim() || null }, { onConflict: ownerCol });
    setSaving(false); setEdit(false);
  };

  if (!loaded) return null;
  const empty = !dress.trim() && !brief.trim();
  if (!isAdmin && empty) return null; // nothing to show crew yet

  return (
    <div className="daybrief">
      <div className="daybrief-h">🧢 Day-of brief · how to show up{isAdmin && !edit && <button type="button" className="daybrief-edit" onClick={() => setEdit(true)}>{empty ? "+ Add" : "Edit"}</button>}</div>
      {edit ? (
        <>
          <label className="prod-f"><span>Dress code — what to wear</span><input className="note-in" value={dress} onChange={(e) => setDress(e.target.value)} placeholder="e.g. Black GT3 tee, dark jeans, closed-toe shoes" maxLength={600} /></label>
          <label className="prod-f" style={{ marginTop: 8 }}><span>Call time, parking, what to bring, anything else</span><textarea className="note-in" rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={"Call 9:30a · park behind the pavilion · bring your apron + black hat · we pour 11–3"} maxLength={4000} /></label>
          <div className="prod-actions" style={{ marginTop: 10 }}>
            <button type="button" className="note-arch" onClick={() => { setEdit(false); load(); }} disabled={saving}>Cancel</button>
            <button type="button" className="note-save" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save brief"}</button>
          </div>
        </>
      ) : empty ? (
        <div className="daybrief-empty">No brief yet — add dress code + call details so the crew knows how to show up.</div>
      ) : (
        <>
          {dress.trim() && <div className="daybrief-row"><b>Wear</b><span>{dress}</span></div>}
          {brief.trim() && <div className="daybrief-row"><b>Details</b><span style={{ whiteSpace: "pre-wrap" }}>{brief}</span></div>}
        </>
      )}
    </div>
  );
}

function MyDay({ userId, meName, isLeader, canPrep, canBrew }: { userId: string | null; meName: string; isLeader: boolean; canPrep: boolean; canBrew: boolean }) {
  // Flags ride the one shared hook (same source as the Now strip + nav badge). Crew see their own
  // pings + broadcasts now too — the old isLeader gate predates the staff-wide alerts RLS (0157).
  const { flags } = useMyAlerts(userId);
  const { setSection } = useOperatorSection();
  const streams = useWorkStreams();
  const t = useSiteCopy();
  const laneColor = (cat: string) => streamOfCategory(cat, streams)?.color;
  const [today, setToday] = useState<{ id: string; title: string | null; day_label: string | null; is_live: boolean | null; dress_code?: string | null; crew_brief?: string | null }[]>([]);
  // Clock read CLIENT-SIDE only: /crew is prerendered, so a render-time new Date() bakes build/UTC
  // time+date into the HTML and mismatches the browser on hydration (React #418). null on SSR + the
  // first client render (they match), then the effect fills the real local greeting + date.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);
  // The day's rhythm — the same anchors the company calendar carries. Events use the operator's
  // wall-clock day; drop/delivery are BUSINESS days (ET) so a late evening doesn't flip them early.
  const [rhythm, setRhythm] = useState<{ stops: { id: string; name: string | null; starts_at: string | null }[]; dropPacks: number; porches: number; brews: { id: string; recipe_name: string; batch_gal: number; warn: boolean }[] }>({ stops: [], dropPacks: 0, porches: 0, brews: [] });
  useEffect(() => {
    if (!supabase) return;
    const d = localToday();
    // Brief fields live on the staff-only event_ops sibling now — pull today's events, then merge
    // their ops rows by id (keeps the card's e.dress_code / e.crew_brief render unchanged).
    supabase.from("events").select("id, title, day_label, is_live").eq("day", d).is("archived_at", null).then(async ({ data }) => {
      const evs = (data ?? []) as { id: string; title: string | null; day_label: string | null; is_live: boolean | null }[];
      if (!evs.length || !supabase) { setToday(evs); return; }
      const { data: ops } = await supabase.from("event_ops").select("event_id, dress_code, crew_brief").in("event_id", evs.map((e) => e.id));
      const m = new Map((ops ?? []).map((o: { event_id: string; dress_code: string | null; crew_brief: string | null }) => [o.event_id, o]));
      setToday(evs.map((e) => ({ ...e, dress_code: m.get(e.id)?.dress_code ?? null, crew_brief: m.get(e.id)?.crew_brief ?? null })));
    });
    const dayStart = new Date(`${d}T00:00:00`);
    const bd = etToday();
    Promise.all([
      supabase.from("stops").select("id, name, starts_at").is("archived_at", null).neq("status", "done").gte("starts_at", dayStart.toISOString()).lt("starts_at", new Date(dayStart.getTime() + 86400000).toISOString()),
      supabase.from("drop_orders").select("id", { count: "exact", head: true }).eq("drop_date", bd).is("canceled_at", null),
      supabase.from("delivery_orders").select("id", { count: "exact", head: true }).eq("delivery_date", bd).is("canceled_at", null),
      supabase.from("brew_batches").select("id, recipe_name, batch_gal, latest_start_at, status").in("status", ["planned", "brewing"]).eq("brew_date", d),
    ]).then(([st, dr, de, br]) => {
      setRhythm({
        stops: ((st.data ?? []) as { id: string; name: string | null; starts_at: string | null }[]),
        dropPacks: dr.count ?? 0,
        porches: de.count ?? 0,
        brews: ((br.data ?? []) as { id: string; recipe_name: string; batch_gal: number; latest_start_at: string | null; status: string }[]).map((b) => ({ id: b.id, recipe_name: b.recipe_name, batch_gal: b.batch_gal, warn: brewStartOverdue(b) })),
      });
    });
  }, []);

  const greet = now ? (now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening") : "";
  const first = meName.split(" ")[0];
  const named = first && first !== "Me" ? first : "";
  const motto = t("board.welcome");

  const [leadOpen, setLeadOpen] = useState(false); // leadership briefing/intake — collapsed by default (decrowd)
  return (
    <>
      {/* compact kit header: eyebrow · title · ONE italic line (date — motto). No banner block. */}
      <div className="myday-hero">
        {now && (
          <>
            <div className="k-eyb">My Day</div>
            <h1 className="k-title" style={{ marginTop: 8 }}>{greet.replace("Good ", "")}{named ? `, ${named}` : ""}.</h1>
            <p className="k-sub">{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}{motto ? ` — ${motto}` : ""}</p>
          </>
        )}
      </div>
      {today.length > 0 && (
        <div className="myday-today">
          {today.map((e) => (
            <div key={e.id} className="myday-ev-wrap">
              <div className="myday-ev">{e.is_live && <span className="myday-live">LIVE</span>}<span>📍 {e.title || e.day_label || "Event"}</span></div>
              {(e.dress_code?.trim() || e.crew_brief?.trim()) && (
                <div className="myday-brief">
                  {e.dress_code?.trim() && <div className="myday-brief-row"><b>🧢 Wear</b><span>{e.dress_code}</span></div>}
                  {e.crew_brief?.trim() && <div className="myday-brief-row"><b>📋 Details</b><span style={{ whiteSpace: "pre-wrap" }}>{e.crew_brief}</span></div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {(rhythm.stops.length > 0 || rhythm.dropPacks > 0 || rhythm.porches > 0 || rhythm.brews.length > 0) && (
        <div className="myday-rhythm">
          {rhythm.stops.map((s) => (
            <button key={s.id} type="button" className="myday-chip" style={{ borderLeftColor: laneColor("stop") }} onClick={() => { if (!canPrep) { setSection("now"); return; } try { localStorage.setItem("gt3-prep-open", `stop:${s.id}`); } catch { /* ignore */ } setSection("prep"); }}>
              🚚 {s.name || "Truck stop"}{s.starts_at ? ` · ${new Date(s.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""} ›
            </button>
          ))}
          {rhythm.dropPacks > 0 && <button type="button" className="myday-chip" style={{ borderLeftColor: laneColor("drop") }} onClick={() => setSection("now")}>📦 Drop today · {rhythm.dropPacks} pack{rhythm.dropPacks === 1 ? "" : "s"} ›</button>}
          {rhythm.porches > 0 && <button type="button" className="myday-chip" style={{ borderLeftColor: laneColor("delivery") }} onClick={() => { window.location.href = "/driver"; }}>🚗 Delivery run · {rhythm.porches} porch{rhythm.porches === 1 ? "" : "es"} ›</button>}
          {canBrew && rhythm.brews.map((b) => (
            <button key={b.id} type="button" className={`myday-chip${b.warn ? " warn" : ""}`} style={{ borderLeftColor: laneColor("brew") }} onClick={() => setSection("brew")}>
              ☕ Brew · {b.recipe_name} {b.batch_gal} gal{b.warn ? " — start now" : ""} ›
            </button>
          ))}
        </div>
      )}
      {/* The one inbox pointer — counts live in ONE place (the 🔔 bell is the same number). When
          nothing needs you, we say NOTHING: silence is the signal, not another banner. */}
      {flags.length > 0 && (
        <button type="button" className="myday-inbox-ptr" onClick={() => window.dispatchEvent(new Event("gt3-open-inbox"))}>
          <span className="myday-inbox-n">{flags.length}</span> flag{flags.length === 1 ? "" : "s"} &amp; ping{flags.length === 1 ? "" : "s"} for you <span className="myday-inbox-go">Open inbox →</span>
        </button>
      )}
      {/* MY TASKS above the fold — the day's work leads; everything else follows. */}
      <MyTasks userId={userId} />
      <button type="button" className="btn-ter" style={{ marginTop: 10 }} onClick={() => window.dispatchEvent(new Event("gt3-quick-note"))}>✎ Note to self</button>
      {/* Lead-the-week tools: collapsed to one chip until called for (decrowd — the briefing is
          on-demand by nature; it shouldn't occupy the glance screen). */}
      {isLeader && (
        <div style={{ marginTop: 18 }}>
          <button type="button" className="k-chip sec" onClick={() => setLeadOpen((o) => !o)} aria-expanded={leadOpen}>
            🧭 Lead the week — GTM, briefing &amp; intake {leadOpen ? "▴" : "▾"}
          </button>
          {leadOpen && (
            <div style={{ marginTop: 12 }}>
              {/* GTM definition first — its home is the collapsed chip (Ryan: "GTM -> collapsed chip") */}
              <GtmCard onOpenSchedule={() => setSection("now")} onOpenInitiative={() => setSection("command")} />
              <ChiefOfStaff />
              <SmartIntake />
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ───────────────────────── needs you: the start-of-shift action list ─────────────────────────
// Lives on MY DAY (leadership) — the console's one glance screen. Booking replies, past-due team
// tasks and restock lows used to hide inside Readiness' Overview; the counts are the same queries,
// now surfaced where the day starts. Quiet when there's nothing to act on.
function NeedsYou() {
  const { setSection } = useOperatorSection();
  const [news, setNews] = useState(0);
  const [overdue, setOverdue] = useState<OverdueTask[]>([]);
  const [showOverdue, setShowOverdue] = useState(false);
  const [low, setLow] = useState<InvItem[]>([]);
  const load = useCallback(async () => {
    if (!supabase) return;
    const today = localYMD(new Date());
    const nowIso = new Date().toISOString();
    const [b, evs, st, tasks, invResp] = await Promise.all([
      supabase.from("booking_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("events").select("*").order("day"),
      supabase.from("stops").select("id, name, starts_at, status, archived_at").order("starts_at"),
      supabase.from("event_tasks").select("id, label, event_id, stop_id, done, kind, due_at").eq("done", false).eq("kind", "task"),
      fetchInventory(),
    ]);
    const allEv = ((evs.data as EventRow[]) ?? []).filter((e) => !e.archived_at);
    const allSt = ((st.data as Stop[]) ?? []).filter((x) => !x.archived_at);
    const evName = new Map(allEv.map((e) => [e.id, e.title ?? "Event"]));
    const stName = new Map(allSt.map((x) => [x.id, x.name ?? "Stop"]));
    const dueEv = new Set(allEv.filter((e) => e.day && e.day < today).map((e) => e.id));
    const dueSt = new Set(allSt.filter((x) => x.status === "done" || (x.starts_at && localYMD(new Date(x.starts_at)) < today)).map((x) => x.id));
    const taskRows = (tasks.data as { id: string; label: string; event_id: string | null; stop_id: string | null; due_at: string | null }[]) ?? [];
    const od: OverdueTask[] = [];
    for (const t of taskRows) {
      const isPast = t.due_at ? t.due_at < nowIso : ((t.event_id && dueEv.has(t.event_id)) || (t.stop_id && dueSt.has(t.stop_id)));
      if (!isPast) continue;
      if (t.event_id) od.push({ taskId: t.id, label: t.label, kind: "event", ownerId: t.event_id, ownerName: evName.get(t.event_id) ?? "Event" });
      else if (t.stop_id) od.push({ taskId: t.id, label: t.label, kind: "stop", ownerId: t.stop_id, ownerName: stName.get(t.stop_id) ?? "Stop" });
    }
    setNews(b.count ?? 0);
    setOverdue(od);
    setLow(invResp.enabled ? rollupLowStock(invResp.items, allEv.filter((e) => e.day && e.day >= today)) : []);
  }, []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { load(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [load]);
  useRealtimeTable(["booking_requests", "event_tasks"], () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => load(), 500);
  });
  const goBookings = () => { setSection("pipeline"); };   // leads live in Pipeline now (one funnel)
  const openTarget = (kind: "event" | "stop", id: string) => { try { localStorage.setItem("gt3-prep-open", kind === "stop" ? `stop:${id}` : id); } catch { /* ignore */ } setSection("prep"); };
  if (news === 0 && overdue.length === 0 && low.length === 0) return null;
  return (
    <div className="adm-sec">
      <div className="bo-needs" style={{ marginTop: 0 }}>
        <div className="adm-prep-label">Needs you</div>
        {news > 0 && <button className="bo-need" onClick={goBookings}>{news} new booking {news === 1 ? "request" : "requests"} to reply to ›</button>}
        {overdue.length > 0 && <button className="bo-need alert" onClick={() => setShowOverdue((v) => !v)}>{overdue.length} team {overdue.length === 1 ? "task" : "tasks"} past due — knock them out ›</button>}
      </div>
      {showOverdue && overdue.length > 0 && (
        <div className="bo-overdue">
          {overdue.slice(0, 8).map((t) => (
            <button key={t.taskId} className="bo-overdue-row" onClick={() => openTarget(t.kind, t.ownerId)}>
              <span className="bo-overdue-l">{t.label}</span>
              <span className="bo-overdue-o">{t.ownerName} ›</span>
            </button>
          ))}
          {overdue.length > 8 && <div className="pnl-note">+ {overdue.length - 8} more past due.</div>}
        </div>
      )}
      {low.length > 0 && (
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
    </div>
  );
}

function MyTasks({ userId, chip = false }: { userId: string | null; chip?: boolean }) {
  const { setSection } = useOperatorSection();
  const { openTask } = useTaskSheet();
  const [tasks, setTasks] = useState<MyTaskRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !userId) { setTasks([]); setLoaded(true); return; }
    // ONE task read: the all_tasks spine view (0210, enriched by 0225) — event_tasks ∪ todos with
    // the op/note/goal context joined in the database. Same plate the WorkloadBoard reads, so task
    // surfaces can't drift apart again. Op context rides the field_ops spine, which is why a
    // STOP-owned task now shows its stop's name (it rendered as a bare "Event" before).
    const { data } = await supabase
      .from("all_tasks")
      .select("*")
      .eq("assignee", userId)
      .eq("done", false)
      .order("sort", { ascending: true, nullsFirst: false });   // events keep their sort; sortless to-dos land after, as before
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: MyTaskRow[] = ((data as any[]) ?? []).map((r) =>
      r.source === "todo"
        ? ({
            id: r.id, label: r.title, source: "todo", category: r.category,
            due_at: r.due ? new Date(`${r.due}T23:59:59`).toISOString() : null,   // local end-of-day as a REAL instant, so a to-do due today isn't "overdue" all evening (behind-UTC bug)
            critical: false, warn: false, events: null, meeting_notes: null, goals: null,
          } as MyTaskRow)
        : ({
            ...r, label: r.title, source: "event" as const,
            // != null (not truthiness): an empty-string title is still a real row — panel finding.
            // Stop dates bucket on the OPERATOR's wall clock (dayKey, the one-clock spine), not a UTC cast.
            events: r.op_name != null ? { title: r.op_kind === "stop" ? `🚚 ${r.op_name}` : r.op_name, day: r.op_day ?? (r.op_starts_at ? dayKey(new Date(r.op_starts_at)) : null), is_live: r.op_is_live } : null,
            meeting_notes: r.meeting_note_title != null ? { title: r.meeting_note_title } : null,
            goals: r.goal_title != null ? { title: r.goal_title } : null,
          } as MyTaskRow));
    setTasks(rows);
    setLoaded(true);
  }, [userId]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable({ table: "event_tasks", filter: `assignee=eq.${userId}` }, load, { enabled: !!userId });
  useRealtimeTable({ table: "todos", filter: `assignee=eq.${userId}` }, load, { enabled: !!userId });

  const complete = async (t: MyTaskRow) => {
    if (!supabase) return;
    setTasks((p) => p.filter((x) => x.id !== t.id)); // optimistic
    await completeTask(t.source === "todo" ? "todo" : "event", t.id, userId);   // ONE complete path (lib/tasks)
  };

  if (!userId || (loaded && tasks.length === 0)) return null;

  // Priority: critical first, then overdue, then important (warn), then tasks on a LIVE event, then by date.
  const nowIso = new Date().toISOString();
  const isOver = (t: MyTaskRow) => !!t.due_at && t.due_at < nowIso;
  const score = (t: MyTaskRow) => (t.critical ? 0 : isOver(t) ? 1 : t.warn ? 2 : t.events?.is_live ? 3 : 4);
  const sorted = [...tasks].sort((a, b) => score(a) - score(b) || (a.due_at ?? a.events?.day ?? "9999").localeCompare(b.due_at ?? b.events?.day ?? "9999"));
  const crit = tasks.filter((t) => t.critical).length;
  const over = tasks.filter(isOver).length;

  // Chip face (Live Ops): the full list has ONE home — My Day. During service this is a pointer,
  // the same pattern the alerts strip uses.
  if (chip) {
    return (
      <button type="button" className="alerts-strip taskptr" onClick={() => setSection("day")}>
        <span className="alerts-strip-i" aria-hidden>☑️</span>
        <span className="alerts-strip-t"><b>{tasks.length} task{tasks.length === 1 ? "" : "s"} on your plate</b>{over ? ` · ${over} overdue` : crit ? ` · ${crit} critical` : ""}</span>
        <span className="alerts-strip-go">Open in My Day →</span>
      </button>
    );
  }

  return (
    <div className="adm-sec">
      <div className="crew-group">My tasks <span className={`adm-pill${crit || over ? " due" : ""}`}>{tasks.length}{over ? ` · ${over} overdue` : crit ? ` · ${crit} critical` : ""}</span></div>
      {sorted.map((t) => (
        <div key={t.id} className={`mytask${t.critical ? " crit" : isOver(t) ? " crit" : t.warn ? " warn" : ""}`}>
          <button type="button" className="task-check" onClick={() => complete(t)} aria-label={`Mark done: ${t.label}`}>
            <span className="task-box" />
          </button>
          <button type="button" className="mytask-main" onClick={() => openTask(t.id, t.source === "todo" ? "todo" : "event")} aria-label={`Open task: ${t.label}`}>
            <span className="mytask-label">{t.label}</span>
            <span className="mytask-ev">{t.source === "todo" ? `To-do${t.category ? ` · ${t.category}` : ""}` : t.meeting_notes ? `Follow-up · ${t.meeting_notes.title ?? "Meeting"}` : t.goals ? `Goal · ${t.goals.title ?? "Goal"}` : `${t.events?.title ?? "Event"}${t.events?.is_live ? " · LIVE" : t.events?.day ? ` · ${whenBucket(t.events.day).label}` : ""}`}{t.due_at ? ` · due ${dueLabel(t.due_at)}` : ""}</span>
          </button>
          {isOver(t) ? <span className="mytask-pri over">Overdue</span> : t.critical ? <span className="mytask-pri crit">Critical</span> : t.warn ? <span className="mytask-pri warn">Important</span> : null}
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
    <Sheet open onClose={onClose} label="Group tasks" header={<div style={{ display: "flex", alignItems: "center" }}>Group by · date / when</div>}>
        <div className="prep-sheet-opts">
          <button className={`prep-sheet-opt${dir === "asc" ? " on" : ""}`} onClick={() => { setDir("asc"); onClose(); }}>Soonest first</button>
          <button className={`prep-sheet-opt${dir === "desc" ? " on" : ""}`} onClick={() => { setDir("desc"); onClose(); }}>Latest first</button>
        </div>
    </Sheet>
  );
}

type PrepTarget = { kind: "event" | "stop"; id: string };

// The meetings behind this event/stop — titles + a first line, no click required to know what's
// there; the jump opens the full Notes page.
function NotesForTarget({ ownerCol, ownerId }: { ownerCol: "event_id" | "stop_id"; ownerId: string }) {
  const { setSection } = useOperatorSection();
  const [notes, setNotes] = useState<{ id: string; title: string; met_on: string; summary: string | null }[]>([]);
  useEffect(() => {
    if (!supabase) return;
    supabase.from("meeting_notes").select("id, title, met_on, summary").eq(ownerCol, ownerId).is("archived_at", null)
      .order("met_on", { ascending: false }).limit(5)
      .then(({ data }) => setNotes((data as { id: string; title: string; met_on: string; summary: string | null }[]) ?? []));
  }, [ownerCol, ownerId]);
  if (notes.length === 0) return null;
  return (
    <div className="pnotes">
      <div className="dv-sub">Meeting notes · {notes.length}</div>
      {notes.map((n) => (
        <button key={n.id} type="button" className="pnotes-row" onClick={() => setSection("notes")}>
          <b>{n.title}</b>
          <span>{fmtNoteDate(n.met_on)}{n.summary ? ` — ${n.summary.slice(0, 90)}${n.summary.length > 90 ? "…" : ""}` : ""}</span>
        </button>
      ))}
    </div>
  );
}

function PrepCard({ title, when, location, live, r, onOpen }: { title: string; when: string; location: string | null; live: boolean; r: Readiness; onOpen: () => void }) {
  const status = r.total === 0 ? "Not started" : r.done === r.total ? "✓ Ready to roll" : `Loaded ${r.done}/${r.total}`;
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
      const r = await authedFetch("/api/agents/readiness", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
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
    const today = localToday();
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
      const r = await authedFetch("/api/agents/inspection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, county, event_id: eventId }) });
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
    // Active prep = not archived AND not completed. Completing an event stamps stage:"done"
    // (0121); finishing a truck stop sets status:"done". Either way it drops off the active
    // list — it's still reachable via history/archive, just not cluttering today's prep.
    const evList = ((evs as EventRow[]) ?? []).filter((e) => !e.archived_at && e.stage !== "done");
    setEvents(evList);
    setStops(((sts as Stop[]) ?? []).filter((s) => !s.archived_at && s.status !== "done"));
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
      if (tgt) { localStorage.removeItem("gt3-prep-open"); const isStop = tgt.startsWith("stop:"); const id = tgt.includes(":") ? tgt.slice(tgt.indexOf(":") + 1) : tgt; setSelected({ kind: isStop ? "stop" : "event", id }); }
    } catch { /* ignore */ }
    // ⌘K / recents jump: open the requested target even if we're already on the Prep list (the
    // mount-time read above only fires on first render).
    const onOpen = () => {
      try {
        const tgt = localStorage.getItem("gt3-prep-open");
        if (tgt) { localStorage.removeItem("gt3-prep-open"); const isStop = tgt.startsWith("stop:"); const id = tgt.includes(":") ? tgt.slice(tgt.indexOf(":") + 1) : tgt; setSelected({ kind: isStop ? "stop" : "event", id }); }
      } catch { /* ignore */ }
    };
    window.addEventListener("gt3-open-prep", onOpen);
    return () => window.removeEventListener("gt3-open-prep", onOpen);
  }, [load]);
  useRealtimeTable(["events", "stops", "event_tasks"], load);

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
    <Overview onGo={onGo} onOpenTarget={(kind, id) => setSelected({ kind, id })} />
    <div className="adm-sec adm-prep">
      <div className="sec">Prep
        <button className="adm-prep-view" onClick={() => setSheet(true)} aria-haspopup="dialog">View ⌄</button>
      </div>
      {!loaded && <PourFill />}
      {loaded && events.length === 0 && stops.length === 0 && <div className="h-sub">Nothing to prep yet — add an event (Plan → Events) or a truck location (Now → Live truck).</div>}

      {stops.length > 0 && (
        <div className="prep-group">
          <div className="prep-group-h">Truck locations <span>{stops.length}</span></div>
          <div className="prep-cards">
            {stops.map((s) => (
              <PrepCard key={s.id} title={s.name} when={s.id === liveStopId ? "Live now" : [(s as { starts_at?: string | null }).starts_at ? new Date((s as { starts_at?: string | null }).starts_at as string).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : null, s.when_label].filter(Boolean).join(" · ") || "Unscheduled"} location={s.location_text} live={s.id === liveStopId}
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
              <PrepCard key={ev.id} title={ev.title} when={[ev.day ? new Date(`${ev.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : ev.day_label, ev.start_time].filter(Boolean).join(" · ") || "Unscheduled"} location={ev.location_text} live={!!ev.is_live}
                r={ready[ev.id] ?? { done: 0, total: 0, crit: 0 }} onOpen={() => setSelected({ kind: "event", id: ev.id })} />
            ))}
          </div>
        </div>
      ))}
      {sheet && <PrepViewSheet dir={dir} setDir={setDir} onClose={() => setSheet(false)} />}
    </div>
    </>
  );
}

// ── The garage — the standing libraries (load-out, gear, maintenance, inventory) collapsed to
// quiet one-line rows. They're reference until there's something to pack for: the load-out row
// auto-opens only when an event or stop is live or within the next 7 days. Bodies mount on open,
// so a quiet week also skips their data fetches.
// Production › Garage as a dedicated page: Garage needs events/stops only for the "event is
// near — check the load" auto-open, so this wrapper loads just that.
function GarageSection() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [liveStopId, setLiveStopId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    const [e, s, l] = await Promise.all([
      supabase.from("events").select("*").is("archived_at", null),
      supabase.from("stops").select("*").is("archived_at", null).neq("status", "done"),
      supabase.from("live_status").select("current_stop_id, is_live").maybeSingle(),
    ]);
    setEvents((e.data as EventRow[]) ?? []);
    setStops((s.data as Stop[]) ?? []);
    const ls = l.data as { current_stop_id: string | null; is_live: boolean | null } | null;
    setLiveStopId(ls?.is_live ? ls.current_stop_id : null);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["events", "stops", "live_status"], load);
  return <Garage events={events} stops={stops} liveStopId={liveStopId} loaded={loaded} />;
}

function Garage({ events, stops, liveStopId, loaded }: { events: EventRow[]; stops: Stop[]; liveStopId: string | null; loaded: boolean }) {
  const packSoon = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const horizon = new Date(today); horizon.setDate(horizon.getDate() + 7);
    const within = (d?: string | null) => { if (!d) return false; const x = new Date(`${d.slice(0, 10)}T12:00:00`); return x >= today && x <= horizon; };
    return Boolean(liveStopId) || events.some((e) => e.is_live || within(e.day))
      || stops.some((s) => within((s as { starts_at?: string | null }).starts_at));
  }, [events, stops, liveStopId]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const autoRef = useRef(false);
  useEffect(() => { if (loaded && packSoon && !autoRef.current) { autoRef.current = true; setOpen((o) => ({ ...o, loadout: true })); } }, [loaded, packSoon]);
  const row = (id: string, icon: string, title: string, hint: string, body: ReactNode) => (
    <div className={`garage-row${open[id] ? " open" : ""}`}>
      <button type="button" className="garage-head" onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))} aria-expanded={!!open[id]}>
        <span className="garage-ic">{icon}</span>
        <span className="garage-t">{title}</span>
        {!open[id] && <span className="garage-hint">{hint}</span>}
        <span className="garage-chev">{open[id] ? "▾" : "▸"}</span>
      </button>
      {open[id] && <div className="garage-body">{body}</div>}
    </div>
  );
  return (
    <div className="garage">
      <div className="prep-group-h">The garage <span>rigs · gear · stock</span></div>
      {row("loadout", "🚚", "Load-out & tow plan", packSoon ? "event this week — check the load" : "quiet until an event is near", <TrailerLoadout />)}
      {row("gear", "🧰", "Gear library", "manuals · specs · how-tos", <GearLibrary />)}
      {row("maint", "🔧", "Asset maintenance", "service log · what's due", <AssetMaintenance />)}
      {row("inventory", "📦", "Inventory", "stock, costs & pars", <InventoryLibrary />)}
    </div>
  );
}

// Detail: a per-target pick list. For an EVENT it's the full thing (auto-generate from
// rig/menu, crew roster, owner+manager sign-off). For a TRUCK STOP it's the same checklist
// engine (assign, supply/gear picker, My Tasks) minus the event-only bits. Owner = event_id
// XOR stop_id (migration 0040).
function PrepDetail({ target, onBack }: { target: { kind: "event" | "stop"; id: string }; onBack: () => void }) {
  const { openTask } = useTaskSheet(); // the ONE task editor, on the spine
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
  const [newTaskDue, setNewTaskDue] = useState("");
  const [generating, setGenerating] = useState(false);
  const [assignFor, setAssignFor] = useState<EventTask | null>(null);
  const [showSupplies, setShowSupplies] = useState(false);
  // Breadcrumb: Prep › <this target>. Clicking the "Prep" root (or the name) steps back to the list.
  useCrumb("prep-detail", name ?? (isEvent ? "Event" : "Location"), onBack);
  // Recents: remember this event/stop so ⌘K can jump straight back to it later.
  useEffect(() => { if (name) recordRecent(isEvent ? "event" : "stop", target.id, name); }, [name, isEvent, target.id]);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [prepAIOpen, setPrepAIOpen] = useState(false);
  const [troubleshootOpen, setTroubleshootOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false); // stop run-of-show / when-to-leave planner
  const [loadoutOpen, setLoadoutOpen] = useState(false); // load-out & tow, scoped to this owner
  const [packPlanOpen, setPackPlanOpen] = useState(false); // kegs-vs-bottles pack-out plan
  const [brewBatches, setBrewBatches] = useState<{ id: string; recipe_name: string | null; batch_gal: number; status: string; ready_at: string | null }[]>([]);
  const [stopMeta, setStopMeta] = useState<{ day: string | null; plan_days: number }>({ day: null, plan_days: 1 });
  const [onHand, setOnHand] = useState<{ item: string; bal: number }[]>([]); // carried-in stock (ledger balance)

  const loadOnHand = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("inventory_ledger").select("item, qty");
    const m: Record<string, number> = {};
    (data ?? []).forEach((r: any) => { m[r.item] = (m[r.item] ?? 0) + Number(r.qty); });
    setOnHand(Object.entries(m).map(([item, bal]) => ({ item, bal })).filter((x) => Math.abs(x.bal) > 0.0001).sort((a, b) => a.item.localeCompare(b.item)));
  }, []);
  useEffect(() => { loadOnHand(); }, [loadOnHand]);

  const load = useCallback(async () => {
    if (!supabase) return;
    // Resolve the target's display name (+ the full event row for events).
    if (isEvent) {
      const { data: e } = await supabase.from("events").select("*").eq("id", target.id).maybeSingle();
      setEv((e as EventRow) ?? null);
      setName((e as EventRow)?.title ?? null);
    } else {
      const { data: s } = await supabase.from("stops").select("name, starts_at, plan_days").eq("id", target.id).maybeSingle();
      setEv(null);
      const sm = s as { name: string; starts_at: string | null; plan_days: number | null } | null;
      setName(sm?.name ?? null);
      setStopMeta({ day: sm?.starts_at ? sm.starts_at.slice(0, 10) : null, plan_days: Math.max(1, sm?.plan_days ?? 1) });
    }
    setLoadedOk(true);
    const { data: t } = await supabase.from("event_tasks").select("*").eq(ownerCol, target.id).order("sort");
    const seen = new Set<string>();
    const deduped = ((t as EventTask[]) ?? []).filter((x) => { const k = `${x.section ?? ""}|${x.label}`; if (seen.has(k)) return false; seen.add(k); return true; });
    setTasks(deduped);
    commentCounts("event_task_id", deduped.map((x) => x.id)).then(setCounts);
    // Crew + sign-off work for events AND stops (owner-generic) — a stop staffs up just like an event.
    {
      const [{ data: c }, { data: ap }] = await Promise.all([
        supabase.from("event_staff").select("id, user_id, role_label").eq(ownerCol, target.id),
        supabase.from("event_approvals").select("*").eq(ownerCol, target.id),
      ]);
      setCrew((c as { id: string; user_id: string; role_label: string | null }[]) ?? []);
      setApprovals((ap as { approver_id: string }[]) ?? []);
    }
    if (isAdmin) {
      const { data: p } = await supabase.from("profiles").select("id, display_name, role").neq("role", "member");
      setStaff((p as { id: string; display_name: string | null; role?: string | null }[]) ?? []);
    }
    // Brew batches serving THIS event/stop (many-to-many via the link table).
    const { data: bl } = await supabase.from("brew_batch_links").select("brew_batches(id, recipe_name, batch_gal, status, ready_at)").eq(ownerCol, target.id);
    type BB = { id: string; recipe_name: string | null; batch_gal: number; status: string; ready_at: string | null };
    const seenB = new Set<string>();
    const rows = (bl as unknown as { brew_batches: BB | BB[] | null }[]) ?? [];
    setBrewBatches(rows.flatMap((r) => (Array.isArray(r.brew_batches) ? r.brew_batches : r.brew_batches ? [r.brew_batches] : []))
      .filter((b) => !seenB.has(b.id) && (seenB.add(b.id), true)));
  }, [target.id, isEvent, ownerCol, isAdmin]);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["event_tasks", "event_staff", "event_approvals", "comments", "brew_batch_links", "brew_batches"], load);

  // Clear, identifiable labels — staff often sign in without setting a name, so fall back
  // to something readable instead of an anonymous "—" that makes assignments look empty.
  const staffName = (uid: string) => staff.find((s) => s.id === uid)?.display_name?.trim() || "Unnamed crew";
  const firstNameOf = (uid: string) => staffName(uid).split(" ")[0];
  const initialOf = (uid: string) => { const n = staff.find((s) => s.id === uid)?.display_name?.trim(); return n ? n.charAt(0).toUpperCase() : "?"; };
  const nameOf = (uid: string) => staffName(uid);
  const generate = async (regen = false) => {
    if (!supabase || generating) return;
    // The menu/rig/site row that drives packListFor — the event row, or the stop's own menu columns.
    let menuRow = ev as EventRow | null;
    if (!isEvent) {
      const { data: s } = await supabase.from("stops").select(MENU_RIG_COLUMNS).eq("id", target.id).maybeSingle();
      menuRow = (s as unknown as EventRow) ?? null;
    }
    if (!menuRow) return;
    if (regen && typeof window !== "undefined" && !window.confirm(`Refresh the pack list from the ${isEvent ? "event" : "stop"}'s current menu/rig?\n\nNew items are added and dropped ones removed — your existing checkmarks are kept.`)) return;
    setGenerating(true);
    // Pack list (rig/menu) for both; compliance (state/county) for events, which carry a jurisdiction.
    // Menu comes from the 0173 relation (real product slugs) when it has rows; the legacy menu_*
    // booleans on the row remain the fallback for owners whose relation was never written.
    const { data: mi } = await supabase.from("event_menu_items").select("product_slug").eq(ownerCol, target.id);
    const menuSlugs = new Set(((mi as { product_slug: string }[] | null) ?? []).map((r) => r.product_slug));
    const pack = packListFor(menuRow, menuSlugs.size ? menuSlugs : null).map((p, i) => ({ [ownerCol]: target.id, label: p.label, section: p.section, critical: !!p.critical, warn: !!p.warn, kind: "pack", link: null, sort: i }));
    const comp = isEvent && ev ? (await complianceFor(ev, supabase)).map((p, i) => ({ event_id: ev.id, label: p.label, section: p.section, critical: !!p.critical, warn: !!p.warn, kind: "task", link: p.link ?? null, sort: 100 + i })) : [];
    const rows = [...pack, ...comp];
    if (!rows.length) { setGenerating(false); toast(`Set the ${isEvent ? "event" : "stop"}'s menu + rig first — tap Menu & setup`, "error"); return; }
    const keyOf = (r: { section?: string | null; label: string }) => `${r.section ?? ""}|${r.label}`;
    const { data: existing } = await supabase.from("event_tasks").select("id, label, section, kind").eq(ownerCol, target.id);
    const ex = (existing as { id: string; label: string; section: string | null; kind: string | null }[]) ?? [];
    if (!ex.length) {
      // First generation — straight insert.
      const { error } = await supabase.from("event_tasks").insert(rows);
      setGenerating(false);
      toast(error ? `Error: ${error.message}` : `Generated ${pack.length} pack${comp.length ? ` + ${comp.length} compliance` : ""} items`);
      if (!error) load();
      return;
    }
    if (!regen) { setGenerating(false); load(); return; } // idempotent: a plain generate never double-inserts
    // DIFF regen (audit P1·8) — preserve crew progress: add only the items that are new, remove only
    // the auto-generated PACK rows that are no longer on the menu, and leave everything else (checked
    // items, manual tasks, follow-ups, compliance) exactly as it is.
    const existingKeys = new Set(ex.map(keyOf));
    const desiredKeys = new Set(rows.map(keyOf));
    const toAdd = rows.filter((r) => !existingKeys.has(keyOf(r)));
    const staleIds = ex.filter((r) => r.kind === "pack" && !desiredKeys.has(keyOf(r))).map((r) => r.id);
    if (toAdd.length) await supabase.from("event_tasks").insert(toAdd);
    if (staleIds.length) await supabase.from("event_tasks").delete().in("id", staleIds);
    setGenerating(false);
    toast(toAdd.length || staleIds.length ? `Refreshed — ${toAdd.length} added, ${staleIds.length} removed, checkmarks kept` : "Already up to date");
    load();
  };
  // Nuke / reset — wipe everything built for this event/stop (AI-generated prep + run-of-show schedule)
  // so the crew can start clean. The event/stop itself, its date, and its day-of brief stay.
  const resetAll = async () => {
    if (!supabase || generating) return;
    const what = isEvent ? "event" : "truck stop";
    if (typeof window !== "undefined" && !window.confirm(`Reset this ${what}?\n\nThis deletes its ENTIRE prep checklist and run-of-show schedule — everything you and the AI have built. The ${what} itself and its date stay. This can't be undone.`)) return;
    setGenerating(true);
    const [t1, t2] = await Promise.all([
      supabase.from("event_tasks").delete().eq(ownerCol, target.id),
      supabase.from("event_schedule_items").delete().eq(ownerCol, target.id),
    ]);
    setGenerating(false);
    const e = t1.error || t2.error;
    toast(e ? `Reset failed — ${e.message}` : `Reset — this ${what}'s prep & schedule are cleared`, e ? "error" : undefined);
    if (!e) load();
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
      // Alerts are staff-wide since 0157 — every assignee gets the flag, and the fan-out trigger
      // delivers the push. The old leadership-only guard (and its direct push.invoke fallback that
      // bypassed the spine) is gone with it.
      if (next !== user?.id) {
        raiseAlert({
          severity: "critical", category: "task", kind: "task_assigned", subject_id: t.id,
          title: `${profile?.display_name?.split(" ")[0] || "A manager"} assigned you: ${t.label}`,
          body: name ? `On ${isEvent ? "event" : "location"} · ${name}` : undefined,
          target_user_id: next, created_by: user?.id ?? null,
        });
      }
    }
  };
  // Confirm the actual count for a planned item — what's confirmed moves into "On hand". Setting an
  // actual also checks the line off (it's done once you've confirmed what you really have).
  const confirmQty = async (t: EventTask, v: string) => {
    if (!supabase) return;
    const n = v.trim() === "" ? null : Number(v);
    const delta = (n ?? 0) - (t.actual_qty ?? 0);
    setTasks((p) => p.map((x) => (x.id === t.id ? { ...x, actual_qty: n, done: n != null } : x)));
    await supabase.from("event_tasks").update({ actual_qty: n, done: n != null, done_at: n != null ? new Date().toISOString() : null, done_by: n != null ? user?.id ?? null : null }).eq("id", t.id);
    // back the clean UI with an append-only ledger entry (signed delta) for reports + carryover
    if (delta !== 0) {
      await supabase.from("inventory_ledger").insert({
        item: t.label.slice(0, 160), task_id: t.id, kind: "confirm", qty: delta,
        event_id: isEvent ? target.id : null, stop_id: isEvent ? null : target.id, created_by: user?.id ?? null,
      });
      loadOnHand();
    }
  };
  // Correct the real count of a carried-in item (e.g. set the leftover after an event) — logs the
  // delta so the ledger balance stays honest and carries to the next event.
  const adjustOnHand = async (item: string, v: string) => {
    if (!supabase) return;
    const cur = onHand.find((o) => o.item === item)?.bal ?? 0;
    const want = v.trim() === "" ? 0 : Number(v);
    const delta = want - cur;
    if (!delta) return;
    setOnHand((p) => p.map((o) => (o.item === item ? { ...o, bal: want } : o)));
    await supabase.from("inventory_ledger").insert({ item, kind: "adjust", qty: delta, event_id: isEvent ? target.id : null, stop_id: isEvent ? null : target.id, created_by: user?.id ?? null });
  };
  const addTask = async () => {
    if (!supabase || !newTask.trim()) return;
    const due_at = newTaskDue.trim() === "" ? null : new Date(`${newTaskDue}T23:59:59`).toISOString();
    const { error } = await supabase.from("event_tasks").insert({ [ownerCol]: target.id, label: newTask.trim(), kind: "task", section: "Task", sort: tasks.length, due_at });
    setNewTask(""); setNewTaskDue("");
    if (error) toast(`Error: ${error.message}`, "error"); else load();
  };
  const addCrew = async (uid: string) => {
    if (!supabase || !uid) return;
    const { error } = await supabase.from("event_staff").insert({ [ownerCol]: target.id, user_id: uid });
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
    if (!user || !supabase) return;
    if (mine) {
      await supabase.from("event_approvals").delete().eq(ownerCol, target.id).eq("approver_id", user.id);
      toast("Approval withdrawn");
    } else {
      const { error } = await supabase.from("event_approvals").insert({ [ownerCol]: target.id, approver_id: user.id });
      toast(error ? `Error: ${error.message}` : "Prep approved");
    }
    load();
  };
  const requestSignoff = async (approverIds: string[]) => {
    if (!supabase || approverIds.length === 0) { toast("Everyone's already approved"); return; }
    const requester = profile?.display_name?.split(" ")[0] || "A manager";
    const label = name ?? (isEvent ? "Event" : "Stop");
    // Route through the alerts spine (inbox · My Day · digest) — one alert per pending approver — so
    // an approver with no push subscription still sees it; the 0157 alerts_push_fanout trigger also
    // delivers the web push, so the old push-only edge call is redundant. Toast reflects the write.
    const { error } = await supabase.from("alerts").insert(
      approverIds.map((id) => ({
        severity: "important", category: "prep", kind: "prep_signoff_request", subject_id: target.id,
        title: `${requester} needs your sign-off: ${label}`,
        body: `Prep is ready for your approval${name ? ` · ${name}` : ""}`,
        link: "/crew", target_user_id: id, created_by: user?.id ?? null,
      })),
    );
    if (error) { toast(`Couldn't request sign-off: ${error.message}`, "error"); return; }
    toast("Sign-off requested");
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
      {/* Identity / date / place / status — managed right here, so a stop or event is one screen end to end. */}
      <OwnerDetails ownerType={target.kind} ownerId={target.id} isAdmin={isAdmin} onSaved={(nm) => { setName(nm); load(); }} onRemoved={onBack} />
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
              <button className="adm-regen" onClick={() => setPrepAIOpen(true)}>✨ AI prep list</button>
              <button className="adm-regen ts-btn" onClick={() => setTroubleshootOpen(true)}>🔧 Troubleshoot</button>
              <button className="adm-regen" onClick={() => setShowSupplies(true)}>+ Add supplies</button>
            </div>
          )}
        </>
      ) : isAdmin ? (
        <div className="adm-prep-actions" style={{ flexWrap: "wrap" }}>
          <button className="adm-btn primary" onClick={() => generate()} disabled={generating}>{generating ? "Generating…" : "Generate pack list from menu"}</button>
          <button className="adm-btn" onClick={() => setPrepAIOpen(true)}>✨ AI prep list</button>
          <button className="adm-btn ts-btn" onClick={() => setTroubleshootOpen(true)}>🔧 Troubleshoot</button>
        </div>
      ) : <div className="h-sub">No pick list yet.</div>}
      {prepAIOpen && (
        <EventPrepAI ownerType={target.kind} ownerId={target.id} title={name ?? (isEvent ? "Event" : "Stop")}
          onClose={() => setPrepAIOpen(false)} onAdded={load} />
      )}
      {troubleshootOpen && (
        <TroubleshootAI ownerType={target.kind} ownerId={target.id} title={name ?? (isEvent ? "Event" : "Stop")}
          onClose={() => setTroubleshootOpen(false)} onLogged={load} />
      )}

      {/* Menu & rig — the same flags an event carries; drives "Generate pack list from menu" for both. */}
      <MenuEditor ownerType={target.kind} ownerId={target.id} isAdmin={isAdmin} onChanged={load} />

      {/* Brew serving this event/stop — sits right under Menu & rig (a batch can serve several). */}
      {brewBatches.length > 0 && (
        <div className="brewlink">
          <div className="brewlink-h">🍺 Brew coming to this {isEvent ? "event" : "stop"}</div>
          {brewBatches.map((b) => (
            <div key={b.id} className="brewlink-row">
              <span className="brewlink-name">{b.recipe_name || "Batch"} · {b.batch_gal} gal</span>
              <span className="brewlink-st">{b.status}{b.ready_at && (b.status === "brewing" || b.status === "planned") ? ` · ready ${new Date(b.ready_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}</span>
            </div>
          ))}
        </div>
      )}

      {/* Run-of-show / "when do we leave" planner — identical for events and stops. */}
      {isAdmin && (
        <div className="adm-prep-actions" style={{ marginTop: 10 }}>
          <button className="adm-regen" onClick={() => setPlanOpen(true)}>🗓️ Schedule · when to leave</button>
        </div>
      )}
      {planOpen && (
        <EventDayPlanner
          ownerType={target.kind} eventId={target.id} title={name ?? (isEvent ? "Event" : "Stop")}
          eventDay={isEvent ? (ev?.day ?? null) : stopMeta.day}
          planDays={isEvent ? Math.max(1, ev?.plan_days ?? 1) : stopMeta.plan_days}
          onPlanDays={(n) => {
            if (isEvent) { supabase?.from("events").update({ plan_days: n }).eq("id", target.id).then(() => {}); }
            else { setStopMeta((m) => ({ ...m, plan_days: n })); supabase?.from("stops").update({ plan_days: n }).eq("id", target.id).then(() => {}); }
          }}
          onClose={() => setPlanOpen(false)} />
      )}

      {/* Load-out & tow + pack-out plan, scoped to this event/stop — part of the one hub. */}
      {isAdmin && (
        <>
          <button type="button" className="prep-collapse" style={{ marginTop: 10 }} onClick={() => setLoadoutOpen((o) => !o)} aria-expanded={loadoutOpen}>
            <span className="prep-collapse-l"><b>🚚 Load-out &amp; tow</b><span>space plan · tongue weight · the load checklist</span></span>
            <span className={`ev-chev${loadoutOpen ? " open" : ""}`}>›</span>
          </button>
          <div className="adm-prep-actions" style={{ marginTop: 8 }}>
            <button className="adm-regen" onClick={() => setPackPlanOpen(true)}>📦 Pack-out plan · kegs vs bottles</button>
          </div>
        </>
      )}
      {loadoutOpen && isAdmin && <TrailerLoadout lockTo={{ kind: target.kind, id: target.id }} />}
      {packPlanOpen && <PackPlan ownerType={target.kind} ownerId={target.id} title={name ?? ""} onClose={() => setPackPlanOpen(false)} />}

      {/* Incidents logged here by the Troubleshoot agent — resolve or delete them. */}
      <IncidentLog ownerCol={ownerCol as "event_id" | "stop_id"} ownerId={target.id} />

      {/* How the crew shows up — dress code + call details. Leadership edits; assigned crew read it. */}
      <DayBrief ownerCol={ownerCol as "event_id" | "stop_id"} ownerId={target.id} isAdmin={isAdmin} />
      <NotesForTarget ownerCol={ownerCol as "event_id" | "stop_id"} ownerId={target.id} />

      {/* Nuke / reset — wipe the prep + schedule built for this event/stop and start clean. */}
      {isAdmin && total > 0 && (
        <div className="adm-reset-row">
          <button type="button" className="adm-reset-btn" onClick={resetAll} disabled={generating}>🧨 Reset this {isEvent ? "event" : "truck stop"} — clear prep &amp; schedule</button>
        </div>
      )}

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

      {onHand.length > 0 && (
        <div className="onhand carryin">
          <div className="onhand-h">📦 On hand now <span>carried in — correct any count</span></div>
          {onHand.map((o) => (
            <div key={o.item} className="onhand-row">
              <span className="onhand-label">{o.item}</span>
              <span className="onhand-nums">
                <input type="number" className="onhand-in" defaultValue={o.bal} onBlur={(e) => adjustOnHand(o.item, e.target.value)} aria-label={`On hand ${o.item}`} />
                <span className="onhand-of">on hand</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {tasks.some((t) => t.target_qty != null) && (
        <div className="onhand">
          <div className="onhand-h">On hand <span>plan → confirm what&apos;s real</span></div>
          {tasks.filter((t) => t.target_qty != null).map((t) => {
            const a = t.actual_qty, plan = t.target_qty as number;
            const short = a != null && a < plan;
            return (
              <div key={t.id} className={`onhand-row${a != null ? " done" : ""}`}>
                <span className="onhand-label">{t.label}</span>
                <span className="onhand-nums">
                  <input type="number" min="0" className="onhand-in" defaultValue={a ?? ""} placeholder="—"
                    onBlur={(e) => { if ((e.target.value === "" ? null : Number(e.target.value)) !== (a ?? null)) confirmQty(t, e.target.value); }} aria-label={`Confirm actual for ${t.label}`} />
                  <span className="onhand-of">/ {plan}{a != null && <b className={short ? "shy" : "ok"}>{short ? `· ${plan - a} short` : "· on hand"}</b>}</span>
                </span>
              </div>
            );
          })}
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
                  <span className="task-label">{t.label}{t.target_qty != null && <span className="task-qty">{t.actual_qty ?? "—"}/{t.target_qty}</span>}{t.due_at && <span className={`task-due${!t.done && t.due_at < new Date().toISOString() ? " over" : ""}`}>{!t.done && t.due_at < new Date().toISOString() ? "⚠ " : ""}due {dueLabel(t.due_at)}</span>}</span>
                </button>
                <div className="task-right">
                  {t.link && <a className="adm-task-link" href={t.link} target="_blank" rel="noopener noreferrer" aria-label="Open reference / application">↗</a>}
                  <button type="button" className="task-discuss" onClick={() => setOpenThread(openThread === t.id ? null : t.id)} aria-label={`Discuss ${t.label}`}>💬{counts[t.id] ? <span className="cmt-count">{counts[t.id]}</span> : <span className="task-discuss-l">Discuss</span>}</button>
                  {isAdmin && <button type="button" className="task-discuss" onClick={() => openTask(t.id, "event")} aria-label={`Edit ${t.label}`} title="Edit task">✎</button>}
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
          <input type="date" className="subpitch-email adm-task-due" style={{ marginBottom: 0 }} value={newTaskDue} onChange={(e) => setNewTaskDue(e.target.value)} aria-label="Due date (optional)" title="Due date (optional)" />
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
    <Sheet open onClose={onClose} label="Assign task" header={<div style={{ display: "flex", alignItems: "center" }}>Assign · <b>{task.label}</b></div>}>
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
    </Sheet>
  );
}

// Shared task editor — one bottom sheet that edits ANY event_task (it's polymorphic at the schema
// level: owned by an event, a stop, OR a meeting note). Updates are by id, so the same sheet works
// from Prep and from Meeting Notes; the edit relates straight back to the source. Fills the gap the
// per-surface rows left: rename the task, set its section, type (pack/to-do), and priority.
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
    <Sheet open onClose={onClose} label="Event supplies" header={<div style={{ display: "flex", alignItems: "center" }}>Supplies for · <b>{title}</b></div>}>
        <div className="supply-head">
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
    </Sheet>
  );
}

// ───────────────────────── one stop: go-live + location + notes ─────────────────────────
// Polymorphic location editor — one accordion card that edits EITHER a truck stop OR a vendor/venue,
// dispatching on `kind` to the matching source table. Both share the bulk of the form (name, geocoded
// address pin, POC trio, service dates, notes, archive/delete); the stop adds go-live, a calendar date,
// and the vendor picker. Unifies what used to be StopControl + VendorCard (near-identical), and upgrades
// the vendor to the stop's nicer modal address-pin flow. Stop-only props are optional.
function LocationEditor({ kind, row, index, open, onToggle, onChanged, onArchive, isCur, onGoLive, vendors, onLinkVendor, onOpenPrep, nameOverride }: {
  kind: "stop" | "vendor"; row: Stop | Vendor; index: number; isCur?: boolean; open: boolean; onToggle: () => void;
  onArchive: () => void; onChanged: () => void;
  onGoLive?: (id: string) => void; vendors?: Vendor[]; onLinkVendor?: (v: Vendor | null) => void; onOpenPrep?: () => void;
  // When a stop is vendor-linked, the VENDOR is the place's identity — show its canonical name on
  // every visit row so two visits to one place can't read as two different names (panel finding).
  nameOverride?: string | null;
}) {
  const { toast } = useApp();
  const table = kind === "stop" ? "stops" : "vendors";
  const stop = kind === "stop" ? (row as Stop) : null;
  const displayName = (nameOverride && nameOverride.trim()) || row.name;
  const [name, setName] = useState(row.name);
  const [address, setAddress] = useState(row.address ?? "");
  const [busy, setBusy] = useState(false);
  const [editAddr, setEditAddr] = useState(false);
  const [editFacts, setEditFacts] = useState(false); // FieldOpSheet — quick core-facts editor
  const hasCoords = row.lat != null && row.lng != null;

  // every update carries a WHERE (id) — safe with the safeupdate guard
  const patch = async (p: Record<string, unknown>, msg = "Saved") => {
    const { error } = await supabase!.from(table).update(p).eq("id", row.id);
    toast(error ? `Error: ${error.message}` : msg);
    if (!error) onChanged();
  };
  const saveName = () => { const nm = name.trim(); if (nm && nm !== row.name) patch({ name: nm }, "Name saved"); };
  const saveLocation = async (): Promise<boolean> => {
    const q = address.trim(); if (!q) return false;
    setBusy(true);
    const geo = await geocode(q);
    if (!geo) { setBusy(false); toast("Couldn't find that address — add city & state, then retry."); return false; }
    const { error } = await supabase!.from(table).update({ address: q, location_text: q, lat: geo.lat, lng: geo.lng }).eq("id", row.id);
    // A vendor's location is the source of truth — push it to every linked stop/event so directions
    // stay accurate everywhere the venue is used (audit P1·7: the "edit once, updates everywhere"
    // promise was only half-true — POC read live, but address/coords were snapshotted and went stale).
    if (!error && kind === "vendor") {
      await supabase!.from("stops").update({ address: q, location_text: q, lat: geo.lat, lng: geo.lng }).eq("vendor_id", row.id);
      await supabase!.from("events").update({ location_text: q }).eq("vendor_id", row.id);
    }
    setBusy(false);
    toast(error ? `Error: ${error.message}` : kind === "vendor" ? "Location saved — linked stops & events updated" : "Location pinned — directions are now accurate");
    if (!error) onChanged();
    return !error;
  };
  const remove = async () => {
    const ask = kind === "stop" ? `Delete ${row.name}? This removes the record.` : `Delete ${row.name}? Linked stops/events will unlink.`;
    if (typeof window !== "undefined" && !window.confirm(ask)) return;
    const { error } = await supabase!.from(table).delete().eq("id", row.id);
    toast(error ? `Error: ${error.message}` : kind === "stop" ? "Location deleted" : "Vendor deleted");
    if (!error) onChanged();
  };
  const showPoc = kind === "vendor";
  const stopWhen = kind === "stop" && (row as { starts_at?: string | null }).starts_at
    ? new Date((row as { starts_at?: string | null }).starts_at as string).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;
  const sub = [stopWhen, row.poc_name, row.service_dates, hasCoords ? "pinned" : "no pin"].filter(Boolean).join("  ·  ");
  const tag = kind === "stop" ? `Location ${String(index + 1).padStart(2, "0")}${isCur ? " · Live" : ""}` : `Vendor ${String(index + 1).padStart(2, "0")}`;
  return (
    <div className={`ev-card${isCur ? " live" : ""}${open ? " open" : ""}`}>
      <button className="ev-head" onClick={onToggle} aria-expanded={open}>
        <span className="ev-led" />
        <span className="ev-head-main">
          <span className="ev-tag">{tag}</span>
          <span className="ev-title">{displayName || (kind === "stop" ? "Untitled location" : "Untitled vendor")}</span>
          <span className="ev-sub">{sub || "Tap to set up"}</span>
        </span>
        <span className="ev-head-badges">
          {isCur && <span className="ev-badge live">● Live</span>}
          <span className="ev-chev">›</span>
        </span>
      </button>

      {open && (
        <div className="ev-body">
          {kind === "stop" && onGoLive && (
            <button className={`ev-golive${isCur ? " on" : ""}`} onClick={() => onGoLive(row.id)} disabled={isCur}>
              <span className="ev-golive-dot" />
              <span>{isCur ? "Live here now — guests see this location" : "Go live at this location"}</span>
              <span className="ev-golive-state">{isCur ? "LIVE" : "GO"}</span>
            </button>
          )}

          {kind === "stop" ? (
            /* Identity is the PREP HUB's job (one editor per stop — same rule the calendar
               follows). Route shows the facts and one door to change them. */
            <div className="ev-group">
              <div className="ev-group-h">Location</div>
              <div className="stop-coords ok" style={{ marginTop: 0 }}>{displayName || "Untitled location"}{stopWhen ? ` · ${stopWhen}` : " · no date"}</div>
              <div className={`stop-coords${hasCoords ? " ok" : ""}`}>{hasCoords ? `Pinned · ${(row.lat as number).toFixed(4)}, ${(row.lng as number).toFixed(4)}` : "No pin yet — add the address for accurate directions"}</div>
              {/* the facts change HERE, in two taps (FieldOpSheet) — the prep hub stays the deep surface */}
              <button type="button" className="adm-btn" onClick={() => setEditFacts(true)}>Edit name, date, time &amp; address ›</button>
              {onOpenPrep && <button type="button" className="adm-btn" onClick={onOpenPrep}>Full prep — menu, staffing, run-of-show ›</button>}
              {editFacts && (
                <FieldOpSheet kind="stop" id={row.id} onClose={() => setEditFacts(false)}
                  onSaved={() => { setEditFacts(false); onChanged(); }} onOpenPrep={onOpenPrep} />
              )}
            </div>
          ) : (
          <div className="ev-group">
            <div className="ev-group-h">Venue</div>
            <input className="ev-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} maxLength={120} placeholder="Vendor / venue name" />
            <button type="button" className="ev-fieldbtn" onClick={() => setEditAddr(true)}>
              <span className="ev-fieldbtn-l">Address</span>
              <span className={`ev-fieldbtn-v${address.trim() ? "" : " ph"}`}>{address.trim() || "Tap to add — we'll pin it on the map"}</span>
              <span className="ev-fieldbtn-chev">›</span>
            </button>
            <div className={`stop-coords${hasCoords ? " ok" : ""}`}>{hasCoords ? `Pinned · ${(row.lat as number).toFixed(4)}, ${(row.lng as number).toFixed(4)}` : "No pin yet — add an address for accurate directions"}</div>
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
          )}

          {kind === "stop" && vendors && onLinkVendor && (
            <VendorPicker vendors={vendors} vendorId={stop?.vendor_id} onLink={onLinkVendor} onCreated={onChanged}
              onPickLocation={(loc) => patch({ address: loc.address ?? null, location_text: loc.location_text ?? loc.label, lat: loc.lat ?? null, lng: loc.lng ?? null }, `Stop set to ${loc.label}`)} />
          )}

          {showPoc && (
            <div className="ev-group">
              <div className="ev-group-h">Point of contact</div>
              <input className="ev-input" defaultValue={row.poc_name ?? ""} placeholder="POC name" maxLength={120} onBlur={(e) => { if ((e.target.value.trim() || null) !== (row.poc_name ?? null)) patch({ poc_name: e.target.value.trim() || null }, "Contact saved"); }} />
              <input className="ev-input" type="tel" defaultValue={row.poc_phone ?? ""} placeholder="Phone" maxLength={40} onBlur={(e) => { if ((e.target.value.trim() || null) !== (row.poc_phone ?? null)) patch({ poc_phone: e.target.value.trim() || null }, "Contact saved"); }} />
              <input className="ev-input" type="email" defaultValue={row.poc_email ?? ""} placeholder="Email" maxLength={160} onBlur={(e) => { if ((e.target.value.trim() || null) !== (row.poc_email ?? null)) patch({ poc_email: e.target.value.trim() || null }, "Contact saved"); }} />
            </div>
          )}

          {kind === "vendor" && (
            <div className="ev-group"><div className="ev-group-h">Dates of service</div><input className="ev-input" defaultValue={row.service_dates ?? ""} placeholder="e.g. Saturdays · May – Aug" maxLength={200} onBlur={(e) => { if ((e.target.value.trim() || null) !== (row.service_dates ?? null)) patch({ service_dates: e.target.value.trim() || null }, "Saved"); }} /></div>
          )}

          {kind === "vendor" && (
            <div className="ev-group">
              <div className="ev-group-h">Notes</div>
              <textarea className="ev-input ev-area" rows={2} maxLength={1000} defaultValue={row.notes ?? ""} placeholder="Anything to remember about this vendor" onBlur={(e) => { if (e.target.value !== (row.notes ?? "")) patch({ notes: e.target.value.trim() || null }, "Details saved"); }} />
            </div>
          )}

          <div className="ev-card-foot">
            {kind === "stop" && onOpenPrep && <button className="adm-btn" style={{ marginRight: "auto" }} onClick={onOpenPrep}>Open prep hub ›</button>}
            {kind === "stop" && onOpenPrep && <button className="ev-archive ev-complete" onClick={onOpenPrep}>✓ Wrap up in the hub ›</button>}
            {kind === "vendor" && <button className="ev-archive" onClick={onArchive}>Archive</button>}
            {kind === "vendor" && <button className="ev-delete" onClick={remove}>Delete</button>}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── live truck control ─────────────────────────
function LiveControl({ compact = false, manage = false }: { compact?: boolean; manage?: boolean }) {
  const { toast } = useApp();
  const router = useRouter();
  const { setSection } = useOperatorSection();
  const openPrep = (id: string) => { try { localStorage.setItem("gt3-prep-open", `stop:${id}`); } catch { /* ignore */ } setSection("prep"); };
  const [stops, setStops] = useState<Stop[]>([]);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [err, setErr] = useState("");
  const [posBusy, setPosBusy] = useState(false);
  const [openStopId, setOpenStopId] = useState<string | null>(null); // single-open accordion
  const [showArchStops, setShowArchStops] = useState(false);
  const [showPastStops, setShowPastStops] = useState(false);
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

  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["live_status", "stops"], load);

  // Optimistic flip first (instant), then direct, RLS-protected writes — every UPDATE
  // carries an explicit filter so Supabase's "no UPDATE without WHERE" guard is happy,
  // and it doesn't depend on the admin_set_live RPC (which ran a bare UPDATE).
  const goLive = async (stopId: string) => {
    haptic(HAPTIC.arm);
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
  const addStop = async (name: string) => {
    const { data, error } = await supabase!.from("stops").insert({ name, status: "upcoming", sort: stops.length }).select("id").single();
    if (error) { setErr(error.message); toast(`Couldn't add — ${error.message}`, "error"); }
    else { if (data) setOpenStopId((data as { id: string }).id); toast("Location added — fill in its details"); }
    load();
  };
  // "Stop here again" (0226 route redesign): a repeat visit clones the place's identity — name,
  // location, vendor link, menu/rig — into a fresh UNDATED stop. The place stays ONE place on the
  // route; only the visit is new. (A real recurrence engine is deliberately not built — a clone +
  // date is the flexible version of it.)
  const stopAgain = async (tpl: Stop) => {
    const { data, error } = await supabase!.from("stops").insert({
      name: tpl.name, location_text: tpl.location_text, address: tpl.address, lat: tpl.lat, lng: tpl.lng,
      vendor_id: tpl.vendor_id ?? null, rig: tpl.rig ?? null, menu_tier: tpl.menu_tier ?? null,
      order_ahead_enabled: tpl.order_ahead_enabled ?? false, pickup_enabled: tpl.pickup_enabled ?? false,
      status: "upcoming", sort: stops.length,
    }).select("id").single();
    if (error) { toast(`Couldn't add the visit — ${error.message}`, "error"); return; }
    if (data) setOpenStopId((data as { id: string }).id);
    toast(`${tpl.name} — new visit added. Set its date & time.`);
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
  // Road-ahead partition (mirrors /truck's 8h grace): a visit whose start is >8h past — and isn't the
  // stop we're live at — is stale. It must not sit in the active route as a current LOCATION row; it
  // folds into "Past visits" below instead of vanishing (the auto-archive cron files it eventually,
  // but the UI can't wait on that). One definition, shared by the route grouping and Past visits.
  const graceMs = Date.now() - 8 * 3600 * 1000;
  const isAhead = (s: Stop) => !s.starts_at || new Date(s.starts_at).getTime() > graceMs || (s.id === live?.current_stop_id && !!live?.is_live);
  const stale = active.filter((s) => !isAhead(s));

  return (
    <div className="adm-sec">
      <div className="sec">Live truck {!compact && <InlineCreate label="+ Add location" placeholder="Location name" onCreate={addStop} style={{ marginLeft: "auto" }} />}</div>
      {err && <div className="adm-attn" role="alert">Backend error: {err}</div>}
      {compact ? (
        /* THE TRUCK INSTRUMENT — one panel, not a stack of floating cards (owner call). Row 1 is
           the state (LED · live-at/offline · the one primary action); the stop list and broadcast
           controls are rows of the same instrument, not separate cards. */
        <div className={`liveinst${live?.is_live ? " on" : ""}`}>
          <div className="liveinst-row main">
            <span className={`adm-dot${live?.is_live ? " on" : ""}`} />
            <div className="liveinst-state">
              <b>{live?.is_live ? "LIVE" : "OFFLINE"}</b>
              <span>{live?.is_live ? (curStop?.name ?? "on location") : (active[0] ? `next · ${active[0].name}` : "no stops scheduled")}</span>
            </div>
            {live?.is_live
              ? <button className="adm-btn ghost" onClick={pause}>Go offline</button>
              : (active[0] && <button className="adm-btn primary liveinst-go" onClick={() => goLive(active[0].id)}>Go live</button>)}
          </div>
          {live?.is_live ? (
            <div className="liveinst-row">
              {!broadcasting && !live?.pos_updated_at && <span className="liveinst-warn">Map dot off —</span>}
              <span className="liveinst-sub">{broadcasting ? "● Broadcasting — dot moves with you" : posLabel}</span>
              {broadcasting
                ? <button className="adm-btn ghost" onClick={stopBroadcast}>Stop</button>
                : <span style={{ display: "flex", gap: 8 }}><button className="adm-btn ghost" onClick={pinHere} disabled={posBusy}>{posBusy ? "Pinning…" : "Pin once"}</button><button className="adm-btn primary" onClick={startBroadcast}>Broadcast</button></span>}
            </div>
          ) : null}
          <button type="button" className="adm-golink" onClick={() => setSection("stops")}>{active.length > 1 ? `${active.length - 1} more location${active.length > 2 ? "s" : ""} · ` : ""}Locations &amp; ordering dial · Stops ›</button>
        </div>
      ) : (
      <>
      <div className="adm-live">
        {!manage && <div className="adm-live-status">
          <span className={`adm-dot${live?.is_live ? " on" : ""}`} />
          <span><b>{live?.is_live ? "Live now" : "Offline"}</b>{live?.is_live && curStop ? <span className="adm-live-at"> · {curStop.name}</span> : null}</span>
        </div>}
        {/* The ordering dial (0137): when cup pre-orders open. Same rule everywhere — menu sheet,
            checkout, and the charge API. Pack reserves are always open regardless. Prep-day work,
            so it lives in Plan › Truck stops; the Now panel stays go-live/offline/broadcast only. */}
        {!compact && <div className="adm-lead">
          <span className="adm-lead-k">Cup orders open</span>
          <div className="adm-lead-opts" role="radiogroup" aria-label="When cup pre-orders open">
            {([[0, "Live only"], [2, "2h before"], [4, "4h before"], [8, "8h before"]] as const).map(([h, label]) => (
              <button key={h} type="button" role="radio" aria-checked={(live?.preorder_lead_h ?? 4) === h}
                className={`adm-lead-opt${(live?.preorder_lead_h ?? 4) === h ? " on" : ""}`}
                onClick={async () => {
                  setLive((l) => (l ? { ...l, preorder_lead_h: h } : l));
                  const { error } = await supabase!.from("live_status").update({ preorder_lead_h: h }).eq("id", 1);
                  if (error) { toast(`Couldn't save — ${error.message}`, "error"); load(); }
                  else toast(h === 0 ? "Cups sell only while you're live" : `Cup orders open ${h}h before a stop`);
                }}>{label}</button>
            ))}
          </div>
        </div>}
        {!manage && live?.is_live && <button className="adm-btn ghost" onClick={pause}>Go offline</button>}
      </div>
      {!manage && live?.is_live && (
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

      {/* THE ROUTE, BY PLACE (0226 redesign): the same location never reads as two locations.
          Stops group under their PLACE — the vendor when linked, else the normalized name — with
          the visits nested inside and "+ Stop here again" for repeats. Single-visit unlinked
          one-offs stay flat rows (a card of one is chrome, not clarity). */}
      <div className="ev-list" style={{ marginTop: 12 }}>
        {(() => {
          // Road AHEAD only — stale (past) visits are partitioned out at component scope (`isAhead`)
          // and rendered under "Past visits" below, so the same location never reads as two places.
          const placeKey = (s: Stop) => s.vendor_id ? `v:${s.vendor_id}` : `t:${(s.name || s.location_text || s.address || "").trim().toLowerCase()}`;
          const groups: { key: string; vendor: Vendor | null; rows: Stop[] }[] = [];
          for (const s of active.filter(isAhead)) {
            const k = placeKey(s);
            let g = groups.find((x) => x.key === k);
            if (!g) { g = { key: k, vendor: s.vendor_id ? vendors.find((v) => v.id === s.vendor_id) ?? null : null, rows: [] }; groups.push(g); }
            g.rows.push(s);
          }
          const fmtNext = (rows: Stop[]) => {
            // Mirrors /truck: 8h grace, done/completed visits excluded. Past-only reads "last ·",
            // never a stale "next ·" (panel finding).
            const live = rows.filter((r) => r.starts_at && r.status !== "done" && !r.completed_at);
            const dated = live.map((r) => new Date(r.starts_at as string)).sort((a, b) => a.getTime() - b.getTime());
            const next = dated.find((d) => d.getTime() > Date.now() - 8 * 3600 * 1000);
            // Relative + absolute, so the weekday can't misread as "next Saturday" (relativeDay: This Sat · Jul 18).
            if (next) return `${relativeDay(next)} · ${next.toLocaleDateString([], { month: "short", day: "numeric" })}`;
            const last = dated[dated.length - 1];
            return last ? `${relativeDay(last)} · ${last.toLocaleDateString([], { month: "short", day: "numeric" })}` : "undated";
          };
          let idx = -1;
          return groups.map((g) => {
            const editors = g.rows.map((s) => {
              idx += 1;
              return (
                <LocationEditor
                  key={s.id}
                  kind="stop"
                  row={s}
                  index={idx}
                  isCur={Boolean(s.id === live?.current_stop_id && live?.is_live)}
                  open={openStopId === s.id}
                  onToggle={() => setOpenStopId(openStopId === s.id ? null : s.id)}
                  onGoLive={goLive}
                  onArchive={() => archiveStop(s.id)}
                  onChanged={load}
                  vendors={vendors}
                  onLinkVendor={(v) => linkVendor(s.id, v)}
                  onOpenPrep={() => openPrep(s.id)}
                  nameOverride={g.vendor?.name ?? null}
                />
              );
            });
            if (g.rows.length === 1 && !g.vendor) return <div key={g.key}>{editors}</div>;
            return (
              <div className="place-card" key={g.key}>
                <div className="place-head">
                  <b>{g.vendor?.name ?? g.rows[0].name}</b>
                  <span className="place-sub">{g.rows.length > 1 ? `${g.rows.length} visits` : "1 visit"}{g.vendor ? " · vendor-linked" : ""}{g.vendor?.status === "pending" ? " · pending" : ""}</span>
                  <span className="place-next">{fmtNext(g.rows)}</span>
                </div>
                {editors}
                <button type="button" className="place-again" onClick={() => {
                  // Template = the NEWEST visit by date (sort order isn't recency — quick-add paths
                  // insert with sort 0; panel finding), so the clone carries the latest flags.
                  const byDate = [...g.rows].sort((a, b) => new Date(a.starts_at ?? 0).getTime() - new Date(b.starts_at ?? 0).getTime());
                  stopAgain(byDate[byDate.length - 1] ?? g.rows[g.rows.length - 1]);
                }}>＋ Stop here again — new visit, same place</button>
              </div>
            );
          });
        })()}
      </div>
      {active.length === 0 && <div className="ev-empty">No locations yet. Tap <b>+ Add location</b> to create one{archived.length ? ", or reopen one below" : ""}.</div>}
      {active.length > 0 && stale.length === active.length && <div className="ev-empty">Nothing on the road ahead — every location&apos;s last visit has passed. See <b>Past visits</b> below, or tap <b>+ Add location</b>.</div>}

      {/* PAST VISITS — stale (past-dated) unarchived stops fold here instead of vanishing from the
          route or lingering as a false "next" location. They stay one tap from restore/again. */}
      {stale.length > 0 && (
        <div className="ev-archived">
          <button className="ev-arch-head" onClick={() => setShowPastStops((v) => !v)} aria-expanded={showPastStops}>
            Past visits · {stale.length}<span className={`ev-chev${showPastStops ? " open" : ""}`}>›</span>
          </button>
          {showPastStops && stale
            .slice()
            .sort((a, b) => new Date(b.starts_at ?? 0).getTime() - new Date(a.starts_at ?? 0).getTime())
            .map((s) => {
              const when = s.starts_at ? new Date(s.starts_at).toLocaleDateString([], { month: "short", day: "numeric" }) : null;
              return (
                <div className="ev-arch-row" key={s.id}>
                  <span className="ev-arch-name">{s.name || "Untitled location"}{when ? ` · ${when}` : ""}</span>
                  <button className="ev-arch-btn" onClick={() => stopAgain(s)}>Stop again</button>
                  <button className="ev-arch-btn" onClick={() => archiveStop(s.id)}>Archive</button>
                </div>
              );
            })}
        </div>
      )}

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
      </>
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
// push engine as event/stop prep. Leadership-only (RLS gates to event_manager/crew/owner).
function MeetingNotes() {
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const isAdmin = roleOf(profile) === "admin" || roleOf(profile) === "owner";
  const meId = user?.id ?? null;
  const meName = profile?.display_name?.trim() || "Me";
  const [notes, setNotes] = useState<MeetingNote[]>([]);
  const [events, setEvents] = useState<{ id: string; title: string }[]>([]);
  const [noteStops, setNoteStops] = useState<{ id: string; name: string | null }[]>([]);
  const [staff, setStaff] = useState<{ id: string; display_name: string | null; role?: string | null }[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [cTitle, setCTitle] = useState("");
  const [cDate, setCDate] = useState(() => localToday());
  const [cSummary, setCSummary] = useState("");
  const [cBody, setCBody] = useState("");
  const [cActions, setCActions] = useState<{ title: string; category: string; critical: boolean; assignee?: string | null }[]>([]);
  const [cLink, setCLink] = useState(""); // "" | event:<id> | stop:<id> | opp:<id>
  const [cVis, setCVis] = useState<"private" | "team" | "collab">("private");
  const [visTouched, setVisTouched] = useState(false);
  const [noteOpps, setNoteOpps] = useState<{ id: string; label: string }[]>([]);
  const [noteVendors, setNoteVendors] = useState<{ id: string; name: string | null }[]>([]);
  const [saving, setSaving] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [mineOnly, setMineOnly] = useState(false);

  const summarize = async () => {
    if (!supabase || summarizing) return;
    const src = (cBody.trim() || cSummary.trim());
    if (!src) { toast("Add a transcript or recap first"); return; }
    setSummarizing(true);
    try {
      const r = await authedFetch("/api/agents/summarize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: src }) });
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
    supabase.from("stops").select("id, name").is("archived_at", null).neq("status", "done").then(({ data }) => setNoteStops((data as { id: string; name: string | null }[]) ?? []));
    supabase.from("opportunities").select("id, stage, vendors(name)").not("stage", "in", "(won,lost)").then(({ data }) =>
      setNoteOpps((((data ?? []) as unknown) as { id: string; vendors: { name: string } | null }[]).map((o) => ({ id: o.id, label: o.vendors?.name ?? "Opportunity" }))));
    supabase.from("vendors").select("id, name").is("archived_at", null).order("name").then(({ data }) => setNoteVendors((data as { id: string; name: string | null }[]) ?? []));
    supabase.from("profiles").select("id, display_name, role").neq("role", "member").then(({ data }) => setStaff((data as { id: string; display_name: string | null; role?: string | null }[]) ?? []));
  }, [load]);
  useRealtimeTable("meeting_notes", load);

  const save = async () => {
    if (!supabase || !cTitle.trim() || saving) return;
    setSaving(true);
    const linkEvent = cLink.startsWith("event:") ? cLink.slice(6) : null;
    const linkStop = cLink.startsWith("stop:") ? cLink.slice(5) : null;
    const linkOpp = cLink.startsWith("opp:") ? cLink.slice(4) : null;
    const linkVendor = cLink.startsWith("vendor:") ? cLink.slice(7) : null;
    const { data, error } = await supabase.from("meeting_notes").insert({
      title: cTitle.trim(), met_on: cDate, summary: cSummary.trim() || null,
      body: cBody.trim() || null, event_id: linkEvent, stop_id: linkStop, opportunity_id: linkOpp,
      vendor_id: linkVendor, visibility: cVis, created_by: meId,
    }).select("id").single();
    // Follow-ups ride the ONE task engine. Linked note → tasks file under the event/stop (so they
    // land on its prep checklist); no link → note-owned as before. origin_note_id (0167) is pure
    // attribution — the note always knows the tasks it spawned, wherever they live.
    const noteId = (data as { id: string } | null)?.id;
    if (!error && noteId && cActions.length) {
      const owner = linkEvent ? { event_id: linkEvent } : linkStop ? { stop_id: linkStop } : { meeting_note_id: noteId };
      const { data: made } = await supabase.from("event_tasks").insert(cActions.map((a, i) => ({
        ...owner, origin_note_id: noteId, label: a.title, kind: "task", section: "Follow-up",
        critical: a.critical, assignee: a.assignee ?? null, sort: 1000 + i,
      }))).select("id, label, assignee");
      // Assigned follow-ups ping their partner — the alert carries kind task_assigned, so it lands
      // in their My Day and is completable right on the card (0174). No leaving the note to delegate.
      const meFirst = (profile?.display_name || "A teammate").split(" ")[0];
      for (const t of ((made ?? []) as { id: string; label: string; assignee: string | null }[])) {
        if (t.assignee) raiseAlert({ severity: "critical", category: "task", kind: "task_assigned", subject_id: t.id,
          title: `${meFirst} assigned you: ${t.label}`.slice(0, 180), body: `From the note "${cTitle.trim()}"`.slice(0, 300),
          target_user_id: t.assignee, created_by: meId });
      }
    }
    setSaving(false);
    if (error) { toast(`Error: ${error.message}`, "error"); return; }
    const dest = linkEvent ? "the event's prep list" : linkStop ? "the stop's prep list" : "the note";
    toast(`Note saved${cActions.length ? ` · ${cActions.length} task${cActions.length === 1 ? "" : "s"} → ${dest}` : ""}`);
    setCTitle(""); setCSummary(""); setCBody(""); setCLink(""); setCVis("private"); setVisTouched(false); setCActions([]); setComposing(false);
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
      <div className="sec">Notes <span className="adm-pill">{notes.length}</span></div>
      <div className="h-sub note-intro">For yourself or the team — pick who sees each one (🔒 just me · 👥 team · 🤝 team + comments). Tag follow-ups and they land in My&nbsp;Tasks with a notification. Meeting recap? Paste the transcript and ✨ summarize.</div>

      <button type="button" className="note-new" onClick={() => setComposing(true)}>✎ New note</button>
      {composing && (
        <Sheet open onClose={() => { setComposing(false); setCActions([]); }} label="New note" className="note-lux"
          header={<div className="note-lux-head"><span className="note-lux-eyb">New note</span><button type="button" className="qd-x" onClick={() => { setComposing(false); setCActions([]); }} aria-label="Close">✕</button></div>}
          footer={<div className="note-actions"><button type="button" className="note-cancel" onClick={() => { setComposing(false); setCActions([]); }}>Cancel</button><button type="button" className="note-save" disabled={!cTitle.trim() || saving} onClick={save}>{saving ? "Saving…" : "Save note"}</button></div>}>
          <div className="note-composer">
            <input className="note-in note-lux-title" placeholder="What&rsquo;s this note about?" value={cTitle} onChange={(e) => setCTitle(e.target.value)} autoFocus />
            <div className="note-row">
              <input type="date" className="note-in" value={cDate} onChange={(e) => setCDate(e.target.value)} aria-label="Date" />
              <select className="note-in" value={cLink} onChange={(e) => { setCLink(e.target.value); if (!visTouched) setCVis(e.target.value ? "collab" : "private"); }} aria-label="Attach to">
                <option value="">Attach to&hellip; (nothing)</option>
                <optgroup label="Events">
                  {events.map((ev) => <option key={ev.id} value={`event:${ev.id}`}>{ev.title}</option>)}
                </optgroup>
                <optgroup label="Truck stops">
                  {noteStops.map((s) => <option key={s.id} value={`stop:${s.id}`}>{s.name || "Untitled location"}</option>)}
                </optgroup>
                <optgroup label="Pipeline">
                  {noteOpps.map((o) => <option key={o.id} value={`opp:${o.id}`}>{o.label}</option>)}
                </optgroup>
                <optgroup label="Partners">
                  {noteVendors.map((v) => <option key={v.id} value={`vendor:${v.id}`}>{v.name || "Partner"}</option>)}
                </optgroup>
              </select>
            </div>
            <div className="note-vis-chips" role="radiogroup" aria-label="Who can see this note">
              {([["private","🔒 Just me"],["team","👥 Team"],["collab","🤝 Team + comments"]] as const).map(([v,l]) => (
                <button key={v} type="button" role="radio" aria-checked={cVis === v} className={`note-vischip${cVis === v ? " on" : ""}`} onClick={() => { setCVis(v); setVisTouched(true); }}>{l}</button>
              ))}
            </div>
            <textarea className="note-area" placeholder="The note — a thought, a plan, a recap…" value={cSummary} onChange={(e) => setCSummary(e.target.value)} rows={cSummary.length > 200 ? 10 : 3} />
            <details className="note-transcript">
              <summary>Transcript or attachments? Add them and ✨ summarize</summary>
              <NoteAttach onText={(t) => setCBody((b) => (b ? b + "\n\n" + t : t))} />
              <textarea className="note-area" placeholder="Paste a transcript — or attach files above to fill this in…" value={cBody} onChange={(e) => setCBody(e.target.value)} rows={4} />
              <button type="button" className="note-suggest note-sum" onClick={summarize} disabled={summarizing}>{summarizing ? "Summarizing…" : "✨ Summarize → title · recap · tasks"}</button>
            </details>
            <div className="note-fu-h">Follow-ups
              <button type="button" className="note-fu-add" onClick={() => setCActions((a) => [...a, { title: "", category: "task", critical: false, assignee: null }])}>+ Add</button>
            </div>
            {cActions.length === 0 && <div className="note-fu-empty">No follow-ups yet — add one and assign it to a partner, or ✨ summarize a transcript to pull them out.</div>}
            {cActions.map((a, i) => (
              <div className="note-fu-edit" key={i}>
                <input className="note-in" placeholder="Follow-up task…" value={a.title} onChange={(e) => setCActions((arr) => arr.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
                <div className="note-fu-edit-r">
                  <select className="note-in" value={a.assignee ?? ""} onChange={(e) => setCActions((arr) => arr.map((x, j) => j === i ? { ...x, assignee: e.target.value || null } : x))} aria-label="Assign to">
                    <option value="">Unassigned</option>
                    {staff.map((m) => <option key={m.id} value={m.id}>{m.display_name?.trim() || "Crew"}</option>)}
                  </select>
                  <button type="button" className={`note-fu-crit${a.critical ? " on" : ""}`} onClick={() => setCActions((arr) => arr.map((x, j) => j === i ? { ...x, critical: !x.critical } : x))} aria-pressed={a.critical} title="Mark critical">⚠️</button>
                  <button type="button" className="note-fu-del" onClick={() => setCActions((arr) => arr.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
                </div>
              </div>
            ))}
          </div>
        </Sheet>
      )}

      {(() => {
        const archivedCount = notes.filter((n) => n.archived_at).length;
        const q = query.trim().toLowerCase();
        const shown = notes.filter((n) => (tab === "archived" ? n.archived_at : !n.archived_at))
          .filter((n) => !mineOnly || n.created_by === meId)
          .filter((n) => !q || n.title.toLowerCase().includes(q) || (n.summary || "").toLowerCase().includes(q) || (events.find((e) => e.id === n.event_id)?.title || "").toLowerCase().includes(q) || (noteStops.find((s) => s.id === n.stop_id)?.name || "").toLowerCase().includes(q));
        return (
          <>
            <div className="note-filter">
              <input className="note-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes…" />
              <div className="note-tabs">
                <button type="button" className={`note-tab${mineOnly ? " on" : ""}`} onClick={() => setMineOnly((v) => !v)}>Mine</button>
                <button type="button" className={`note-tab${tab === "active" ? " on" : ""}`} onClick={() => setTab("active")}>Active</button>
                <button type="button" className={`note-tab${tab === "archived" ? " on" : ""}`} onClick={() => setTab("archived")}>Archived{archivedCount ? ` ${archivedCount}` : ""}</button>
              </div>
            </div>
            {shown.map((n) => (
              <MeetingNoteCard
                key={n.id} note={n} open={openId === n.id} onToggle={() => setOpenId(openId === n.id ? null : n.id)}
                staff={staff} meId={meId} meName={meName} isAdmin={isAdmin}
                eventTitle={events.find((e) => e.id === n.event_id)?.title ?? (n.stop_id ? `📍 ${noteStops.find((s) => s.id === n.stop_id)?.name ?? "location"}` : n.vendor_id ? `🤝 ${noteVendors.find((v) => v.id === n.vendor_id)?.name ?? "Partner"}` : n.opportunity_id ? `💼 ${noteOpps.find((o) => o.id === n.opportunity_id)?.label ?? "Opportunity"}` : null)} onDelete={() => remove(n)}
                onArchive={() => archive(n, !n.archived_at)}
                onVisibility={(v) => setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, visibility: v } : x)))}
              />
            ))}
            {shown.length === 0 && !composing && <div className="h-sub">{q ? "No notes match your search." : tab === "archived" ? "No archived notes." : "No notes yet — tap “New note” after your next sit-down."}</div>}
          </>
        );
      })()}
    </div>
  );
}

function MeetingNoteCard({ note, open, onToggle, staff, meId, meName, isAdmin, eventTitle, onDelete, onArchive, onVisibility }: {
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
  onVisibility?: (v: "private" | "team" | "collab") => void;
}) {
  const { openTask } = useTaskSheet(); // the ONE task editor, on the spine
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
    const { data } = await supabase.from("event_tasks").select("*").or(`meeting_note_id.eq.${note.id},origin_note_id.eq.${note.id}`).order("sort");
    const rows = (data as EventTask[]) ?? [];
    setItems(rows);
    setCounts(await commentCounts("event_task_id", rows.map((r) => r.id)));
  }, [note.id]);
  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);
  useRealtimeTable([{ table: "event_tasks", filter: `meeting_note_id=eq.${note.id}` }, "comments"], load, { enabled: open });

  const staffName = (uid: string) => staff.find((s) => s.id === uid)?.display_name?.trim() || (uid === meId ? meName : "Unnamed crew");
  const firstNameOf = (uid: string) => staffName(uid).split(" ")[0];
  const authorName = note.created_by ? (note.created_by === meId ? "you" : firstNameOf(note.created_by)) : null;

  const add = async () => {
    if (!supabase || !newItem.trim()) return;
    const { error } = await supabase.from("event_tasks").insert({ meeting_note_id: note.id, label: newItem.trim(), kind: "task", section: "Follow-up", sort: items.length });
    setNewItem("");
    if (error) toast(`Error: ${error.message}`, "error"); else load();
  };
  // Agent #1 — let Claude pull the follow-ups out of the recap, proposed for review.
  // Propose how to COMPLETE a follow-up (surfacing answers we already have). Persists on the task.
  // silent=true in the batch auto-propose loop (so one outage doesn't spew toasts); a direct tap surfaces it.
  const resolve = useCallback(async (t: EventTask, silent = false) => {
    if (!supabase || t.ai_proposal || resolving.has(t.id)) return;
    setResolving((s) => new Set(s).add(t.id));
    try {
      const r = await authedFetch("/api/agents/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task_id: t.id }) });
      const j = await r.json();
      if (j.ok) setItems((p) => p.map((x) => (x.id === t.id ? { ...x, ai_proposal: j.proposal, ai_has_answer: j.have_answer } : x)));
      else if (!silent) toast(String(j.error ?? "").includes("ANTHROPIC") ? "AI isn't switched on yet — add the API key" : "Couldn't propose a completion — try again", "error");
    } catch { if (!silent) toast("Couldn't reach the resolve agent — try again", "error"); }
    setResolving((s) => { const n = new Set(s); n.delete(t.id); return n; });
  }, [resolving, toast]);

  const suggest = async () => {
    if (!supabase || suggesting) return;
    setSuggesting(true);
    try {
      const r = await authedFetch("/api/agents/recap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note_id: note.id }) });
      const j = await r.json();
      if (!j.ok) toast(j.error === "AI not configured (set ANTHROPIC_API_KEY)" ? "AI isn't switched on yet — add the API key" : `Error: ${j.error ?? r.status}`, "error");
      else {
        toast(j.added ? `Added ${j.added} follow-up${j.added === 1 ? "" : "s"} — proposing how to finish each…` : "No new action items found");
        await load();
        // Auto-propose a completion for the freshly generated items.
        const { data: fresh } = await supabase.from("event_tasks").select("*").eq("meeting_note_id", note.id).is("ai_proposal", null).order("sort", { ascending: false }).limit(8);
        for (const t of (fresh as EventTask[] ?? [])) await resolve(t, true);
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
      // Staff-wide alerts (0157): every assignee gets the flag; the trigger delivers the push.
      if (next !== user?.id) {
        raiseAlert({
          severity: "critical", category: "task", kind: "task_assigned", subject_id: t.id,
          title: `${profile?.display_name?.split(" ")[0] || "A manager"} assigned you: ${t.label}`,
          body: `Follow-up · ${note.title}`, target_user_id: next, created_by: user?.id ?? null,
        });
      }
    }
  };
  // Promote a follow-up to a can't-miss alert (the "flag this" the talking-point becomes urgent).
  const flag = async (t: EventTask) => {
    await raiseAlert({
      severity: "critical", category: "task", kind: "task_assigned", subject_id: t.id,
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
          <span className="note-meta">{fmtNoteDate(note.met_on)}{authorName ? ` · ${authorName}` : ""}{eventTitle ? ` · ${eventTitle}` : ""}{note.visibility === "private" ? " · 🔒 private" : note.visibility === "team" ? " · 👥 team" : ""}{items.length ? ` · ${openCount}/${items.length} follow-ups` : ""}</span>
        </div>
        <span className={`note-chev${open ? " open" : ""}`} aria-hidden="true">›</span>
      </button>
      {open && (
        <div className="note-body">
          {(note.created_by === meId || isAdmin) && (
            <div className="note-vis-row">
              <span>Who sees this</span>
              <select className="note-in note-vis" value={note.visibility ?? "collab"} onChange={async (e) => {
                if (!supabase) return;
                const v = e.target.value as "private" | "team" | "collab";
                const { error } = await supabase.from("meeting_notes").update({ visibility: v }).eq("id", note.id);
                toast(error ? `Couldn't change — ${error.message}` : v === "private" ? "Now just for you" : v === "team" ? "Team can read it now" : "Team can read & comment now");
                if (!error) onVisibility?.(v);
              }} aria-label="Who can see this note">
                <option value="private">🔒 Just me</option>
                <option value="team">👥 Team — everyone reads</option>
                <option value="collab">🤝 Team + comments</option>
              </select>
            </div>
          )}
          {note.summary && <Markdown source={note.summary} className="note-summary" />}
          {note.body && <details className="note-full"><summary>Full notes</summary><p>{note.body}</p></details>}
          <OpsPlan noteId={note.id} />
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
                {isAdmin && <button type="button" className="note-fu-flag" onClick={() => openTask(t.id, "event")} aria-label="Edit follow-up" title="Edit follow-up">✎</button>}
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
// Inbound (this tab) and outbound (Business › Pipeline) are two lead funnels that BRIDGE, not
// merge (July 2026 redundancy audit): a request can be promoted into a pursuit, and won
// private-event deals surface down here — every event booking visible in one room either way.
type WonPipelineDeal = {
  id: string; value_cents: number | null; won_at: string | null;
  vendors: { name: string } | null; deals: { title: string; line: string | null } | null;
};
function Bookings() {
  const { toast } = useApp();
  const { user } = useAuth();
  const { setSection } = useOperatorSection();
  const [reqs, setReqs] = useState<BookingRequest[]>([]);
  const [wonDeals, setWonDeals] = useState<WonPipelineDeal[]>([]);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [promoteResolve, setPromoteResolve] = useState<{ req: BookingRequest; name: string; candidates: VendorMatch[] } | null>(null);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("booking_requests").select("*").order("created_at", { ascending: false });
    if (data) setReqs(data as BookingRequest[]);
  }, []);
  const loadWon = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("opportunities")
      .select("id, value_cents, won_at, vendors(name), deals!inner(title, line)")
      .eq("stage", "won").eq("deals.line", "private_event")
      .order("won_at", { ascending: false, nullsFirst: false }).limit(20);
    if (data) setWonDeals(data as unknown as WonPipelineDeal[]);
  }, []);
  useEffect(() => { load(); loadWon(); }, [load, loadWon]);
  useRealtimeTable(["booking_requests", "opportunities"], () => { load(); loadWon(); });

  const setStatus = async (id: string, status: BookingRequest["status"]) => {
    const { error } = await supabase!.from("booking_requests").update({ status }).eq("id", id);
    toast(error ? `Error: ${error.message}` : `Marked ${status}`);
    if (!error) load();
  };
  // One tap: the request becomes a lead on the calendar/prep/economics rails — no retyping.
  const makeEvent = async (r: BookingRequest) => {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(r.event_date ?? "") ? r.event_date : null;
    const day_label = day ? ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][new Date(`${day}T12:00:00`).getDay()] : (r.event_date ?? null);
    const { error } = await supabase!.from("events").insert({
      title: r.name ? `${r.name} booking` : "Booking", stage: "lead", day, day_label,
      location_text: r.location_text ?? null, blurb: r.notes?.slice(0, 300) ?? null,
    });
    if (error) { toast(`Couldn't create the event — ${error.message}`, "error"); return; }
    toast("Added to Events as a lead — it's on the calendar now");
    if (r.status === "new") setStatus(r.id, "contacted");
  };
  // The bridge, outbound direction: one tap turns a request into a pursuit on the pipeline —
  // account from the requester (reused if we already know them), stage "talking" (they opened
  // the conversation), and the request context as the first pursuit-trail entry. The request
  // itself stays here, linked, so the button can't double-promote.
  const promote = async (r: BookingRequest, decision?: ResolveDecision) => {
    if (!supabase || !user || promoting) return;
    setPromoting(r.id);
    try {
      const nm = r.name?.trim() || r.email?.trim() || "Booking request";
      // Known-contact pre-check first (email beats name), then the ONE resolver (0226): a
      // look-alike name surfaces the confirm sheet instead of silently minting an account copy.
      let vendorId: string | undefined;
      if (r.email) {
        const { data: byEmail } = await supabase.from("vendors").select("id").eq("poc_email", r.email).limit(1);
        vendorId = byEmail?.[0]?.id;
      }
      if (!vendorId) {
        const res = await resolveVendor(nm, {
          status: "approved", vendorType: "venue", source: "a booking request", decision,
          extra: { poc_name: r.name, poc_email: r.email, poc_phone: r.phone, location_text: r.location_text ?? null },
        });
        if (res.kind === "similar") { setPromoteResolve({ req: r, name: nm, candidates: res.candidates }); return; }
        if (res.kind === "error") { toast(`Couldn't create the account — ${res.message}`, "error"); return; }
        vendorId = res.id;
      }
      const { data: opp, error: oppErr } = await supabase.from("opportunities").insert({
        vendor_id: vendorId, stage: "talking", source: "inbound",
        next_step: "Reply to their request", created_by: user.id,
      }).select("id").single();
      if (oppErr) { toast(`Couldn't open the opportunity — ${oppErr.message}`, "error"); return; }
      const oppId = (opp as { id: string }).id;
      const when = [r.event_date, r.headcount ? `${r.headcount} ppl` : null, r.location_text].filter(Boolean).join(" · ");
      const who = [r.name, r.email, r.phone].filter(Boolean).join(" · ");
      const ctx = [
        "Inbound booking request — promoted from Plan › Bookings.",
        when && `Event: ${when}`,
        who && `Contact: ${who}`,
        r.notes?.trim() && `Notes: ${r.notes.trim().slice(0, 400)}`,
      ].filter(Boolean).join("\n");
      const { error: cErr } = await supabase.from("comments").insert({ strategy_key: `opp:${oppId}`, body: ctx, author_id: user.id });
      if (cErr) toast(`Opportunity's up, but the context note didn't save — ${cErr.message}`, "error");
      const { error: linkErr } = await supabase.from("booking_requests")
        .update({ opportunity_id: oppId, ...(r.status === "new" ? { status: "contacted" } : {}) }).eq("id", r.id);
      if (linkErr) toast(`Opportunity's up, but the request didn't link — ${linkErr.message}`, "error");
      else toast("Promoted — the pursuit lives in Business › Pipeline now");
      load(); loadWon();
    } finally { setPromoting(null); }
  };
  const del = async (r: BookingRequest) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete the booking request from ${r.name ?? "this contact"}? This can't be undone.`)) return;
    setReqs((p) => p.filter((x) => x.id !== r.id)); // optimistic
    const { error } = await supabase!.from("booking_requests").delete().eq("id", r.id);
    if (error) { toast(`Couldn't delete — ${error.message}`, "error"); load(); } else toast("Booking request deleted");
  };

  const open = reqs.filter((r) => r.status === "new").length;
  return (
    <div className="adm-sec">
      <ChiefOfSales onLeads={load} />
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
            <button className="adm-req-mk" onClick={() => makeEvent(r)}>→ Make it an event</button>
            {r.opportunity_id ? (
              <button className="adm-req-mk" onClick={() => setSection("pipeline")}>On the pipeline →</button>
            ) : (
              <button className="adm-req-mk" onClick={() => promote(r)} disabled={promoting === r.id}>{promoting === r.id ? "Promoting…" : "→ Promote to Pipeline"}</button>
            )}
            <button className="adm-req-del" onClick={() => del(r)} aria-label={`Delete booking request from ${r.name ?? "contact"}`}>✕</button>
          </div>
        </div>
      ))}
      {reqs.length === 0 && <div className="h-sub">No requests yet — they land here from the Book the bar form.</div>}
      {wonDeals.length > 0 && (
        <>
          <div className="sec" style={{ marginTop: 20 }}>Won on the pipeline<span className="adm-pill">{wonDeals.length}</span></div>
          <p className="h-sub">Private-event deals the crew closed outbound. Book the dates in Events when they land.</p>
          {wonDeals.map((w) => (
            <div className="adm-req" key={w.id}>
              <div className="adm-member-top">
                <b>{w.vendors?.name ?? "Account"}</b>
                <span className="adm-ref">{w.won_at ? `won ${new Date(w.won_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "won"}</span>
              </div>
              <div className="meta">{w.deals?.title ?? "Private event"}{w.value_cents != null && <> · ${(w.value_cents / 100).toLocaleString()}</>}</div>
              <div className="adm-status">
                <button className="adm-req-mk" onClick={() => setSection("pipeline")}>Open in Pipeline →</button>
              </div>
            </div>
          ))}
        </>
      )}
      {promoteResolve && (
        <VendorResolve name={promoteResolve.name} candidates={promoteResolve.candidates}
          onUse={(c) => { const { req } = promoteResolve; setPromoteResolve(null); promote(req, { linkTo: c.id }); }}
          onAddLocation={async (c) => {
            const { req, name } = promoteResolve; setPromoteResolve(null);
            await addVendorLocation(c.id, { label: name, location_text: req.location_text ?? null });
            promote(req, { linkTo: c.id });
          }}
          onCreateDistinct={() => { const { req } = promoteResolve; setPromoteResolve(null); promote(req, { createDistinct: true }); }}
          onClose={() => setPromoteResolve(null)}
        />
      )}
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
      name: "", price_cents: 1200, stock_total: 12, stock_remaining: 12, status: "draft", sort: rows.length,
    });
    toast(error ? `Error: ${error.message}` : "Reserve created — set details, then set it Live");
    if (!error) load();
  };
  const archive = async (id: string) => {
    if (typeof window !== "undefined" && !window.confirm("Archive this reserve? It disappears from the app.")) return;
    await update(id, { status: "archived" });
  };
  const remove = async (id: string, nm: string) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${nm}" for good?\n\nThis permanently removes the reserve and any claims on it. Can't be undone. (Archive instead if you just want it hidden.)`)) return;
    const { error } = await supabase!.from("reserves").delete().eq("id", id);
    toast(error ? `Couldn't delete — ${error.message}` : "Reserve deleted");
    if (!error) load();
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
            <button className="adm-btn ghost" style={{ color: "#e07a76" }} onClick={() => remove(r.id, r.name)}>Delete</button>
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
  useEffect(() => { load(); }, [load]);
  useRealtimeTable("subscriptions", load);

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
  event_manager: { label: "Event Manager", tier: "lead",   scope: "Everything but Money & Team",    tone: "gold" },
  operator:      { label: "Operator",      tier: "crew",   scope: "Service · Prep · Brew · Garage · Pipeline · Notes · Drive", tone: "cream" },
  contractor:    { label: "Contractor",    tier: "crew",   scope: "Service · Prep · Garage · Notes · Drive", tone: "cream" },
  server:        { label: "Server",        tier: "crew",   scope: "My Day · Live Ops · Notes · Drive", tone: "cream" },
  member:        { label: "Member",        tier: "member", scope: "Customer — loyalty only",        tone: "muted" },
};
const ROLE_ORDER: RoleKey[] = ["owner", "admin", "event_manager", "operator", "contractor", "server", "member"];
const TIERS: { key: "lead" | "crew"; title: string; hint: string }[] = [
  { key: "lead", title: "Leadership", hint: "Run the business" },
  { key: "crew", title: "Crew", hint: "Work the shifts" },
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
  const [isDriver, setIsDriver] = useState(!!m.is_driver);
  const toggleDriver = async () => {
    const next = !isDriver; setIsDriver(next);
    const { error } = await supabase!.rpc("admin_set_driver", { member: m.id, val: next });
    if (error) { setIsDriver(!next); toast(`Error: ${error.message}`); }
    else toast(next ? `${m.display_name ?? "Member"} tagged as driver 🚗` : "Driver tag removed");
  };
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
        {isDriver && <span className="tm-driver" title="Delivery driver">🚗</span>}
      </div>
      <label className="tm-rolepick">
        <select className="adm-role" value={role} onChange={(e) => setRole(e.target.value)} aria-label={`Role for ${m.display_name ?? "member"}`}>
          {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
        </select>
        <i className="tm-scope">{meta.scope}</i>
      </label>
      <button className="tm-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Hide loyalty" : `Loyalty & credit · ${pts} pts`} <span className={`ev-chev${open ? " open" : ""}`} aria-hidden="true">›</span></button>
      {open && (
        <div className="adm-fields tm-loyalty">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" /></label>
          <label>Points<input type="number" min={0} value={pts} onChange={(e) => setPts(Math.max(0, parseInt(e.target.value) || 0))} /></label>
          <label>Credit $<input type="text" inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} /></label>
          <label className="adm-check"><input type="checkbox" checked={founding} onChange={(e) => setFounding(e.target.checked)} />Founding</label>
          {role !== "member" && <label className="adm-check"><input type="checkbox" checked={isDriver} onChange={toggleDriver} />🚗 Driver</label>}
          <button className={`adm-btn${dirty ? " primary" : ""}`} onClick={save} disabled={!dirty || busy}>{busy ? "…" : "Save"}</button>
        </div>
      )}
    </div>
  );
}

function Members() {
  const { user } = useAuth();
  const { setSection } = useOperatorSection();
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
  useEffect(() => { load(); }, [load]);
  useRealtimeTable("profiles", load);

  const ql = q.trim().toLowerCase();
  const staff = members.filter((m) => rawRole(m) !== "member");
  const shown = staff.filter((m) =>
    !ql || (m.display_name ?? "").toLowerCase().includes(ql) || (m.referral_code ?? "").toLowerCase().includes(ql) || ROLE_META[rawRole(m)].label.toLowerCase().includes(ql)
  );
  const customerCount = members.length - staff.length;
  const ownerCount = staff.filter((m) => rawRole(m) === "owner").length;

  return (
    <div className="adm-sec tm">
      <div className="sec">Team · {staff.length}</div>
      {customerCount > 0 && (
        <button type="button" className="team-crm-link" onClick={() => setSection("customers")}>
          {customerCount} customer account{customerCount === 1 ? "" : "s"} moved to <b>Customers</b> — the CRM. This roster is leadership &amp; crew. ›
        </button>
      )}
      {staff.length > 5 && (
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
      {loaded && staff.length === 0 && <div className="h-sub">No one here yet — people appear when they sign in.</div>}
      {loaded && staff.length > 0 && shown.length === 0 && <div className="h-sub">No match for &ldquo;{q}&rdquo;.</div>}
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
    // Reconcile every 15s so Square POS walk-ups + the $/hr clock advance even if a
    // realtime event is missed (matches the KDS's reconcile).
    const recon = setInterval(load, 15000);
    return () => clearInterval(recon);
  }, [load]);
  useRealtimeTable(["orders", "event_sales", "events"], load);
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
      {/* One hero mid-service — sales — and one quiet line. The full plan-vs-actual story
          (ROI, break-even, plan totals) lives in Money → Per-event P&L, not on the Now screen. */}
      <div className="adm-hud-hero"><b>${(stats.cents / 100).toFixed(0)}</b><span>in sales</span></div>
      <p className="adm-hud-line">{stats.orders} order{stats.orders === 1 ? "" : "s"} · ${(perHr / 100).toFixed(0)}/hr{hasPlan && <> · {pctOfPlan}% of plan · net <b className={netUp ? "ok" : "red"}>{usd(recon.actualNetCents)}</b></>}</p>
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

// Event Brief — computed prep intelligence (demand → brew/pack → ingredient pull →
// crew check → readiness → risk flags). Turns the menu/attendance config into knowledge.
function BriefPanel({ e, proj, inventory }: { e: EventRow; proj: Projection; inventory: InventoryResp }) {
  const b = useMemo(() => buildBrief(e, proj), [e, proj]);
  const inv = useMemo(() => inventoryForEvent(inventory.items, e), [inventory, e]);
  return (
    <div className="ev-group ev-brief">
      <div className="ev-group-h">Event brief · what to bring</div>
      <div className="ev-pnl-gauges">
        {/* "Planned", not "Ready" — this scores the plan inputs (menu, permit, crew, water,
            forecast). Prep readiness is the task list's "Loaded n/n"; two different facts. */}
        <div className="gauge"><div className={`gv ${b.readiness >= 80 ? "ok" : b.readiness >= 50 ? "gold" : "red"}`}><NumberRoll value={b.readiness} suffix="%" /></div><div className="gl">Planned</div></div>
        <div className="gauge"><div className="gv"><NumberRoll value={b.projectedUnits} /></div><div className="gl">Units</div></div>
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
// Event lifecycle — Lead → Confirmed → Prep → Live → Done. Live/Done are driven by the green flag
// and archive; the planning stages you set. The current stage is shown everywhere at a glance.
const EVENT_STAGES = [
  { key: "lead", label: "Lead", color: "#9aa0a6" },
  { key: "confirmed", label: "Confirmed", color: "#6fa8dc" },
  { key: "prep", label: "Prep", color: "#e0892b" },
  { key: "live", label: "Live", color: "#2bb3a3" },
  { key: "done", label: "Done", color: "#7bbf6a" },
] as const;
const stageOf = (e: { stage?: string | null; is_live?: boolean }) => (e.is_live ? "live" : (e.stage || "confirmed"));
const stageMeta = (k: string) => EVENT_STAGES.find((s) => s.key === k) ?? EVENT_STAGES[1];

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
  const [prepAIOpen, setPrepAIOpen] = useState(false);
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
          {(() => { const st = stageMeta(stageOf(e)); return <span className="ev-badge stage" style={{ ["--c" as string]: st.color }}>{st.label}</span>; })()}
          {showRoi && <span className={`ev-badge roi${proj.netCents < 0 ? " neg" : ""}`}>ROI {pctInt(proj.roiPct)}%</span>}
          {e.member_only && <span className="ev-badge gold">Members</span>}
          <span className="ev-chev">›</span>
        </span>
      </button>

      {open && (
        <div className="ev-body">
          {/* Lifecycle — where this event stands. Live is set by the green flag below; the rest you set. */}
          <div className="ev-stage" role="tablist" aria-label="Event stage">
            {EVENT_STAGES.map((s) => {
              const cur = stageOf(e) === s.key;
              const settable = !e.is_live && s.key !== "live"; // Live is driven by the green flag, not a tap
              return (
                <button key={s.key} type="button" role="tab" aria-selected={cur} disabled={!settable && !cur}
                  className={`ev-stage-pill${cur ? " on" : ""}`} style={{ ["--c" as string]: s.color }}
                  onClick={() => { if (settable && !cur) onUpdate({ stage: s.key }); }}>{s.label}</button>
              );
            })}
          </div>

          {/* The one action that matters most gets its own banner — throw the green flag. */}
          <button className={`ev-golive${e.is_live ? " on" : ""}`} onClick={() => { if (e.is_live && typeof window !== "undefined" && !window.confirm("Close this event? Sales tracking stops and the command-center HUD goes dark.")) return; onSetLive(!e.is_live); }}>
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

          {/* AI prep — tell it about this event, it builds a grounded to-do list (SOPs + inventory + compliance) */}
          <button type="button" className="ev-prep" onClick={() => setPrepAIOpen(true)}>
            <span className="ev-prep-main">
              <b>✨ AI prep list</b>
              <span>Tell it about this event — it builds the to-do list from your SOPs, inventory &amp; the rules</span>
            </span>
            <span className="ev-prep-go">Build ›</span>
          </button>
          {prepAIOpen && (
            <EventPrepAI ownerType="event" ownerId={e.id} title={e.title}
              onClose={() => setPrepAIOpen(false)}
              onAdded={() => { if (supabase) supabase.from("event_tasks").select("done, critical").eq("event_id", e.id).then(({ data }) => { const rows = (data as { done: boolean; critical: boolean }[]) ?? []; setPrep({ done: rows.filter((r) => r.done).length, total: rows.length, crit: rows.filter((r) => r.critical && !r.done).length }); }); }} />
          )}

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
              <label className="ev-f">Date<input type="date" defaultValue={e.day ?? ""} aria-label="Event date"
                onBlur={(ev) => { const v = ev.target.value || null; if (v !== (e.day ?? null)) { const upd: { day: string | null; day_label?: string } = { day: v }; if (v) upd.day_label = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][new Date(`${v}T12:00:00`).getDay()]; onUpdate(upd); } }} /></label>
              <label className="ev-f">Day<input defaultValue={e.day_label ?? ""} placeholder="SAT" onBlur={(ev) => ev.target.value !== e.day_label && onUpdate({ day_label: ev.target.value })} /></label>
              <label className="ev-f">Start<input defaultValue={e.start_time ?? ""} placeholder="9:00" onBlur={(ev) => (ev.target.value.trim() || null) !== e.start_time && onUpdate({ start_time: ev.target.value.trim() || null })} /></label>
              <label className="ev-f">End<input defaultValue={e.end_time ?? ""} placeholder="2:00" onBlur={(ev) => (ev.target.value.trim() || null) !== e.end_time && onUpdate({ end_time: ev.target.value.trim() || null })} /></label>
              <label className="ev-f">Going<input type="text" readOnly value={`${e.going_count ?? 0} · from RSVPs`} title="Live headcount from member RSVPs — not editable" /></label>
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
              <label className="ev-f">State<input maxLength={20} placeholder="GA" defaultValue={e.state ?? ""} onBlur={(ev) => onUpdate({ state: ev.target.value.trim() || null })} /></label>
              <label className="ev-f">County<input maxLength={40} placeholder="Fulton" defaultValue={e.county ?? ""} onBlur={(ev) => onUpdate({ county: ev.target.value.trim() || null })} /></label>
            </div>
            <div className="ev-grid">
              <label className="ev-f">Attendance<input type="number" min={0} defaultValue={e.expected_attendance ?? 0} onBlur={(ev) => onUpdate({ expected_attendance: Math.max(0, parseInt(ev.target.value) || 0) })} /></label>
              <label className="ev-f">Hours<input type="number" min={0} step={0.5} defaultValue={e.duration_hrs ?? 0} onBlur={(ev) => onUpdate({ duration_hrs: parseFloat(ev.target.value) || 0 })} /></label>
              <label className="ev-f">Crew<input type="number" min={0} defaultValue={e.staff_count ?? 0} onBlur={(ev) => onUpdate({ staff_count: Math.max(0, parseInt(ev.target.value) || 0) })} /></label>
            </div>

            {/* Menu, rig & site flags — the shared chip set (one option list with the prep hub's
                Menu & rig editor). Patches flow through the same events update as every field here. */}
            <MenuRigChips variant="ev" value={e} onPatch={onUpdate} ownerType="event" ownerId={e.id} />
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
  const addEvent = async (title: string) => {
    // Born dated (next Saturday) — a dateless event is invisible to the calendar, which reads as "it vanished".
    const nextSat = (() => { const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return localYMD(d); })();
    const { data, error } = await supabase!.from("events").insert({ title, day_label: "SAT", day: nextSat, sort: events.length }).select("id").single();
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
        <InlineCreate label="+ Add" placeholder="Event title" onCreate={addEvent} />
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
  const [q, setQ] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("orders").select("*").in("status", ["done", "void"]).order("status_changed_at", { ascending: false }).limit(300);
    if (data) setRows(data as Order[]);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable("orders", load);
  const done = rows.filter((r) => r.status === "done").length;
  // Under pressure a manager needs to LOOK UP an order — filter by name, order #, item, or amount.
  const term = q.trim().toLowerCase();
  const shown = term
    ? rows.filter((o) => {
        const name = (o.customer ?? "guest").toLowerCase();
        const id = o.id.slice(0, 4).toLowerCase();
        const items = o.items.map((i) => (DRINKS[i as DrinkId]?.n ?? i)).join(" ").toLowerCase();
        return name.includes(term) || id.includes(term) || items.includes(term) || (o.total_cents / 100).toFixed(2).includes(term);
      })
    : rows;
  return (
    <div className="adm-sec">
      <div className="sec">Order history{done > 0 && <span className="adm-pill">{done} completed</span>}</div>
      <input className="adm-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name · order # · item · amount" aria-label="Search order history" />
      {term && <div className="h-sub" style={{ margin: "2px 2px 10px" }}>{shown.length} match{shown.length === 1 ? "" : "es"}</div>}
      {shown.map((o) => (
        <div className="adm-member" key={o.id}>
          <div className="adm-member-top">
            <b>{o.customer ?? "Guest"}</b>
            <span className={`adm-substat ${o.status === "void" ? "past_due" : "active"}`}>{o.status}</span>
          </div>
          <div className="meta">{groupItems(o.items).map((g) => `${g.qty > 1 ? g.qty + "× " : ""}${DRINKS[g.id as DrinkId]?.n ?? g.id}`).join(" · ")} · ${(o.total_cents / 100).toFixed(2)} · {new Date(o.status_changed_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
        </div>
      ))}
      {loaded && rows.length === 0 && <div className="h-sub">No completed orders yet — they appear here after pickup.</div>}
      {loaded && rows.length > 0 && shown.length === 0 && <div className="h-sub">No orders match &ldquo;{q.trim()}&rdquo;.</div>}
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
type OverdueTask = { taskId: string; label: string; kind: "event" | "stop"; ownerId: string; ownerName: string };
function Overview({ onGo, onOpenTarget }: { onGo: (t: string) => void; onOpenTarget?: (kind: "event" | "stop", id: string) => void }) {
  // Operator-first glance: what's coming (events, stops), what's new (booking requests),
  // and what's overdue (open team tasks past their due date / owner date). Each card jumps
  // to where you act on it. (Sales metrics — subs/waitlist — live in Money, not here.)
  // Prep-only context now: what's coming + what's live. The ACTION rows (booking replies,
  // overdue tasks, restock) moved to My Day's NeedsYou — the console has ONE glance screen.
  const [s, setS] = useState({
    eventsUp: 0, nextEvent: null as { title: string; label: string } | null,
    stopsUp: 0, nextStop: null as { name: string; label: string; id: string } | null,
    live: null as EventRow | null,
  });
  const load = useCallback(async () => {
    if (!supabase) return;
    const today = localYMD(new Date()); // operator-local date, not UTC
    const [ev, evs, st] = await Promise.all([
      supabase.from("events").select("*").eq("is_live", true).maybeSingle(),
      supabase.from("events").select("*").order("day"),
      supabase.from("stops").select("id, name, when_label, starts_at, status, archived_at").order("starts_at"),
    ]);
    const allEv = ((evs.data as EventRow[]) ?? []).filter((e) => !e.archived_at);
    const upEv = allEv.filter((e) => e.day && e.day >= today);
    const ne = upEv[0];
    const allSt = ((st.data as Stop[]) ?? []).filter((x) => !x.archived_at);
    const upSt = allSt.filter((x) => x.status !== "done");
    const ns = upSt.find((x) => x.status === "live") ?? upSt[0];
    setS({
      eventsUp: upEv.length, nextEvent: ne ? { title: ne.title ?? "Event", label: ne.day_label || ne.day || "" } : null,
      stopsUp: upSt.length, nextStop: ns ? { name: ns.name ?? "Stop", label: ns.when_label || "", id: ns.id } : null,
      live: (ev.data as EventRow) ?? null,
    });
  }, []);
  // Debounce realtime: a burst of task check-offs during prep should collapse into one reload,
  // not fire a full 6-query load() per row.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    load();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [load]);
  useRealtimeTable(["events", "stops"], () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => load(), 500);
  });
  const openStop = () => { if (s.nextStop && onOpenTarget) onOpenTarget("stop", s.nextStop.id); else onGo("stops"); };
  return (
    <div className="adm-sec">
      <div className="sec">At a glance</div>
      <p className="bo-line">
        <button type="button" onClick={() => onGo("events")}><b>{s.eventsUp}</b> event{s.eventsUp === 1 ? "" : "s"}</button>
        {" · "}
        <button type="button" onClick={openStop}><b>{s.stopsUp}</b> truck stop{s.stopsUp === 1 ? "" : "s"}</button>
        {" coming up"}
        {(s.nextEvent || s.nextStop) && <> — next: <b>{s.nextEvent ? `${s.nextEvent.label ? `${s.nextEvent.label} · ` : ""}${s.nextEvent.title}` : `${s.nextStop!.label ? `${s.nextStop!.label} · ` : ""}${s.nextStop!.name}`}</b></>}
      </p>
      {s.live ? (
        <div className="bo-live" role="button" tabIndex={0} onClick={() => onOpenTarget ? onOpenTarget("event", s.live!.id) : onGo("events")} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (onOpenTarget ? onOpenTarget("event", s.live!.id) : onGo("events"))}>
          <span className="adm-pill due">LIVE</span> <b>{s.live.title}</b> — running now · tap for prep
        </div>
      ) : (
        <div className="h-sub" style={{ marginTop: 12 }}>No event live. Set one live under Events when you open.</div>
      )}

    </div>
  );
}

// ───────────────────────── vendors (relational venue records) ─────────────────────────
type VendorSug = { kind: "stop" | "event"; id: string; name: string; sub: string; stop?: Stop; event?: EventRow };

// A vendor's places (0226) — list, add, set primary, archive. Rendered under the open vendor row.
function VendorLocationsEditor({ vendorId, vendorName }: { vendorId: string; vendorName: string }) {
  const { toast } = useApp();
  const [locs, setLocs] = useState<VendorLocation[]>([]);
  const [nm, setNm] = useState("");
  const [addr, setAddr] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("vendor_locations").select("*").eq("vendor_id", vendorId).is("archived_at", null).order("is_primary", { ascending: false }).order("sort");
    setLocs((data as VendorLocation[]) ?? []);
  }, [vendorId]);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    if (!nm.trim()) return;
    const made = await addVendorLocation(vendorId, { label: nm.trim(), address: addr.trim() || null });
    if (!made) { toast("Couldn't add the location", "error"); return; }
    setNm(""); setAddr(""); toast("Location added"); load();
  };
  const setPrimary = async (id: string) => {
    if (!supabase) return;
    // Clear the old primary first — the partial unique index enforces ONE.
    await supabase.from("vendor_locations").update({ is_primary: false }).eq("vendor_id", vendorId).eq("is_primary", true);
    const { error } = await supabase.from("vendor_locations").update({ is_primary: true }).eq("id", id);
    toast(error ? `Couldn't set primary — ${error.message}` : "Primary location set");
    load();
  };
  const archiveLoc = async (id: string, label: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("vendor_locations").update({ is_primary: false, archived_at: new Date().toISOString() }).eq("id", id);
    toast(error ? `Couldn't remove — ${error.message}` : `${label} removed`);
    load();
  };
  return (
    <div className="vloc" style={{ padding: "0 12px 10px" }}>
      <div className="ev-group-h">Locations · {vendorName}</div>
      {locs.map((l) => (
        <div className="vloc-row" key={l.id}>
          <div className="vloc-main"><b>{l.label}</b>{(l.address || l.location_text) && <span>{l.address ?? l.location_text}</span>}</div>
          {l.is_primary ? <span className="vloc-pri">Primary</span> : <button className="ev-arch-btn" onClick={() => setPrimary(l.id)}>Make primary</button>}
          <button className="ev-arch-btn del" onClick={() => archiveLoc(l.id, l.label)}>Remove</button>
        </div>
      ))}
      {locs.length === 0 && <div className="pnl-note">No locations yet — the vendor&apos;s own address acts as its place.</div>}
      <div className="vnew-row" style={{ marginTop: 8 }}>
        <input className="ev-input" value={nm} onChange={(e) => setNm(e.target.value)} placeholder="Location name" maxLength={80} />
        <input className="ev-input" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Address (optional)" maxLength={300} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <button type="button" className="adm-btn" onClick={add} disabled={!nm.trim()}>Add</button>
      </div>
    </div>
  );
}

function VendorsAdmin() {
  const { toast } = useApp();
  const { profile } = useAuth();
  const isAdmin = ["owner", "admin"].includes(roleOf(profile));
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showArch, setShowArch] = useState(false);
  type DupePair = { a: string; a_name: string; b: string; b_name: string; sim: number };
  const [dupes, setDupes] = useState<DupePair[]>([]);
  const [merging, setMerging] = useState(false);
  // The look-alike confirm sheet's pending question: which path asked, and with what payload.
  const [resolve, setResolve] = useState<{ name: string; candidates: VendorMatch[]; ctx: { type: "add" } | { type: "from"; sug: VendorSug } } | null>(null);
  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: v }, { data: s }, { data: e }, dup] = await Promise.all([
      supabase.from("vendors").select("*").order("sort"),
      supabase.from("stops").select("*"),
      supabase.from("events").select("*"),
      supabase.rpc("vendor_dupe_candidates"),
    ]);
    if (v) setVendors(v as Vendor[]);
    setStops(((s as Stop[]) ?? []).filter((x) => !x.archived_at));
    setEvents(((e as EventRow[]) ?? []).filter((x) => !x.archived_at));
    setDupes(((dup.data as DupePair[]) ?? []));
  }, []);
  useEffect(() => { load(); }, [load]);
  // ONE resolver (0226): exact → open the existing record · look-alike → the confirm sheet ·
  // clean miss → create approved (this is the deliberate vendor book, not an on-the-fly add).
  const add = async (name: string, decision?: ResolveDecision) => {
    const r = await resolveVendor(name, { status: "approved", source: "the vendor book", sort: vendors.length, decision });
    if (r.kind === "similar") { setResolve({ name, candidates: r.candidates, ctx: { type: "add" } }); return; }
    if (r.kind === "error") { toast(`Error: ${r.message}`, "error"); return; }
    setResolve(null);
    toast(r.kind === "created" ? "Vendor added" : "Already in the book — opened it");
    setOpenId(r.id); load();
  };
  // Relational fill: materialize a vendor from an existing stop/event and link the source —
  // and if the name look-alikes an existing vendor, LINK the source to it instead of minting
  // a copy (the whole point of the guard).
  const createFrom = async (sug: VendorSug, decision?: ResolveDecision) => {
    let extra: Partial<Vendor> = {};
    if (sug.kind === "stop" && sug.stop) {
      const s = sug.stop;
      extra = { location_text: s.location_text, address: s.address, lat: s.lat, lng: s.lng, poc_name: s.poc_name, poc_phone: s.poc_phone, poc_email: s.poc_email, service_dates: s.service_dates };
    } else if (sug.event) {
      extra = { location_text: sug.event.location_text };
    }
    const r = await resolveVendor(sug.name, { status: "approved", source: "the vendor book", sort: vendors.length, extra: extra as Record<string, unknown>, decision });
    if (r.kind === "similar") { setResolve({ name: sug.name, candidates: r.candidates, ctx: { type: "from", sug } }); return; }
    if (r.kind === "error") { toast(`Error: ${r.message}`, "error"); return; }
    setResolve(null);
    if (sug.kind === "stop") await supabase!.from("stops").update({ vendor_id: r.id }).eq("id", sug.id);
    else await supabase!.from("events").update({ vendor_id: r.id }).eq("id", sug.id);
    toast(r.kind === "created" ? `Vendor created from ${sug.name} — now linked` : `${sug.name} linked to the existing vendor`);
    load();
  };
  // Owner-gated merge (0226): repoints stops/events/pipeline/notes/spend, archives the dupes.
  const merge = async (keep: DupePair["a"], dupe: string, keepName: string, dupeName: string) => {
    if (!supabase || merging) return;
    if (typeof window !== "undefined" && !window.confirm(`Merge “${dupeName}” into “${keepName}”? Everything linked to ${dupeName} gets repointed; it's archived (reversible), never deleted.`)) return;
    setMerging(true);
    const { data, error } = await supabase.rpc("merge_vendors", { p_keep: keep, p_dupes: [dupe] });
    setMerging(false);
    if (error) { toast(`Couldn't merge — ${error.message}`, "error"); return; }
    const rep = (data as { repointed?: Record<string, number> })?.repointed ?? {};
    const moved = Object.entries(rep).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k.replace("_", " ")}`).join(" · ");
    toast(`Merged into ${keepName}${moved ? ` — repointed ${moved}` : ""}`);
    load();
  };
  const archive = async (id: string) => { await supabase!.from("vendors").update({ archived_at: new Date().toISOString() }).eq("id", id); setOpenId(null); load(); };
  const restore = async (id: string) => { await supabase!.from("vendors").update({ archived_at: null }).eq("id", id); load(); };
  const del = async (id: string, nm: string) => { if (typeof window !== "undefined" && !window.confirm(`Delete ${nm}?`)) return; await supabase!.from("vendors").delete().eq("id", id); load(); };
  // Approve a venue that was added on the fly from a truck stop (0191) — it becomes a first-class
  // vendor. Opening it to fill in the contact details is the natural next step.
  const approve = async (id: string) => { await supabase!.from("vendors").update({ status: "approved" }).eq("id", id); toast("Vendor approved"); setOpenId(id); load(); };
  const active = vendors.filter((v) => !v.archived_at);
  const pending = active.filter((v) => v.status === "pending");
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
      <div className="sec">Vendors <InlineCreate label="+ Add vendor" placeholder="Vendor name" onCreate={(name) => add(name)} style={{ marginLeft: "auto" }} /></div>
      <div className="pnl-note" style={{ marginBottom: 6 }}>One record per venue/partner — linked from truck stops and events. Edit a POC here and it updates everywhere it&apos;s linked. A vendor can hold several locations.</div>
      {dupes.length > 0 && (
        <div className="vdupe">
          <div className="vdupe-h">Possible duplicates · {dupes.length}</div>
          {dupes.map((d) => (
            <div className="vdupe-row" key={`${d.a}-${d.b}`}>
              <span className="vdupe-names"><b>{d.a_name}</b><em>{Math.round(d.sim * 100)}%</em><b>{d.b_name}</b></span>
              {isAdmin ? (
                <span style={{ display: "flex", gap: 6 }}>
                  <button className="adm-btn" disabled={merging} onClick={() => merge(d.a, d.b, d.a_name, d.b_name)}>Keep {d.a_name}</button>
                  <button className="adm-btn" disabled={merging} onClick={() => merge(d.b, d.a, d.b_name, d.a_name)}>Keep {d.b_name}</button>
                </span>
              ) : (
                <span className="pnl-note">Owner can merge these</span>
              )}
            </div>
          ))}
        </div>
      )}
      {pending.length > 0 && (
        <div className="vendor-pending">
          <div className="ev-group-h" style={{ marginBottom: 8, color: "var(--warn)" }}>Awaiting your approval · {pending.length}</div>
          {pending.map((v) => (
            <div className="vendor-sug pend" key={`pend-${v.id}`}>
              <div className="vendor-sug-main"><b>{v.name}</b><span>Added from a truck stop — approve to add it to the book</span></div>
              <button className="adm-btn primary" onClick={() => approve(v.id)}>Approve</button>
            </div>
          ))}
        </div>
      )}
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
          <div key={v.id}>
            <LocationEditor kind="vendor" row={v} index={i} open={openId === v.id} onToggle={() => setOpenId(openId === v.id ? null : v.id)} onArchive={() => archive(v.id)} onChanged={load} />
            {openId === v.id && <VendorLocationsEditor vendorId={v.id} vendorName={v.name} />}
          </div>
        ))}
      </div>
      {resolve && (
        <VendorResolve name={resolve.name} candidates={resolve.candidates}
          onUse={async (c) => {
            const ctx = resolve.ctx; setResolve(null);
            if (ctx.type === "add") { setOpenId(c.id); toast(`${c.name} is already in the book — opened it`); return; }
            if (ctx.sug.kind === "stop") await supabase!.from("stops").update({ vendor_id: c.id }).eq("id", ctx.sug.id);
            else await supabase!.from("events").update({ vendor_id: c.id }).eq("id", ctx.sug.id);
            toast(`${ctx.sug.name} linked to ${c.name}`); load();
          }}
          onAddLocation={async (c) => {
            const ctx = resolve.ctx; setResolve(null);
            const src = ctx.type === "from" && ctx.sug.kind === "stop" ? ctx.sug.stop : null;
            await addVendorLocation(c.id, { label: resolve.name, address: src?.address ?? null, location_text: src?.location_text ?? null, lat: src?.lat ?? null, lng: src?.lng ?? null });
            if (ctx.type === "from") {
              if (ctx.sug.kind === "stop") await supabase!.from("stops").update({ vendor_id: c.id }).eq("id", ctx.sug.id);
              else await supabase!.from("events").update({ vendor_id: c.id }).eq("id", ctx.sug.id);
            }
            toast(`Added “${resolve.name}” as a location of ${c.name}`); load();
          }}
          onCreateDistinct={() => {
            const ctx = resolve.ctx; setResolve(null);
            if (ctx.type === "add") add(resolve.name, { createDistinct: true });
            else createFrom(ctx.sug, { createDistinct: true });
          }}
          onClose={() => setResolve(null)}
        />
      )}
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

// Reusable venue picker — links a stop/event to a vendor, and is the ONE place a stop is bound to the
// vendor book. A truck stop should always name a known venue; if it's a new place, you add it here and
// it's created PENDING with an owner-approval alert (0191) — never a silent orphan. Shows the linked
// vendor's POC live (relational), edit-once-updates-everywhere.
function VendorPicker({ vendors, vendorId, onLink, onCreated, onPickLocation }: { vendors: Vendor[]; vendorId: string | null | undefined; onLink: (v: Vendor | null) => void; onCreated?: () => void; onPickLocation?: (loc: VendorLocation) => void }) {
  const { toast } = useApp();
  const linked = vendors.find((v) => v.id === vendorId) || null;
  const [adding, setAdding] = useState(false);
  const [nm, setNm] = useState("");
  const [busy, setBusy] = useState(false);
  const [similar, setSimilar] = useState<VendorMatch[] | null>(null);
  const [locs, setLocs] = useState<VendorLocation[]>([]);
  const [addingLoc, setAddingLoc] = useState(false);
  const [locNm, setLocNm] = useState("");
  const [locAddr, setLocAddr] = useState("");

  // The linked vendor's places (0226) — one shows as the place; several ask which.
  useEffect(() => {
    let on = true;
    (async () => {
      if (!supabase || !vendorId) { if (on) setLocs([]); return; }
      const { data } = await supabase.from("vendor_locations").select("*").eq("vendor_id", vendorId).is("archived_at", null).order("is_primary", { ascending: false }).order("sort");
      if (on) setLocs((data as VendorLocation[]) ?? []);
    })();
    return () => { on = false; };
  }, [vendorId]);

  const linkById = async (id: string): Promise<Vendor | null> => {
    let v = vendors.find((x) => x.id === id) ?? null;
    if (!v && supabase) v = ((await supabase.from("vendors").select("*").eq("id", id).single()).data as Vendor | null);
    if (v) onLink(v);
    return v;
  };

  // ONE resolver (0226): exact → link · look-alike → the confirm sheet · clean miss → pending create.
  const create = async (decision?: ResolveDecision) => {
    const name = nm.trim();
    if (!name || busy || !supabase) return;
    setBusy(true);
    const r = await resolveVendor(name, { source: "a truck stop", sort: vendors.length, decision });
    setBusy(false);
    if (r.kind === "similar") { setSimilar(r.candidates); return; }
    if (r.kind === "error") { toast(`Couldn't add venue: ${r.message}`, "error"); return; }
    setSimilar(null);
    const v = await linkById(r.id);
    toast(r.kind === "created" ? `${name} linked — pending owner approval` : `Linked to ${v?.name ?? name}`);
    setNm(""); setAdding(false); onCreated?.();
  };

  const addLoc = async () => {
    if (!vendorId || !locNm.trim() || !supabase) return;
    const made = await addVendorLocation(vendorId, { label: locNm.trim(), address: locAddr.trim() || null });
    if (!made) { toast("Couldn't add the location", "error"); return; }
    const { data } = await supabase.from("vendor_locations").select("*").eq("id", made.id).single();
    setLocNm(""); setLocAddr(""); setAddingLoc(false);
    if (data) {
      setLocs((p) => [...p, data as VendorLocation]);
      onPickLocation?.(data as VendorLocation);
      toast("Location added & set on this stop");
    }
  };
  return (
    <div className="ev-group">
      <div className="ev-group-h">Venue · vendor</div>
      <select className="ev-input" value={vendorId ?? ""} onChange={(e) => onLink(vendors.find((v) => v.id === e.target.value) || null)}>
        <option value="">— not linked —</option>
        {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.status === "pending" ? " · pending" : ""}</option>)}
      </select>
      {linked?.status === "pending" && <div className="vpend">⏳ Pending owner approval — review it in Plan › Vendors.</div>}
      {linked && (linked.address || linked.location_text || linked.poc_name || linked.poc_phone || linked.poc_email || linked.service_dates) && (
        <div className="vlink">
          {(linked.address || linked.location_text) && <div className="vlink-row"><span>Address</span><b>{linked.address || linked.location_text}</b></div>}
          {linked.poc_name && <div className="vlink-row"><span>Liaison</span><b>{linked.poc_name}</b></div>}
          {linked.poc_phone && <div className="vlink-row"><span>Phone</span><a href={`tel:${linked.poc_phone}`}>{linked.poc_phone}</a></div>}
          {linked.poc_email && <div className="vlink-row"><span>Email</span><a href={`mailto:${linked.poc_email}`}>{linked.poc_email}</a></div>}
          {linked.service_dates && <div className="vlink-row"><span>Service</span><b>{linked.service_dates}</b></div>}
          <div className="vlink-note">Pulled from the vendor book — edits there update everywhere it&apos;s linked.</div>
        </div>
      )}
      {/* Multi-location vendor (0226): several places → ask which; one → it's simply the place. */}
      {linked && locs.length > 1 && (
        <div className="ev-group" style={{ marginTop: 8 }}>
          <div className="ev-group-h">Which location?</div>
          <select className="ev-input" value="" onChange={(e) => {
            const loc = locs.find((l) => l.id === e.target.value);
            if (loc) { onPickLocation?.(loc); toast(`Stop set to ${linked.name} — ${loc.label}`); }
          }}>
            <option value="">Pick the location for this stop…</option>
            {locs.map((l) => <option key={l.id} value={l.id}>{l.label}{l.is_primary ? " · primary" : ""}{l.address ? ` — ${l.address}` : ""}</option>)}
          </select>
        </div>
      )}
      {linked && locs.length === 1 && (locs[0].address || locs[0].label !== "Main") && (
        <div className="vlink" style={{ marginTop: 8 }}>
          <div className="vlink-row"><span>Place</span><b>{locs[0].label}{locs[0].address ? ` — ${locs[0].address}` : ""}</b></div>
        </div>
      )}
      {linked && (addingLoc ? (
        <div className="vnew-row">
          <input className="ev-input" value={locNm} onChange={(e) => setLocNm(e.target.value)} placeholder="Location name — e.g. Downtown" maxLength={80} autoFocus />
          <input className="ev-input" value={locAddr} onChange={(e) => setLocAddr(e.target.value)} placeholder="Address (optional)" maxLength={300} onKeyDown={(e) => { if (e.key === "Enter") addLoc(); }} />
          <button type="button" className="adm-btn" onClick={addLoc} disabled={!locNm.trim()}>Add</button>
          <button type="button" className="ev-arch-btn" onClick={() => { setAddingLoc(false); setLocNm(""); setLocAddr(""); }}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="vnew-btn" onClick={() => setAddingLoc(true)}>＋ Add a location for {linked.name}</button>
      ))}
      {adding ? (
        <div className="vnew-row">
          <input className="ev-input" value={nm} onChange={(e) => setNm(e.target.value)} placeholder="New venue name" maxLength={120} autoFocus onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
          <button type="button" className="adm-btn" onClick={() => create()} disabled={busy || !nm.trim()}>{busy ? "Adding…" : "Add"}</button>
          <button type="button" className="ev-arch-btn" onClick={() => { setAdding(false); setNm(""); }}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="vnew-btn" onClick={() => setAdding(true)}>＋ New venue — send for approval</button>
      )}
      {similar && (
        <VendorResolve name={nm.trim()} candidates={similar} busy={busy}
          onUse={async (c) => {
            setSimilar(null);
            const v = await linkById(c.id);
            toast(`Linked to ${v?.name ?? c.name}`);
            setNm(""); setAdding(false);
          }}
          onAddLocation={async (c) => {
            setSimilar(null);
            await linkById(c.id);
            const made = await addVendorLocation(c.id, { label: nm.trim() });
            if (made && supabase) {
              const { data } = await supabase.from("vendor_locations").select("*").eq("id", made.id).single();
              if (data) onPickLocation?.(data as VendorLocation);
            }
            toast(`Added “${nm.trim()}” as a location of ${c.name}`);
            setNm(""); setAdding(false); onCreated?.();
          }}
          onCreateDistinct={() => { setSimilar(null); create({ createDistinct: true }); }}
          onClose={() => setSimilar(null)}
        />
      )}
    </div>
  );
}

// ───────────────────────── section metadata (shared by header + the guide) ─────────────────────────
// Each section = one job at one moment. LABEL names it, WHEN says when to reach for it (header pill),
// SUB is the one-liner, MORE explains it, INSIDE lists what lives there. Order = the shift timeline.
const SEC_LABEL: Record<OpSection, string> = { day: "My Day", now: "Live Ops", ask: "Ask GT3", command: "Command", prep: "Readiness", plan: "Plan", pipeline: "Pipeline", studio: "Studio", brew: "Brew", garage: "Assets", goals: "Goals", driver: "Delivery", stops: "Route", notes: "Notes", money: "Money", customers: "Customers", team: "Team", settings: "Settings", audit: "Audit" };
const SEC_WHEN: Record<OpSection, string> = {
  day: "Start of shift", now: "During service", ask: "When you're stuck", command: "Are we on track?", prep: "Before the event",
  plan: "Booking ahead", pipeline: "Working the leads", studio: "Promoting a drop", brew: "Production days", garage: "Assets & stock", goals: "Steering the quarter", driver: "Delivery days", stops: "Route planning", notes: "Any time", money: "The books", customers: "Your regulars", team: "People & roles", settings: "Managing the app", audit: "App health checks",
};
const SEC_SUB: Record<OpSection, string> = {
  day: "Your tasks, flags, needs-you & what's on today.",
  command: "The shared board — initiatives, this week, blockers, done & money.",
  now: "The pass, pack pickups & the 86 board — live service.",
  ask: "Recipes, gear, stock & how-to — from the GT3 playbook.",
  prep: "Stock, readiness & the pack list for what's next.",
  plan: "Calendar, events, bookings & vendors.",
  pipeline: "The sales funnel — accounts, deals, reps & next steps.",
  stops: "The route — locations, dates & the ordering dial.",
  notes: "Notes — private or shared; follow-ups become tasks.",
  studio: "Draft, schedule & post — brand & marketing.",
  brew: "Schedule, start & log brews — sized to what's reserved.",
  garage: "Load-out & tow, gear, maintenance & inventory.",
  goals: "Company goals & the scoreboard.",
  driver: "The delivery run — map, list & one big go button.",
  money: "Pricing, reserves & order history.",
  customers: "Every customer — orders, loyalty & contact info.",
  team: "People, roles, access & training.",
  settings: "Copy, pricing, promos & codes — the owner control room.",
  audit: "Every audit run on the app — scored, dated & tracked for re-run.",
};
const SEC_MORE: Record<OpSection, string> = {
  day: "Your personal launchpad — the console's one glance screen. Everything assigned to you, everything flagged for your attention, and (for leadership) the needs-you list: booking replies, past-due team tasks and restock lows.",
  command: "The shared war room both founders see — the digital version of the magnetic board. Your initiatives (a dated program like the Aug-1 launch) with a countdown and milestone progress, then This Week, Blockers, Done and Money in one glance. This is where you answer “are we on track?” together, instead of over text.",
  now: "The glance before the work. Alerts land here, the service pulse shows what's waiting (orders on the pass, items 86'd), and one tap opens The Pass — the working screen with the pass board, pickup checklist and 86 board. Prep lives here too: the drop's brew sheet and Sunday delivery.",
  prep: "Get ready before you roll. Build the pack list, check stock and readiness, and sign off that the truck's loaded for the next event or stop.",
  plan: "The forward calendar. Book events, work incoming booking requests, and manage vendors and venues — weeks and months out.",
  pipeline: "The sales board. Every account with its deal (from the owner's catalog, matched to the account type), its rep, its stage and its next step — argued out on the thread, won or lost on the record.",
  stops: "Route planning: create and order locations, link vendors, go live, and set when cup orders open. A stop's name, date and address are edited in ONE place — its prep hub, one tap away.",
  notes: "Every note, yours and the team's. Jot one for yourself (🔒 just me), share one with the crew, or file a meeting recap — tag follow-ups and they land in people's tasks with a ping. The ✦ button jots one from any screen.",
  studio: "Your marketing studio. Draft posts and flyers, keep them on-brand, plan the feed, schedule around your drops, and moderate the guest reviews that feed the truck display.",
  brew: "Production's home. Schedule brews sized to demand, hit start-by deadlines, log every batch — with coverage, serve-by and stock checks right on the card.",
  garage: "The physical operation: trailer load-out & tow plan, the gear library, asset maintenance, and inventory with pars.",
  goals: "Where the business is steering — goals, owners and progress, reviewed on a cadence.",
  driver: "Run day, from the wheel: how many porches, where, and one tap into driver mode with the map and run list.",
  money: "The books. Set pricing, watch reserve revenue, and review order history — the numbers behind the operation.",
  customers: "Your customer book. Every person who's ordered — cup, pickup or delivery, with or without an account — with their history, loyalty and contact info in one place.",
  team: "Your people. Add crew, set roles and access, and manage training — who can see and do what.",
  ask: "Your pocket brain. Ask anything about recipes, the why, gear, stock or how-to and get an answer from the GT3 playbook — from any screen.",
  settings: "The owner control room — everything you can change without a developer. The wording guests read (copy) lives here, plus office-delivery pricing, and a map straight to brand, payments, menu, discount codes and roles. It also holds “What we've built” — the running changelog of every improvement shipped, categorized so anyone can see the whole story of how GT3 got built. Edits go live instantly, no deploy.",
  audit: "The app's audit trail — every review run on it (security, privacy, performance, accessibility, UI cohesion, data), with a score, the date it ran, the prompt used, and when it's due to run again. A health strip leads (average score · what's overdue · last run); log a new audit any time you run one.",
};
const SEC_INSIDE: Record<OpSection, string[]> = {
  day: ["Your open tasks & due dates", "Alerts flagged for you — with discussion threads", "Needs you (leadership): booking replies, past-due tasks, restock", "What's on the calendar today", "Day-of brief — dress code & call time"],
  command: ["Initiatives — a dated program (e.g. the Aug-1 launch) with countdown & milestone progress", "This week — everything due across both task lists", "Blockers — stopped-service incidents + anything overdue", "Done this week — momentum at a glance", "Money — the live glance"],
  now: ["Service pulse — live counts, one tap into the working screen", "The Pass — the pass board (guests ping it: on my way · outside · late), pickup checklist & 86 board on ONE screen", "The drop — brew sheet & window money (the checklist lives in Service)", "Delivery run — run sheet, brew totals & packout (outcomes are logged in driver mode)", "Live truck: go live, GPS broadcast (locations & the ordering dial live on the Stops page)", "Alerts & your tasks — pointers into My Day"],
  prep: ["Per-event & per-stop pack lists", "Readiness & inspection checks", "Crew assignments & sign-off", "Load-out & gear moved to Production › Garage"],
  plan: ["Company calendar", "Events", "Booking requests", "Vendors & venues"],
  pipeline: ["Prospect → first attempt → talking → proposal → won", "Deal catalog — owner-set, per account type", "Rep assignment with a ping", "Per-deal discussion threads"],
  stops: ["Location list & route order", "Go live at any location", "The cup-ordering dial", "Names, dates & addresses are edited in the prep hub"],
  notes: ["Private notes — 🔒 just for you", "Team notes & meeting recaps", "Follow-ups → assigned tasks", "✨ Transcript → summary"],
  studio: ["Post & flyer drafting", "Brand copy & front-end copy", "Feed planning grid", "Repurpose engine", "Publishing & scheduling", "Review Desk → the truck display (/display): add or approve reviews; ✨ Simplify de-claims + trims one to display-safe"],
  brew: ["Brew schedule with start-by deadlines", "Coverage — makes vs reserved", "Serve-by freshness windows", "Batch log & recipes"],
  garage: ["Load-out & tow plan", "Gear library — manuals & specs", "Asset maintenance & what's due", "Inventory — stock, costs & pars"],
  goals: ["Company goals & owners", "Progress check-ins", "Discussion threads"],
  driver: ["Next run — porches & zips", "Driver mode — map & run list", "The ONE place outcomes are logged (swap · fresh · hold · not home)"],
  customers: ["Customer list — guests & members", "Cross-channel order history (cup · pickup · delivery)", "Loyalty — points & credit", "Contact info for outreach"],
  money: ["Checkout & payments — card status + the pay-at-pickup toggle (governs cup, reserve & delivery)", "Sales · snapshot · per-event P&L", "Product economics & COGS", "Membership plans & subscribers", "Order history", "The Playbook (/playbook, owners) — every growth play + where its numbers land here", "Reserve drops — configure the limited drops"],
  team: ["Staff roster", "Roles & permissions", "Training & academy", "Manager approvals"],
  ask: ["Recipes & the why", "Gear & stock how-to", "The GT3 playbook"],
  settings: ["Copy & wording — every line guests read", "Office delivery pricing & minimum", "What we've built — the categorized changelog of every improvement shipped", "A map to brand, payments, menu, codes & roles"],
  audit: ["Health strip — average score, what's overdue, last run", "The full audit log — security, privacy, performance, a11y, cohesion, data", "Log an audit — score, date, prompt, findings & artifact link", "Re-run cadence & overdue flags"],
};

// The interactive "when to use what" guide — every section the role can reach, each expandable to a
// plain-language explainer + what's inside, with a one-tap "Go there" jump. Opened from the crew
// eyebrow or the header WHEN pill.
function SectionGuide({ allowed, current, onGo, onClose }: { allowed: OpSection[]; current: OpSection; onGo: (s: OpSection) => void; onClose: () => void }) {
  // The sheet owns the scroll — the page behind must not move under a finger on the overlay.
  useEffect(() => {
    const b = document.getElementById("body") ?? document.body;
    const prev = b.style.overflow;
    b.style.overflow = "hidden";
    return () => { b.style.overflow = prev; };
  }, []);
  const [open, setOpen] = useState<OpSection>(current);
  return (
    <Sheet open onClose={onClose} labelledBy="section-guide-title" header={<div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}><div><div className="guide-t" id="section-guide-title">When to use what</div><div className="guide-lede">Each section is one job at one moment. Tap to learn more, then jump straight there.</div></div><button type="button" className="guide-x" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close">✕</button></div>}>
        {(allowed.includes("plan") || allowed.includes("prep")) && (
          <button type="button" className="guide-create" onClick={() => { window.dispatchEvent(new CustomEvent("gt3-copilot", { detail: "event-build" })); onClose(); }}>
            <span className="guide-create-x"><b>✦ Create an event or truck stop</b><span>Say it in plain words — the chief of staff drafts it, you confirm.</span></span>
            <span className="guide-create-go" aria-hidden>→</span>
          </button>
        )}
        <div className="guide-list">
          {allowed.map((s, i) => {
            const isOpen = open === s;
            const here = current === s;
            return (
              <div key={s} className={`guide-row${isOpen ? " open" : ""}${here ? " here" : ""}`}>
                <button type="button" className="guide-row-h" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? ("" as OpSection) : s)}>
                  <span className="guide-num">{i + 1}</span>
                  <span className="guide-row-tt">
                    <span className="guide-row-t">{SEC_LABEL[s]}{here && <span className="guide-here-dot">● here now</span>}</span>
                    <span className="guide-row-sub">{SEC_SUB[s]}</span>
                  </span>
                  <span className="guide-when">{SEC_WHEN[s]}</span>
                  <span className={`guide-chev ev-chev${isOpen ? " open" : ""}`} aria-hidden>›</span>
                </button>
                {isOpen && (
                  <div className="guide-body">
                    <p className="guide-more">{SEC_MORE[s]}</p>
                    <div className="guide-inside-h">What's inside</div>
                    <ul className="guide-inside">{SEC_INSIDE[s].map((x) => <li key={x}>{x}</li>)}</ul>
                    {here
                      ? <div className="guide-here-note">You're in {SEC_LABEL[s]} now.</div>
                      : <button type="button" className="guide-go" onClick={() => { onGo(s); onClose(); }}>Go to {SEC_LABEL[s]} ›</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
    </Sheet>
  );
}

// Collapsible panel — tames a long section into tidy, tappable cards. Remembers open/closed per id,
// and hides the wrapped panel's own title (the Panel supplies it) while keeping its actions.
function Panel({ title, id, defaultOpen = false, children }: { title: string; id: string; defaultOpen?: boolean; children: ReactNode }) {
  const storeKey = `gt3-mpanel-${id}`;
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { try { const v = localStorage.getItem(storeKey); if (v !== null) setOpen(v === "1"); } catch { /* ignore */ } }, [storeKey]);
  const toggle = () => setOpen((o) => { const n = !o; try { localStorage.setItem(storeKey, n ? "1" : "0"); } catch { /* ignore */ } return n; });
  return (
    <section className={`mpanel${open ? " open" : ""}`}>
      <button type="button" className="mpanel-h" onClick={toggle} aria-expanded={open}>
        <span className="mpanel-t">{title}</span>
        <span className="mpanel-chev" aria-hidden="true">›</span>
      </button>
      {open && <div className="mpanel-body">{children}</div>}
    </section>
  );
}

export default function AdminPage() {
  const { ready, enabled, user, profile } = useAuth();
  const { section, setSection, back, canGoBack, groupId: navGroupId } = useOperatorSection();
  const router = useRouter();
  const streams = useWorkStreams();

  // Derive role + nav constants before any conditional return (Rules of Hooks).
  // profiles.role: member/server/operator/event_manager/contractor/admin/owner (0031).
  const role = roleOf(profile);
  const isOwner = role === "owner";
  const isAdmin = role === "admin" || isOwner;
  const canManage = isAdmin || role === "event_manager";
  const canPrep = canManage || role === "operator" || role === "contractor";
  const allowed = sectionsForRole(role);
  // Fallback for a section this role can't open is My Day (home), not Live Ops — a server tapping
  // a prep deep-link should land somewhere that explains itself, and the URL/localStorage must not
  // keep re-teleporting her on every cold open.
  const sec: OpSection = allowed.includes(section) ? section : "day";
  const [planTab, setPlanTab] = useState<"calendar" | "events" | "vendors">("calendar");
  const [guideOpen, setGuideOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const { flags: hdrFlags, critCount: hdrCrit } = useMyAlerts(user?.id ?? null, canManage);   // header 🔔 badge
  // First-run: the guide explains the console's language (Live Ops, Readiness, Route) — open it
  // once for a brand-new staffer instead of hoping she finds the ⓘ pill.
  useEffect(() => {
    try {
      if (!localStorage.getItem("gt3-guide-seen")) { localStorage.setItem("gt3-guide-seen", "1"); setGuideOpen(true); }
    } catch { /* ignore */ }
  }, []);
  // The header 🔔 opens the ONE inbox (your flags + the needs-you queue). Any screen can summon it
  // (the My Day pointer, the Now strip) via the gt3-open-inbox event; navigating a section closes it.
  useEffect(() => {
    const open = () => setInboxOpen(true);
    window.addEventListener("gt3-open-inbox", open);
    return () => window.removeEventListener("gt3-open-inbox", open);
  }, []);
  useEffect(() => { setInboxOpen(false); }, [sec]);
  // Service mode — full-screen KDS (pass + pickups). Esc exits; leaving Now exits.
  const [svc, setSvc] = useState(false);
  useEffect(() => {
    if (!svc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSvc(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [svc]);
  useEffect(() => { if (section !== "now") setSvc(false); }, [section]);
  // Focus the section region when you switch sections (skip the first render so we don't yank focus
  // on initial load). Programmatic focus won't trigger :focus-visible, so there's no stray ring.
  const opBodyRef = useRef<HTMLDivElement>(null);
  const firstSecRef = useRef(true);
  useEffect(() => {
    if (firstSecRef.current) { firstSecRef.current = false; return; }
    opBodyRef.current?.focus();
  }, [section]);
  // deep-link from Studio's "Company calendar ↗" → land on the Plan calendar
  useEffect(() => {
    if (sec !== "plan" || typeof window === "undefined") return;
    const t = localStorage.getItem("gt3-plan-tab");
    if (t && (["calendar", "events", "vendors"] as const).includes(t as typeof planTab)) {
      localStorage.removeItem("gt3-plan-tab"); setPlanTab(t as typeof planTab);
    }
  }, [sec]);
  const [planCounts, setPlanCounts] = useState<{ bookings: number; events: number }>({ bookings: 0, events: 0 });
  useEffect(() => {
    if (sec !== "plan" || !canManage || !supabase) return;
    const today = localToday();
    (async () => {
      const [b, e] = await Promise.all([
        supabase!.from("booking_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
        supabase!.from("events").select("id", { count: "exact", head: true }).is("archived_at", null).gte("day", today),
      ]);
      setPlanCounts({ bookings: b.count ?? 0, events: e.count ?? 0 });
    })();
  }, [sec, canManage, planTab]); // refetch when you switch tabs so badges reflect what you just did

  // Guard returns — all hooks live above (Rules of Hooks compliant).
  if (!enabled) return <section className="screen"><div className="h-title">Admin</div><div className="h-sub">The live backend isn&apos;t configured here.</div></section>;
  if (!ready) return <section className="screen" />;
  if (!user) return <SignIn />;
  if (role === "member") {
    return (
      <section className="screen">
        <div className="toprow"><div className="eyb">Crew</div><Link className="pf" href="/">‹</Link></div>
        <div className="h-title">Staff only.</div>
        <div className="h-sub">This area is for GT3PB staff. If that&apos;s you, ask the owner to add you — then tap below.</div>
        <button type="button" className="note-save" style={{ marginTop: 14 }} onClick={() => window.location.reload()}>I&apos;ve been added — check again</button>
      </section>
    );
  }

  // Overview's jump links map onto the operator sections — and the Plan sub-tab when relevant,
  // so "Events" actually lands on Plan→Events instead of whatever tab was last open.
  const goSection = (t: string) => {
    const map: Record<string, OpSection> = { events: "plan", vendors: "plan", bookings: "pipeline", money: "money", members: "team", stops: "stops", tasks: "day" };
    const tab: Record<string, typeof planTab> = { events: "events", vendors: "vendors" };
    if (tab[t]) setPlanTab(tab[t]);
    setSection(map[t] ?? "prep");
  };

  return (
    <CrumbProvider>
    <section className="screen admin">
      <div className="toprow">
        {/* Mode switch — you're in Crew; tap Customer view to drop to the customer app ("/"). */}
        <div className="modesw" role="group" aria-label="View mode">
          <span className="modesw-seg on" aria-current="true">Crew</span>
          <button type="button" className="modesw-seg" onClick={() => router.push("/")}>Customer view</button>
        </div>
        <div className="toprow-actions">
          {/* Inbox — the one place everything that needs you rolls up (flags + needs-you), from any screen. */}
          <button type="button" className="crew-bell" onClick={() => setInboxOpen(true)} aria-label={hdrFlags.length ? `Inbox — ${hdrFlags.length} for you` : "Inbox"}>
            <span aria-hidden>🔔</span>{hdrFlags.length > 0 && <span className={`crew-bell-b${hdrCrit ? " crit" : ""}`}>{hdrFlags.length}</span>}
          </button>
          {/* Jump — touch entry to the command palette (⌘K on desktop; a tap target on mobile). */}
          <button type="button" className="crew-jump" onClick={() => window.dispatchEvent(new Event("gt3-open-cmdk"))} aria-label="Jump to a section, recent, or action"><span aria-hidden>⌕</span> Jump<kbd className="crew-jump-k" aria-hidden>⌘K</kbd></button>
          {/* Section guide — what each section is for + jump there. */}
          <button type="button" className="crew-guide" onClick={() => setGuideOpen(true)} aria-haspopup="dialog"><span aria-hidden>ⓘ</span> Guide</button>
          {/* Back = previous section within crew mode; only leaves for /3mpire when there's no
              section history to step back through. */}
          <button type="button" className="pf" aria-label={canGoBack ? "Back" : "Exit Crew Mode"} onClick={() => { if (!back()) router.push("/3mpire"); }}>‹</button>
        </div>
      </div>
      {guideOpen && <SectionGuide allowed={allowed} current={sec} onGo={setSection} onClose={() => setGuideOpen(false)} />}
      {inboxOpen && (
        <Sheet open onClose={() => setInboxOpen(false)} label="Inbox" header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>🔔 Inbox</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={() => setInboxOpen(false)} aria-label="Close">✕</button></div>}>
          <AlertsInbox userId={user?.id ?? null} title="Flags & pings for you" />
          {canManage && <NeedsYou />}
        </Sheet>
      )}
      <div className="op-head">
        {/* Breadcrumb trail — only appears once a deep view registers a crumb (e.g. Prep › event). */}
        <Breadcrumbs root={SEC_LABEL[sec]} />
        <div className="op-head-row">
          <div className="op-head-t">{SEC_LABEL[sec]}</div>
          {/* Tap the WHEN pill → the full section guide, opened on this section, with jump links. */}
          <button type="button" className="op-head-when" onClick={() => setGuideOpen(true)} aria-haspopup="dialog" title="What each section is for">{SEC_WHEN[sec]}<span className="op-head-when-i" aria-hidden>ⓘ</span></button>
        </div>
        <div className="op-head-s">{SEC_SUB[sec]}</div>
      </div>

      {/* Secondary toggle — the ACTIVE LANE's sections (a section can live in two lanes — prep is
          Service's and Events' — so the tapped tab, tracked as groupId, wins the ambiguity). */}
      {(() => {
        const lanes = [{ id: "today", label: "Today", members: TODAY_GROUP.members.filter((m) => allowed.includes(m)) }, ...streamGroups(streams, role)];
        const grp = (navGroupId && lanes.find((g) => g.id === navGroupId && g.members.includes(sec))) || lanes.find((g) => g.members.includes(sec));
        const members = grp ? grp.members.filter((m: OpSection) => allowed.includes(m)) : [];
        if (members.length < 2) return null;
        return (
          <div className="grp-toggle" role="tablist" aria-label={grp!.label}>
            {members.map((m: OpSection) => (
              <button key={m} type="button" role="tab" aria-selected={sec === m} className={`grp-seg${sec === m ? " on" : ""}`} onClick={() => setSection(m)}>{PHASE_LABEL[grp!.id]?.[m] ?? SECTION_LABEL[m]}</button>
            ))}
          </div>
        );
      })()}

      {/* Shared-axis transition: keying on `sec` remounts the body on each section change so it
          fades+slides in. planTab changes keep the same key, so sub-tabs don't re-animate.
          role=region + focus-on-change: keyboard/SR users land in the new section, not adrift. */}
      <div className="op-trans" key={sec} ref={opBodyRef} tabIndex={-1} role="region" aria-label={`${SEC_LABEL[sec]} section`}>
      {sec === "day" && <MyDay userId={user?.id ?? null} meName={profile?.display_name?.trim() || "Me"} isLeader={canManage} canPrep={canPrep} canBrew={canManage || role === "operator"} />}
      {sec === "command" && canManage && <CommandBoard />}

      {sec === "now" && (
        <>
          {/* Now is the GLANCE + DISPATCH screen: unacked alerts → the service pulse (live counts,
              one tap into the working screen) → the drop's prep face (what to brew, what money) →
              Sunday delivery (folds until run day) → dispatch panels → personal tasks. The boards
              themselves (pass, pickup checklist, 86) render in ONE place: Service mode. */}
          <AlertsInbox userId={user?.id ?? null} compact />
          {!svc && (
            <>
              <ServicePulse onEnter={() => setSvc(true)} />
              {/* The truck instrument rides directly under the pulse — going live IS the first act
                  of service, not a panel below the fold. */}
              {canManage && <LiveControl compact />}
              <DropOps brief onOpen={() => setSvc(true)} canPlan={canManage} />
              <DeliveryOps />
              <OfficeOrders />
            </>
          )}
          {canManage && <Panel id="hud" title="Event heads-up"><EventHUD /></Panel>}
          <MyTasks userId={user?.id ?? null} chip />
          <EnableAlerts userId={user?.id ?? null} />
        </>
      )}
      {/* SERVICE MODE — the KDS as ONE working surface: the pass is the board (tickets flow 2-up
          on wide screens), and a sticky rail keeps pickups, the Sunday run sheet and the 86 board
          in reach without ever leaving the screen — 86ing a flavor mid-rush is a tap, not an exit.
          Exit with the button or Esc; leaving the Now section exits too. */}
      {svc && sec === "now" && (
        <div className="svc-full" role="dialog" aria-modal="true" aria-label="The Pass">
          <div className="svc-bar">
            <b>The Pass</b>
            <button type="button" className="svc-exit" onClick={() => setSvc(false)}>✕ Exit</button>
          </div>
          <div className="svc-grid">
            <div className="svc-main"><Kitchen /></div>
            <aside className="svc-rail" aria-label="Pickups & sold-out">
              <DropOps canPlan={canManage} />
              <EightySix />
            </aside>
          </div>
        </div>
      )}

      {sec === "ask" && <OperatorAssistant />}

      {sec === "prep" && canPrep && (
        <>
          {/* Money template: glance-first KPIs → crew-group dividers → the modules. */}
          <PrepKpis />
          <div className="crew-group">All open prep · one board</div>
          <Panel id="prep-board" title="Work every open task — critical first" defaultOpen><PrepBoard /></Panel>
          {canManage && <div className="crew-group">Readiness</div>}
          {canManage && <ReadinessAgent />}
          {canManage && <InspectionPrep />}
          <div className="crew-group">Event prep · by stop</div>
          <EventPrep onGo={goSection} />
        </>
      )}

      {sec === "plan" && canManage && (
        <>
          <div className="subnav" role="tablist" aria-label="Plan">
            {/* This week — what's hot at this stage */}
            {/* Ordered by operating rhythm (not alphabet): when → what → where → requests in →
                production → notes. Back office (rarely touched) sits after the divider. */}
            {([["calendar", "Calendar", 0], ["events", "Events", planCounts.events]] as const).map(([k, label, n]) => (
              <button key={k} type="button" role="tab" aria-selected={planTab === k} className={`subnav-tab${planTab === k ? " on" : ""}`} onClick={() => setPlanTab(k)}>
                {label}{n > 0 && <span className="subnav-badge">{n}</span>}
              </button>
            ))}
            <span className="subnav-div" aria-hidden />
            {/* Back office — rarely touched */}
            {([["vendors", "Vendors"]] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={planTab === k} className={`subnav-tab back${planTab === k ? " on" : ""}`} onClick={() => setPlanTab(k)}>{label}</button>
            ))}
          </div>
          {planTab === "calendar" && <CompanyCalendar />}
          {planTab === "events" && <EventsAdmin />}
          {planTab === "vendors" && <VendorsAdmin />}
        </>
      )}

      {sec === "studio" && canManage && (
        <>
          <Studio />
          <div className="crew-group">Shoots</div>
          <Panel id="shoots" title="Shoot planning · shot list &amp; call sheet"><ShootPlanner /></Panel>
          <Panel id="reviews" title="Customer reviews"><ReviewsAdmin /></Panel>
        </>
      )}

      {sec === "settings" && canManage && (
        <>
          {/* The owner control room — one front door for everything you can change without a
              developer. Copy lives HERE (the thing owners hunt for); the rest is a labeled map to
              the surfaces that already own each editor, so nothing is duplicated or piecemeal. */}
          <div className="crew-group">Owner control room</div>
          <p className="set-lead">Everything you can change without a developer. Edits go live instantly — no deploy.</p>
          <Panel id="set-copy" title="Copy & wording · every line guests read" defaultOpen><SiteCopyEditor /></Panel>
          <Panel id="set-broadcast" title="Broadcast · a live message or ad to everyone"><BroadcastEditor /></Panel>
          <Panel id="splash" title="App splash · the pop-up guests see"><PromoEditor /></Panel>
          {isAdmin && <Panel id="set-office" title="Office delivery · price & minimum"><OfficeSettings /></Panel>}
          <Panel id="set-ai" title="AI copilots · the full catalog"><CopilotDirectory /></Panel>
          {isAdmin && <Panel id="set-spend" title="AI spend · what your copilots cost"><AiSpend /></Panel>}
          {isAdmin && <Panel id="set-digest" title="Founder digest · the daily business roll-up"><FounderDigest /></Panel>}
          <Panel id="set-changelog" title="What we've built · changelog"><Changelog /></Panel>
          <div className="crew-group">More controls</div>
          <div className="set-map">
            {([
              ...(isAdmin ? [{ t: "Audit & maintenance", s: "Every audit run — scores, dates, what's overdue", to: "audit" as OpSection }] : []),
              { t: "Brand, splash & reviews", s: "Logo, kit, the pop-up, testimonials", to: "studio" },
              { t: "Checkout, payments & flags", s: "Pay-at-pickup · subscriptions · lead time", to: "money" },
              { t: "Menu, products & pricing", s: "Drinks, packs, COGS, plans", to: "money" },
              { t: "Discount codes", s: "Mint & manage codes", to: "customers" },
              { t: "Team & roles", s: "Who can do what", to: "team" },
            ] as { t: string; s: string; to: OpSection }[]).map((r) => (
              <button key={r.t} type="button" className="set-card" onClick={() => setSection(r.to)}>
                <span className="set-card-x"><b>{r.t}</b><span>{r.s}</span></span>
                <span className="set-card-c" aria-hidden>›</span>
              </button>
            ))}
          </div>
        </>
      )}

      {sec === "audit" && isAdmin && (
        <>
          {/* The owner's audit trail — every review run on the app (security, privacy, performance,
              accessibility, cohesion, data), scored, dated, and tracked for its next re-run. Same
              glance-first shape as Money: the health strip leads, then the log. */}
          <div className="crew-group">App health · audit trail</div>
          <p className="set-lead">Every audit run on the app — security, privacy, performance, accessibility, UI cohesion, data — with scores, dates, and what&apos;s due for a re-run. Log a new one any time you run a check.</p>
          <MaintenanceLog />
        </>
      )}

      {sec === "money" && isAdmin && (
        <>
          {/* Dashboard, not a filing cabinet: live numbers first, then modules grouped by job. */}
          <MoneyKpis />
          <div className="crew-group">Spend & budget</div>
          <Panel id="spend" title="Spend & budget · what the business spends" defaultOpen><SpendBudget /></Panel>
          <div className="crew-group">Get paid</div>
          <Panel id="pay" title="Checkout & payments" defaultOpen><PaymentSettings /></Panel>
          <div className="crew-group">The numbers</div>
          <Panel id="sales" title="Sales"><Reports /></Panel>
          <Panel id="snapshot" title="Business snapshot"><SnapshotReport /></Panel>
          <Panel id="pnl" title="Per-event P&L"><EventPnlReport /></Panel>
          <Panel id="funnels" title="Funnels · where people drop off"><FunnelReport /></Panel>
          <div className="crew-group">Catalog &amp; pricing</div>
          <Panel id="menu" title="Menu & products"><MenuManager /></Panel>
          <Panel id="econ" title="Product economics"><ProductCatalog /></Panel>
          <Panel id="cogs" title="COGS calculator"><CogsCalculator /></Panel>
          <div className="crew-group">Members &amp; subscriptions</div>
          <Panel id="plans" title="Membership plans"><PlanEditor /></Panel>
          <Panel id="subs" title="Subscribers"><Subscribers /></Panel>
          <Panel id="subint" title="Subscription interest"><SubInterest /></Panel>
          <div className="crew-group">Records</div>
          <Panel id="resv" title="Reserve drops"><ReservesAdmin /></Panel>
          <Panel id="orders" title="Order history"><OrdersHistory /></Panel>
        </>
      )}

      {sec === "pipeline" && canPrep && (
        <>
          {/* One lead funnel (typed): inbound booking requests are the intake stage, then the B2B
              pipeline. Consolidated here so leads live in ONE place, not split across Plan + Pipeline. */}
          <Bookings />
          <PipelinePanel isAdmin={isAdmin} />
        </>
      )}
      {sec === "stops" && canManage && <LiveControl manage />}
      {sec === "notes" && <MeetingNotes />}
      {sec === "brew" && canPrep && <BrewPlanner />}
      {sec === "garage" && canPrep && (
        <>
          <GarageKpis />
          <div className="crew-group">Assets &amp; stock</div>
          <GarageSection />
        </>
      )}
      {sec === "goals" && canManage && (<><PlanningBoard /><Goals /></>)}
      {sec === "driver" && <DriverDash isLead={canManage} />}

      {sec === "customers" && isAdmin && (
        <>
          {/* Money's 10/10 template: glance-first KPIs → crew-group dividers → uniform Panels. */}
          <CustomerKpis />
          <div className="crew-group">The people</div>
          <Panel id="cust-book" title="Customer book · every guest &amp; member" defaultOpen><CrmPanel /></Panel>
          <div className="crew-group">Loyalty &amp; codes</div>
          <Panel id="cust-codes" title="Discount codes · mint &amp; manage"><CodesPanel /></Panel>
          <div className="crew-group">VIP verification</div>
          <Panel id="cust-vip" title="Bottle-owner proofs · verify → Founding" defaultOpen><VipQueue /></Panel>
        </>
      )}

      {sec === "team" && isAdmin && (
        <>
          <TeamKpis />
          {isOwner && <div className="crew-group">Invite a teammate</div>}
          {isOwner && <InviteTeammate />}
          <div className="crew-group">Who&apos;s on what</div>
          <WorkloadBoard />
          <div className="crew-group">Roster</div>
          <OrgChart />
          {isOwner && <Members />}
          <div className="crew-group">Growth &amp; training</div>
          <Link href="/academy" className="opx-link">
            <span className="opx-link-t">GT3 Academy</span>
            <span className="opx-link-s">Training, certifications &amp; the cookbook →</span>
          </Link>
          {isOwner && <AiTraining />}
        </>
      )}
      </div>
    </section>
    </CrumbProvider>
  );
}
