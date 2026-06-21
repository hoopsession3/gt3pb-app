"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth, type Profile } from "@/components/AuthProvider";
import SignIn from "@/components/SignIn";
import { supabase } from "@/lib/supabase";
import { subscribePush } from "@/lib/push";
import { chime, unlockAudio } from "@/lib/chime";
import { haptic, HAPTIC } from "@/lib/haptics";
import { DRINKS, type DrinkId } from "@/lib/menu";
import { geocode } from "@/lib/geocode";
import type { Stop, LiveStatus, EventRow, BookingRequest, Order, Reserve, Subscription } from "@/lib/db";

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
    const { error } = await supabase.from("orders").update({ status: to }).eq("id", o.id);
    if (error) { setErr(error.message); toast(`Couldn't update — ${error.message}`, "error"); load(); }
  };
  const advance = (o: Order) => move(o, NEXT[o.status]);
  const recall = (o: Order) => move(o, PREV[o.status]);
  const voidOrder = async (o: Order) => {
    if (typeof window !== "undefined" && !window.confirm(`Void ${o.customer ?? "this order"}? This can't be undone.`)) return;
    if (!supabase) return;
    apply(o, true);
    const { error } = await supabase.from("orders").update({ status: "void" }).eq("id", o.id);
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

  return (
    <div className="adm-member">
      <div className="adm-member-top">
        <b>{m.display_name ?? "—"}{m.is_admin && <span className="adm-tag">admin</span>}</b>
        <span className="adm-ref">{m.referral_code}</span>
      </div>
      <div className="adm-fields">
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
          <ReservesAdmin />
          <Subscribers />
          <SubInterest />
          <OrdersHistory />
          <EventsAdmin />
          <Members />
        </>
      )}
    </section>
  );
}
