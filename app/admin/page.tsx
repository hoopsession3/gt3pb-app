"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth, type Profile } from "@/components/AuthProvider";
import SignIn from "@/components/SignIn";
import { supabase } from "@/lib/supabase";
import { subscribePush } from "@/lib/push";
import { DRINKS, type DrinkId } from "@/lib/menu";
import type { Stop, LiveStatus, EventRow, BookingRequest, Order } from "@/lib/db";

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
const NEXT_LABEL: Record<string, string> = { new: "Start", preparing: "Mark ready", ready: "Picked up" };
const ACT_CLASS: Record<string, string> = { new: "go", preparing: "primary", ready: "done" };

function Kitchen() {
  const { toast } = useApp();
  const [orders, setOrders] = useState<Order[]>([]);
  const [, setTick] = useState(0); // re-render so ages stay current

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("orders").select("*").neq("status", "done").neq("status", "void").order("created_at");
    if (data) setOrders(data as Order[]);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    if (!supabase) return () => clearInterval(t);
    const ch = supabase.channel("admin-kds").on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load()).subscribe();
    return () => { clearInterval(t); supabase?.removeChannel(ch); };
  }, [load]);

  const advance = async (o: Order) => {
    const next = NEXT[o.status];
    if (!next) return;
    const { error } = await supabase!.from("orders").update({ status: next }).eq("id", o.id);
    if (error) toast(`Error: ${error.message}`);
  };
  const voidOrder = async (o: Order) => {
    if (typeof window !== "undefined" && !window.confirm(`Void ${o.customer ?? "this order"}? This can't be undone.`)) return;
    await supabase!.from("orders").update({ status: "void" }).eq("id", o.id);
  };

  const late = orders.filter((o) => o.status !== "ready" && ageMin(o.created_at) >= 8);

  return (
    <div className="adm-sec">
      <div className="sec">The pass{orders.length > 0 && <span className="adm-pill">{orders.length} active</span>}</div>

      {late.length > 0 && (
        <div className="adm-attn">
          <b>{late.map((o) => o.customer ?? "Guest").join(", ")}</b> waiting past 8 min — step over and reassure the guest.
        </div>
      )}

      {orders.map((o) => {
        const sev = ageSev(ageMin(o.created_at));
        return (
          <div className={`adm-order st-${o.status}`} key={o.id}>
            <button className="adm-act-more" onClick={() => voidOrder(o)} aria-label="Void order">⋯</button>
            <div className="adm-order-top">
              <b>{o.customer ?? "Guest"}</b>
              <span className={`adm-age ${sev}`}>{ago(o.created_at)}</span>
            </div>
            <div className="adm-items">{o.items.map((i) => DRINKS[i as DrinkId]?.n ?? i).join(" · ")}</div>
            <div className="meta">#{o.id.slice(0, 4).toUpperCase()} · ${(o.total_cents / 100).toFixed(2)} · <span className={o.paid ? "pd" : "unp"}>{o.paid ? "PAID" : "pre-order"}</span></div>
            {NEXT[o.status] && (
              <button className={`adm-act ${ACT_CLASS[o.status]}`} onClick={() => advance(o)}>{NEXT_LABEL[o.status]}</button>
            )}
          </div>
        );
      })}
      {orders.length === 0 && <div className="h-sub">The pass is clear. New orders arrive here in realtime.</div>}
    </div>
  );
}

