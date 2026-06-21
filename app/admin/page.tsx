"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth, roleOf, type Profile } from "@/components/AuthProvider";
import SignIn from "@/components/SignIn";
import { supabase } from "@/lib/supabase";
import { subscribePush } from "@/lib/push";
import { chime, unlockAudio } from "@/lib/chime";
import { haptic, HAPTIC } from "@/lib/haptics";
import { DRINKS, type DrinkId } from "@/lib/menu";
import { geocode } from "@/lib/geocode";
import { packListFor } from "@/lib/packlist";
import type { Stop, LiveStatus, EventRow, EventTask, BookingRequest, Order, Reserve, Subscription } from "@/lib/db";

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
// Real per-event readiness: a pack-list checklist auto-derived from the event's rig/menu,
// persisted, realtime, role-scoped, with a crew roster + task assignment. Replaces the old
// hardcoded "Trailer ready" chips (which lied at a cart gig and reset on refresh).
function EventPrep() {
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const isAdmin = roleOf(profile) === "admin" || roleOf(profile) === "owner";
  const [ev, setEv] = useState<EventRow | null>(null);
  const [tasks, setTasks] = useState<EventTask[]>([]);
  const [crew, setCrew] = useState<{ id: string; user_id: string; role_label: string | null }[]>([]);
  const [staff, setStaff] = useState<{ id: string; display_name: string | null }[]>([]);
  const [newTask, setNewTask] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data: evs } = await supabase.from("events").select("*").order("sort");
    const list = (evs as EventRow[]) ?? [];
    const target = list.find((e) => e.is_live) ?? list[0] ?? null;
    setEv(target);
    if (!target) { setTasks([]); setCrew([]); return; }
    const [{ data: t }, { data: c }] = await Promise.all([
      supabase.from("event_tasks").select("*").eq("event_id", target.id).order("sort"),
      supabase.from("event_staff").select("id, user_id, role_label").eq("event_id", target.id),
    ]);
    setTasks((t as EventTask[]) ?? []);
    setCrew((c as { id: string; user_id: string; role_label: string | null }[]) ?? []);
    if (isAdmin) {
      const { data: p } = await supabase.from("profiles").select("id, display_name, role").neq("role", "member");
      setStaff((p as { id: string; display_name: string | null }[]) ?? []);
    }
  }, [isAdmin]);
  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel("admin-eventprep")
      .on("postgres_changes", { event: "*", schema: "public", table: "event_tasks" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "event_staff" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  const nameOf = (uid: string) => staff.find((s) => s.id === uid)?.display_name ?? "—";
  const generate = async () => {
    if (!ev || !supabase) return;
    const rows = packListFor(ev).map((p, i) => ({ event_id: ev.id, label: p.label, section: p.section, critical: !!p.critical, kind: "pack", sort: i }));
    if (!rows.length) { toast("Set the event's rig + menu first (Back office → Events)", "error"); return; }
    const { error } = await supabase.from("event_tasks").insert(rows);
    toast(error ? `Error: ${error.message}` : `Pack list generated — ${rows.length} items`);
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
    const { error } = await supabase.from("event_tasks").update({ assignee: uid || null }).eq("id", t.id);
    if (error) toast(`Error: ${error.message}`, "error"); else load();
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

  if (!ev) return <div className="adm-sec"><div className="h-sub">No event yet — add one in Back office → Events to prep it.</div></div>;
  const total = tasks.length, doneN = tasks.filter((t) => t.done).length;
  const critOut = tasks.filter((t) => t.critical && !t.done);
  const ready = total > 0 && doneN === total;
  const sections = [...new Set(tasks.map((t) => t.section ?? "Task"))];

  return (
    <div className="adm-sec adm-prep">
      <div className="sec">{ev.title} · prep{ev.is_live && <span className="adm-pill due">LIVE</span>}</div>
      {total > 0 ? (
        <div className={`adm-ready-bar${ready ? " ok" : critOut.length ? " miss" : ""}`}>
          <b>Loaded {doneN}/{total}</b>
          {critOut.length > 0 && <span className="adm-ready-miss"> · missing {critOut.slice(0, 2).map((t) => t.label).join(", ")}{critOut.length > 2 ? ` +${critOut.length - 2}` : ""}</span>}
          {ready && <span> · ready to roll</span>}
        </div>
      ) : isAdmin ? (
        <button className="adm-btn primary" onClick={generate}>Generate pack list from menu</button>
      ) : <div className="h-sub">No pack list yet — an owner generates it.</div>}

      {isAdmin && (
        <div className="adm-crew-row">
          {crew.map((c) => <button key={c.id} className="adm-crew-chip" onClick={() => removeCrew(c.id)} title="Remove">{nameOf(c.user_id)} ✕</button>)}
          <select className="adm-role" value="" onChange={(e) => { addCrew(e.target.value); e.target.value = ""; }} aria-label="Add crew">
            <option value="">+ crew</option>
            {staff.filter((s) => !crew.some((c) => c.user_id === s.id)).map((s) => <option key={s.id} value={s.id}>{s.display_name ?? "—"}</option>)}
          </select>
        </div>
      )}

      {sections.map((sec) => (
        <div key={sec} className="adm-prep-sec">
          <div className="adm-prep-label">{sec}</div>
          {tasks.filter((t) => (t.section ?? "Task") === sec).map((t) => (
            <div key={t.id} className={`adm-task${t.done ? " done" : ""}${t.critical ? " crit" : ""}`}>
              <label className="adm-task-check"><input type="checkbox" checked={t.done} onChange={() => toggle(t)} /><span>{t.label}</span></label>
              {isAdmin && (
                <select className="adm-task-assign" value={t.assignee ?? ""} onChange={(e) => assign(t, e.target.value)} aria-label="Assign">
                  <option value="">—</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{(s.display_name ?? "—").split(" ")[0]}</option>)}
                </select>
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
    </div>
  );
}

// ───────────────────────── one stop: go-live + location + notes ─────────────────────────
function StopControl({ s, isCur, onGoLive, onChanged }: { s: Stop; isCur: boolean; onGoLive: (id: string) => void; onChanged: () => void }) {
  const { toast } = useApp();
  const [name, setName] = useState(s.name);
  const [address, setAddress] = useState(s.address ?? "");
  const [busy, setBusy] = useState(false);
  const hasCoords = s.lat != null && s.lng != null;

  const saveName = async () => {
    const nm = name.trim();
    if (!nm || nm === s.name) return;
    const { error } = await supabase!.from("stops").update({ name: nm }).eq("id", s.id);
    toast(error ? `Error: ${error.message}` : "Name saved");
    onChanged();
  };
  const saveNotes = async (notes: string) => {
    const { error } = await supabase!.from("stops").update({ notes: notes.trim() || null }).eq("id", s.id);
    toast(error ? `Error: ${error.message}` : "Stop details saved");
    onChanged();
  };
  const saveLocation = async () => {
    const q = address.trim();
    if (!q) return;
    setBusy(true);
    const geo = await geocode(q);
    if (!geo) { setBusy(false); toast("Couldn't find that address — add city & state, then retry."); return; }
    const { error } = await supabase!.from("stops").update({ address: q, location_text: q, lat: geo.lat, lng: geo.lng }).eq("id", s.id);
    setBusy(false);
    toast(error ? `Error: ${error.message}` : "Location set — directions are now accurate");
    onChanged();
  };
  const remove = async () => {
    if (typeof window !== "undefined" && !window.confirm(`Remove ${s.name}?`)) return;
    const { error } = await supabase!.from("stops").delete().eq("id", s.id);
    toast(error ? `Error: ${error.message}` : "Stop removed");
    onChanged();
  };

  return (
    <div className="adm-stopwrap">
      <div className={`adm-stop${isCur ? " cur" : ""}`}>
        <input className="adm-stopname" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} maxLength={120} placeholder="Stop name" />
        <button className={`adm-btn${isCur ? " on" : " go"}`} onClick={() => onGoLive(s.id)} disabled={isCur}>
          {isCur ? "Live ✓" : "Go live here"}
        </button>
      </div>
      <div className="adm-loc">
        <input className="adm-locinput" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address (for directions)" maxLength={300} />
        <button className="adm-btn" onClick={saveLocation} disabled={busy || !address.trim()}>{busy ? "Finding…" : "Save location"}</button>
      </div>
      <div className={`adm-loc-status${hasCoords ? " ok" : ""}`}>
        {hasCoords ? `Location set · ${(s.lat as number).toFixed(4)}, ${(s.lng as number).toFixed(4)}` : "No location set — add an address so directions are accurate"}
      </div>
      <textarea
        className="adm-notes"
        rows={2}
        maxLength={1000}
        defaultValue={s.notes ?? ""}
        placeholder="Details guests see when they tap this stop — parking, what's special, anything to know"
        onBlur={(e) => { if (e.target.value !== (s.notes ?? "")) saveNotes(e.target.value); }}
      />
      <button className="adm-stop-remove" onClick={remove}>Remove stop</button>
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

  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: s, error: se }, { data: l }] = await Promise.all([
      supabase.from("stops").select("*").order("sort"),
      supabase.from("live_status").select("*").maybeSingle(),
    ]);
    if (se) setErr(se.message); else setErr("");
    if (s) setStops(s as Stop[]);
    if (l) setLive(l as LiveStatus);
  }, []);

  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel("admin-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_status" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "stops" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  // Optimistic flip first (instant), then write + reconcile. Pause no longer needs a
  // stop — admin_set_offline just flips is_live, so it always works.
  const goLive = async (stopId: string) => {
    setLive((l) => ({ id: 1, current_stop_id: stopId, is_live: true, next_eta: l?.next_eta ?? null }));
    const { error } = await supabase!.rpc("admin_set_live", { stop: stopId, live: true });
    if (error) { setErr(error.message); toast(`Couldn't go live — ${error.message}`, "error"); }
    else toast("Truck is LIVE — members updated");
    load();
  };
  const pause = async () => {
    setLive((l) => (l ? { ...l, is_live: false } : { id: 1, current_stop_id: null, is_live: false, next_eta: null }));
    const { error } = await supabase!.rpc("admin_set_offline");
    if (error) { setErr(error.message); toast(`Couldn't go offline — ${error.message}`, "error"); }
    else toast("Truck is offline");
    load();
  };
  // Broadcast this phone's GPS as the truck's live position — members watch the dot move.
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
  const posLabel = live?.is_live
    ? live?.pos_updated_at
      ? `Pinned ${new Date(live.pos_updated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : "Location not pinned yet"
    : "";
  const addStop = async () => {
    const { error } = await supabase!.from("stops").insert({ name: "New stop", status: "upcoming", sort: stops.length });
    if (error) { setErr(error.message); toast(`Couldn't add — ${error.message}`, "error"); }
    else toast("Stop added — set its name, address & details below");
    load();
  };
  const curStop = stops.find((s) => s.id === live?.current_stop_id);

  return (
    <div className="adm-sec">
      <div className="sec">Live truck <button className="adm-btn" style={{ marginLeft: "auto" }} onClick={addStop}>+ Add stop</button></div>
      {err && <div className="adm-attn" role="alert">Backend error: {err}</div>}
      <div className="adm-live">
        <div className="adm-live-status">
          <span className={`adm-dot${live?.is_live ? " on" : ""}`} />
          <span><b>{live?.is_live ? "Live now" : "Offline"}</b>{live?.is_live && curStop ? <span className="adm-live-at"> · {curStop.name}</span> : null}</span>
        </div>
        {live?.is_live && <button className="adm-btn ghost" onClick={pause}>Go offline</button>}
      </div>
      {live?.is_live && (
        <div className="adm-live adm-live-pos">
          <div className="adm-live-status"><span className="h-sub">{posLabel}</span></div>
          <button className="adm-btn ghost" onClick={pinHere} disabled={posBusy}>{posBusy ? "Pinning…" : live?.pos_updated_at ? "Update location" : "Use my location"}</button>
        </div>
      )}
      {stops.map((s) => (
        <StopControl key={s.id} s={s} isCur={Boolean(s.id === live?.current_stop_id && live?.is_live)} onGoLive={goLive} onChanged={load} />
      ))}
      {stops.length === 0 && <div className="h-sub">No stops yet — tap &ldquo;Add stop&rdquo; to create your first location.</div>}
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
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data: e } = await supabase.from("events").select("*").eq("is_live", true).maybeSingle();
    setEv((e as EventRow) ?? null);
    if (!e) { setStats({ cents: 0, orders: 0, firstAt: null }); return; }
    const eid = (e as EventRow).id;
    const [{ data: ords }, { data: sales }] = await Promise.all([
      supabase.from("orders").select("total_cents, paid, created_at").eq("event_id", eid),
      supabase.from("event_sales").select("amount_cents, created_at").eq("event_id", eid),
    ]);
    const o = (ords as { total_cents: number; paid: boolean; created_at: string }[]) ?? [];
    const s = (sales as { amount_cents: number; created_at: string }[]) ?? [];
    const cents = o.filter((x) => x.paid).reduce((a, x) => a + x.total_cents, 0) + s.reduce((a, x) => a + x.amount_cents, 0);
    const times = [...o.map((x) => x.created_at), ...s.map((x) => x.created_at)].filter(Boolean).sort();
    setStats({ cents, orders: o.length + s.length, firstAt: times[0] ?? null });
  }, []);
  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel("admin-eventhud")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "event_sales" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);
  if (!ev) return null;
  const hrs = stats.firstAt ? Math.max(0.25, (Date.now() - new Date(stats.firstAt).getTime()) / 3600000) : 0;
  const perHr = hrs ? stats.cents / hrs : 0;
  return (
    <div className="adm-sec adm-hud">
      <div className="sec">{ev.title}<span className="adm-pill due">LIVE</span></div>
      <div className="adm-hud-row">
        <div className="adm-hud-stat"><b>${(stats.cents / 100).toFixed(0)}</b><span>sales</span></div>
        <div className="adm-hud-stat"><b>{stats.orders}</b><span>orders</span></div>
        <div className="adm-hud-stat"><b>${(perHr / 100).toFixed(0)}</b><span>per hr</span></div>
      </div>
    </div>
  );
}

function EventsAdmin() {
  const { toast } = useApp();
  const [events, setEvents] = useState<EventRow[]>([]);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("events").select("*").order("sort");
    if (data) setEvents(data as EventRow[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const update = async (id: string, patch: Partial<EventRow>) => {
    const { error } = await supabase!.from("events").update(patch).eq("id", id);
    toast(error ? `Error: ${error.message}` : "Event updated");
    if (!error) load();
  };
  const addEvent = async () => {
    const { error } = await supabase!.from("events").insert({ title: "New event", day_label: "SAT", sort: events.length });
    toast(error ? `Error: ${error.message}` : "Event added");
    if (!error) load();
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

  return (
    <div className="adm-sec">
      <div className="sec">Events <button className="adm-btn" style={{ marginLeft: "auto" }} onClick={addEvent}>+ Add</button></div>
      {events.map((e) => (
        <div className="adm-event" key={e.id}>
          <div className="adm-member-top">
            <input className="auth-input" style={{ fontSize: 16, padding: "9px 11px" }} maxLength={200} defaultValue={e.title} onBlur={(ev) => ev.target.value !== e.title && update(e.id, { title: ev.target.value })} aria-label="Event title" />
          </div>
          <input className="auth-input" style={{ fontSize: 16, padding: "9px 11px", marginTop: 6 }} maxLength={300} defaultValue={e.blurb ?? ""} placeholder="Details guests see when they tap this event" aria-label="Event details" onBlur={(ev) => (ev.target.value.trim() || null) !== e.blurb && update(e.id, { blurb: ev.target.value.trim() || null })} />
          <input className="auth-input" style={{ fontSize: 16, padding: "9px 11px", marginTop: 6 }} maxLength={200} defaultValue={e.location_text ?? ""} placeholder="Location" aria-label="Location" onBlur={(ev) => (ev.target.value.trim() || null) !== e.location_text && update(e.id, { location_text: ev.target.value.trim() || null })} />
          <div className="adm-fields">
            <label>Day<input type="text" defaultValue={e.day_label ?? ""} onBlur={(ev) => update(e.id, { day_label: ev.target.value })} /></label>
            <label>Start<input type="text" defaultValue={e.start_time ?? ""} onBlur={(ev) => update(e.id, { start_time: ev.target.value.trim() || null })} /></label>
            <label>End<input type="text" defaultValue={e.end_time ?? ""} onBlur={(ev) => update(e.id, { end_time: ev.target.value.trim() || null })} /></label>
            <label>Going<input type="number" min={0} defaultValue={e.going_count ?? 0} onBlur={(ev) => update(e.id, { going_count: Math.max(0, parseInt(ev.target.value) || 0) })} /></label>
            <label className="adm-check"><input type="checkbox" defaultChecked={e.member_only} onChange={(ev) => update(e.id, { member_only: ev.target.checked })} />Members</label>
            <button className="adm-btn ghost" onClick={() => remove(e.id)}>Delete</button>
          </div>

          <div className="adm-prep-label">Event prep — drives the pack list &amp; sales tracking</div>
          <div className="adm-fields">
            <label className="adm-check"><input type="checkbox" checked={!!e.is_live} onChange={(ev) => setLive(e.id, ev.target.checked)} /><b style={e.is_live ? { color: "var(--red)" } : undefined}>{e.is_live ? "LIVE now" : "Set live"}</b></label>
            <label>Rig<select className="adm-role" defaultValue={e.rig ?? ""} onChange={(ev) => update(e.id, { rig: (ev.target.value || null) as EventRow["rig"] })}>
              <option value="">—</option><option value="cart_only">Cart only</option><option value="trailer_plus_cart">Trailer + cart</option>
            </select></label>
            <label>Att.<input type="number" min={0} defaultValue={e.expected_attendance ?? 0} onBlur={(ev) => update(e.id, { expected_attendance: Math.max(0, parseInt(ev.target.value) || 0) })} /></label>
            <label>Hrs<input type="number" min={0} step={0.5} defaultValue={e.duration_hrs ?? 0} onBlur={(ev) => update(e.id, { duration_hrs: parseFloat(ev.target.value) || 0 })} /></label>
            <label>Staff<input type="number" min={0} defaultValue={e.staff_count ?? 0} onBlur={(ev) => update(e.id, { staff_count: Math.max(0, parseInt(ev.target.value) || 0) })} /></label>
          </div>
          <div className="adm-fields">
            <label className="adm-check"><input type="checkbox" defaultChecked={!!e.power_available} onChange={(ev) => update(e.id, { power_available: ev.target.checked })} />Power</label>
            <label className="adm-check"><input type="checkbox" defaultChecked={!!e.water_available} onChange={(ev) => update(e.id, { water_available: ev.target.checked })} />Water</label>
            <label className="adm-check"><input type="checkbox" defaultChecked={!!e.menu_nitro} onChange={(ev) => update(e.id, { menu_nitro: ev.target.checked })} />Nitro</label>
            <label className="adm-check"><input type="checkbox" defaultChecked={!!e.menu_nature_aid} onChange={(ev) => update(e.id, { menu_nature_aid: ev.target.checked })} />Nature Aid</label>
            <label className="adm-check"><input type="checkbox" defaultChecked={!!e.menu_salted_maple} onChange={(ev) => update(e.id, { menu_salted_maple: ev.target.checked })} />Salted Maple</label>
            <label className="adm-check"><input type="checkbox" defaultChecked={!!e.menu_bottles} onChange={(ev) => update(e.id, { menu_bottles: ev.target.checked })} />Bottles</label>
            <label className="adm-check"><input type="checkbox" defaultChecked={!!e.menu_broth} onChange={(ev) => update(e.id, { menu_broth: ev.target.checked })} />Broth</label>
          </div>
        </div>
      ))}
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

export default function AdminPage() {
  const { ready, enabled, user, profile } = useAuth();
  const [mode, setMode] = useState<"service" | "office">("service");

  if (!enabled) return <section className="screen"><div className="h-title">Admin</div><div className="h-sub">The live backend isn&apos;t configured here.</div></section>;
  if (!ready) return <section className="screen" />;
  if (!user) return <SignIn />;
  const role = roleOf(profile);
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

  // Server is locked to the KDS — no toggle, no live truck, no back office.
  if (!isAdmin) {
    return (
      <section className="screen admin">
        <div className="toprow">
          <div className="eyb">GT3PB · Service</div>
          <Link className="pf" href="/3mpire" aria-label="Exit admin">‹</Link>
        </div>
        <EnableAlerts userId={user?.id ?? null} />
        <Kitchen />
      </section>
    );
  }

  return (
    <section className="screen admin">
      <div className="toprow">
        <div className="eyb">GT3PB · {mode === "service" ? "Service" : "Back office"}</div>
        <Link className="pf" href="/3mpire" aria-label="Exit admin">‹</Link>
      </div>

      <div className="adm-switch">
        <button className={mode === "service" ? "on" : ""} onClick={() => setMode("service")}>Service</button>
        <button className={mode === "office" ? "on" : ""} onClick={() => setMode("office")}>Back office</button>
      </div>

      {mode === "service" ? (
        <>
          <EventHUD />
          <EventPrep />
          <EnableAlerts userId={user?.id ?? null} />
          <Kitchen />
          <LiveControl />
        </>
      ) : (
        <>
          <Bookings />
          <ReservesAdmin />
          <Subscribers />
          <SubInterest />
          <OrdersHistory />
          <EventsAdmin />
          {isOwner && <Members />}
        </>
      )}
    </section>
  );
}
