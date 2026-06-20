"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth, type Profile } from "@/components/AuthProvider";
import SignIn from "@/components/SignIn";
import { supabase } from "@/lib/supabase";
import type { Stop, LiveStatus, EventRow } from "@/lib/db";

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
      <div className="sec">Live truck control</div>
      <div className="adm-live">
        <div><span className={`adm-dot${live?.is_live ? " on" : ""}`} /> {live?.is_live ? "LIVE NOW" : "Offline"}</div>
        {live?.is_live && <button className="adm-btn ghost" onClick={pause}>Pause</button>}
      </div>
      {stops.map((s) => {
        const isCur = s.id === live?.current_stop_id && live?.is_live;
        return (
          <div className={`adm-stop${isCur ? " cur" : ""}`} key={s.id}>
            <div><b>{s.name}</b><span>{s.location_text}</span></div>
            <button className={`adm-btn${isCur ? " on" : ""}`} onClick={() => goLive(s.id)} disabled={isCur}>
              {isCur ? "Live ✓" : "Go live here"}
            </button>
          </div>
        );
      })}
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
        <button className="adm-btn" onClick={save} disabled={!dirty || busy}>{busy ? "…" : "Save"}</button>
      </div>
    </div>
  );
}

function Members() {
  const [members, setMembers] = useState<Profile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("profiles").select("*").order("points", { ascending: false });
    if (data) setMembers(data as Profile[]);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="adm-sec">
      <div className="sec">Members · {members.length}</div>
      {members.map((m) => <MemberRow key={m.id} m={m} onSaved={load} />)}
      {loaded && members.length === 0 && <div className="h-sub">No members yet — they appear here when people sign in.</div>}
    </div>
  );
}

// ───────────────────────── events (going count + member-only) ─────────────────────────
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

  return (
    <div className="adm-sec">
      <div className="sec">Events</div>
      {events.map((e) => (
        <div className="adm-event" key={e.id}>
          <div className="adm-member-top"><b>{e.day_label} · {e.title}</b></div>
          <div className="adm-fields">
            <label>Going<input type="number" defaultValue={e.going_count ?? 0} onBlur={(ev) => update(e.id, { going_count: parseInt(ev.target.value) || 0 })} /></label>
            <label className="adm-check"><input type="checkbox" defaultChecked={e.member_only} onChange={(ev) => update(e.id, { member_only: ev.target.checked })} />Members only</label>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminPage() {
  const { ready, enabled, user, profile } = useAuth();

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
      <div className="toprow"><div className="eyb">GT3PB · Back office</div><Link className="pf" href="/3mpire" aria-label="Exit admin">‹</Link></div>
      <div className="h-title">Control room.</div>
      <div className="h-sub">Changes here reach every member instantly.</div>
      <LiveControl />
      <Members />
      <EventsAdmin />
    </section>
  );
}