// ───────────────────────── pre-flight readiness ─────────────────────────
const READY = ["Brewed", "Iced", "Stocked", "Cups", "Card reader"];
function Readiness() {
  const [done, setDone] = useState<Set<string>>(new Set());
  const all = done.size === READY.length;
  const toggle = (x: string) => setDone((p) => { const n = new Set(p); n.has(x) ? n.delete(x) : n.add(x); return n; });

  if (all) {
    return (
      <div className="adm-ready ok">
        <span className="adm-ready-dot" />
        <span><b>Trailer ready</b> · brewed, iced, stocked, cups, reader paired</span>
      </div>
    );
  }
  return (
    <div className="adm-ready">
      <div className="adm-ready-h">Pre-flight · {done.size}/{READY.length} ready</div>
      <div className="adm-ready-chips">
        {READY.map((x) => (
          <button key={x} className={`adm-chip${done.has(x) ? " on" : ""}`} onClick={() => toggle(x)}>{x}</button>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────── live truck control ─────────────────────────
function LiveControl() {
  const { toast } = useApp();
  const [stops, setStops] = useState<Stop[]>([]);
  const [live, setLive] = useState<LiveStatus | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: s }, { data: l }] = await Promise.all([
      supabase.from("stops").select("*").order("sort"),
      supabase.from("live_status").select("*").maybeSingle(),
    ]);
    if (s) setStops(s as Stop[]);
    if (l) setLive(l as LiveStatus);
  }, []);

  useEffect(() => {
    load();
    if (!supabase) return;
    const ch = supabase.channel("admin-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_status" }, (p) => setLive(p.new as LiveStatus))
      .on("postgres_changes", { event: "*", schema: "public", table: "stops" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  const goLive = async (stopId: string) => {
    const { error } = await supabase!.rpc("admin_set_live", { stop: stopId, live: true });
    toast(error ? `Error: ${error.message}` : "Truck is LIVE — members updated");
  };
  const pause = async () => {
    if (!live?.current_stop_id) return;
    const { error } = await supabase!.rpc("admin_set_live", { stop: live.current_stop_id, live: false });
    toast(error ? `Error: ${error.message}` : "Truck paused");
  };

  return (
    <div className="adm-sec">
      <div className="sec">Live truck</div>
      <div className="adm-live">
        <div><span className={`adm-dot${live?.is_live ? " on" : ""}`} /> {live?.is_live ? "Live now" : "Offline"}</div>
        {live?.is_live && <button className="adm-btn ghost" onClick={pause}>Pause</button>}
      </div>
      {stops.map((s) => {
        const isCur = s.id === live?.current_stop_id && live?.is_live;
        return (
          <div className={`adm-stop${isCur ? " cur" : ""}`} key={s.id}>
            <div><b>{s.name}</b><span>{s.location_text}</span></div>
            <button className={`adm-btn${isCur ? " on" : " go"}`} onClick={() => goLive(s.id)} disabled={isCur}>
              {isCur ? "Live ✓" : "Go live here"}
            </button>
          </div>
        );
      })}
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
      new_credit_cents: Math.round(parseFloat(credit || "0") * 100),
      new_founding: founding,
    });
    setBusy(false);
    toast(error ? `Error: ${error.message}` : `Saved ${m.display_name ?? "member"}`);
    if (!error) onSaved();
  };

  return (
    <div className="adm-member">
      <div className="adm-member-top">
        <b>{m.display_name ?? "—"}{m.is_admin && <span className="adm-tag">admin</span>}</b>
        <span className="adm-ref">{m.referral_code}</span>
      </div>
      <div className="adm-fields">
        <label>Points<input type="number" value={pts} onChange={(e) => setPts(parseInt(e.target.value) || 0)} /></label>
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

  return (
    <div className="adm-sec">
      <div className="sec">Events <button className="adm-btn" style={{ marginLeft: "auto" }} onClick={addEvent}>+ Add</button></div>
      {events.map((e) => (
        <div className="adm-event" key={e.id}>
          <div className="adm-member-top">
            <input className="auth-input" style={{ fontSize: 14, padding: "8px 10px" }} defaultValue={e.title} onBlur={(ev) => ev.target.value !== e.title && update(e.id, { title: ev.target.value })} />
          </div>
          <div className="adm-fields">
            <label>Day<input type="text" defaultValue={e.day_label ?? ""} onBlur={(ev) => update(e.id, { day_label: ev.target.value })} /></label>
            <label>Going<input type="number" defaultValue={e.going_count ?? 0} onBlur={(ev) => update(e.id, { going_count: parseInt(ev.target.value) || 0 })} /></label>
            <label className="adm-check"><input type="checkbox" defaultChecked={e.member_only} onChange={(ev) => update(e.id, { member_only: ev.target.checked })} />Members</label>
            <button className="adm-btn ghost" onClick={() => remove(e.id)}>Delete</button>
          </div>
        </div>
      ))}
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
  if (!profile?.is_admin) {
    return (
      <section className="screen">
        <div className="toprow"><div className="eyb">Admin</div><Link className="pf" href="/">‹</Link></div>
        <div className="h-title">Staff only.</div>
        <div className="h-sub">This area is for GT3PB staff. If that&apos;s you, sign in with your owner email.</div>
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
          <Readiness />
          <EnableAlerts userId={user?.id ?? null} />
          <Kitchen />
          <LiveControl />
        </>
      ) : (
        <>
          <Bookings />
          <EventsAdmin />
          <Members />
        </>
      )}
    </section>
  );
}
