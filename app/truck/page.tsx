"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth } from "@/components/AuthProvider";
import AccountPill from "@/components/AccountPill";
import RouteMap, { type RoutePoint } from "@/components/RouteMap";
import { clickable } from "@/lib/a11y";
import { supabase } from "@/lib/supabase";
import type { Stop, LiveStatus } from "@/lib/db";

const DEMO_POINTS: RoutePoint[] = [
  { name: "Duncan Town Square", lat: 34.9382, lng: -82.1426, live: true },
  { name: "Greenville Run Club", lat: 34.8526, lng: -82.394 },
  { name: "Spartanburg Market", lat: 34.9496, lng: -81.932 },
  { name: "Founding First Pour", lat: 34.9387, lng: -82.2271 },
];

function useCountdown() {
  const [cd, setCd] = useState("00:00:00");
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const tgt = new Date(now);
      tgt.setHours(16, 30, 0, 0);
      let d = Math.floor((tgt.getTime() - now.getTime()) / 1000);
      if (d < 0) d += 86400;
      const p = (n: number) => String(n).padStart(2, "0");
      setCd(`${p(Math.floor(d / 3600))}:${p(Math.floor((d % 3600) / 60))}:${p(d % 60)}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return cd;
}

// ───────────────────────── live (Supabase + realtime) ─────────────────────────
function TruckLive() {
  const { toast } = useApp();
  const router = useRouter();
  const cd = useCountdown();
  const [stops, setStops] = useState<Stop[]>([]);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: s }, { data: l }] = await Promise.all([
      supabase.from("stops").select("*").order("sort"),
      supabase.from("live_status").select("*").maybeSingle(),
    ]);
    if (s) setStops(s as Stop[]);
    if (l) setLive(l as LiveStatus);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    if (!supabase) return;
    // Realtime: the truck flips is_live / current_stop_id and the hero updates instantly.
    const ch = supabase
      .channel("truck-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_status" }, (p) => setLive(p.new as LiveStatus))
      .on("postgres_changes", { event: "*", schema: "public", table: "stops" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  const liveStop =
    stops.find((s) => s.id === live?.current_stop_id) ?? stops.find((s) => s.status === "live") ?? stops[0];
  const isLive = Boolean(live?.is_live);
  const points: RoutePoint[] = stops
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ name: s.name, lat: s.lat as number, lng: s.lng as number, live: s.status === "live" }));

  return (
    <section className="screen" id="s-truck">
      <div className="toprow">
        <div className="eyb">On the ground</div>
        <AccountPill />
      </div>

      <div className="hero"><div className="hin">
        {isLive ? (
          <div className="livebadge"><span className="d" />Live now</div>
        ) : (
          <div className="hero-eye">Next stop</div>
        )}
        <div className="hero-state" style={{ fontSize: 26 }}>{liveStop?.name ?? (loaded ? "No stops yet" : "…")}</div>
        <div className="hero-sub">{liveStop?.location_text ?? ""}{liveStop ? " · the full bar on board" : ""}</div>
        <div className="cells">
          <div className="cell"><div className={`cv ${isLive ? "ok" : "gold"}`}>{isLive ? "LIVE" : "Soon"}</div><div className="cl">Status</div></div>
          <div className="cell"><div className="cv">{liveStop?.time_label ?? "—"}</div><div className="cl">Open</div></div>
          <div className="cell"><div className="cv ok">~7 min</div><div className="cl">Wait</div></div>
        </div>
        <div className="countpill"><span className="cl">Next stop in</span><span className="cd">{cd}</span></div>
        <button className="handle" style={{ marginTop: 14 }} onClick={() => router.push("/menu")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M5 12h14M12 5v14" /></svg>
          <span>Pre-order · skip the line</span>
        </button>
      </div></div>

      {points.length >= 2 && (
        <>
          <div className="sec">Our route · the strategic circle</div>
          <RouteMap points={points} />
        </>
      )}

      <div className="sec">This week</div>
      {stops.map((s) => {
        const rowLive = s.status === "live";
        return (
          <div
            key={s.id}
            className={`stop${rowLive ? " now" : ""}`}
            aria-label={`${s.name}${rowLive ? ", live now — pre-order" : " — save reminder"}`}
            {...clickable(() => (rowLive ? router.push("/menu") : toast("Saved — we'll remind you")))}
          >
            <div className="when"><b>{s.when_label ?? ""}</b><span>{s.time_label ?? ""}</span></div>
            <div className="info"><b>{s.name}</b><span>{s.location_text ?? ""}</span></div>
            <div className={`tag ${rowLive ? "live" : "soon"}`}>{s.tag_label ?? (rowLive ? "Live" : "Soon")}</div>
          </div>
        );
      })}
      {loaded && stops.length === 0 && <div className="h-sub">No stops scheduled right now — check back soon.</div>}
    </section>
  );
}

// ───────────────────────── demo (Supabase not configured) ─────────────────────────
function TruckDemo() {
  const { toast } = useApp();
  const router = useRouter();
  const cd = useCountdown();
  return (
    <section className="screen" id="s-truck">
      <div className="toprow">
        <div className="eyb">On the ground</div>
        <AccountPill />
      </div>
      <div className="hero"><div className="hin">
        <div className="livebadge"><span className="d" />Live now</div>
        <div className="hero-state" style={{ fontSize: 26 }}>Duncan Town Square</div>
        <div className="hero-sub">Saturday Market · the full bar on board</div>
        <div className="cells">
          <div className="cell"><div className="cv gold">1.4 mi</div><div className="cl">Away</div></div>
          <div className="cell"><div className="cv">til 3:00p</div><div className="cl">Open</div></div>
          <div className="cell"><div className="cv ok">~7 min</div><div className="cl">Wait</div></div>
        </div>
        <div className="countpill"><span className="cl">Next stop in</span><span className="cd">{cd}</span></div>
        <button className="handle" style={{ marginTop: 14 }} onClick={() => router.push("/menu")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M5 12h14M12 5v14" /></svg>
          <span>Pre-order · skip the line</span>
        </button>
      </div></div>
      <div className="sec">Our route · the strategic circle</div>
      <RouteMap points={DEMO_POINTS} />

      <div className="sec">This week</div>
      <div className="stop now" aria-label="Duncan Town Square, live now — pre-order" {...clickable(() => router.push("/menu"))}>
        <div className="when"><b>NOW</b><span>til 3p</span></div>
        <div className="info"><b>Duncan Town Square</b><span>Saturday Market</span></div>
        <div className="tag live">Live</div>
      </div>
      <div className="stop" aria-label="Greenville Run Club — save reminder" {...clickable(() => toast("Saved — we'll remind you"))}>
        <div className="when"><b>SUN</b><span>10–2</span></div>
        <div className="info"><b>Greenville Run Club</b><span>Hydrate + Rebuild</span></div>
        <div className="tag soon">Sun</div>
      </div>
      <div className="stop" aria-label="Spartanburg Market — save reminder" {...clickable(() => toast("Saved — we'll remind you"))}>
        <div className="when"><b>WED</b><span>7–11</span></div>
        <div className="info"><b>Spartanburg Market</b><span>Full bar</span></div>
        <div className="tag soon">Wed</div>
      </div>
      <div className="stop" aria-label="Founding First Pour — save reminder" {...clickable(() => toast("Saved — we'll remind you"))}>
        <div className="when"><b>SAT</b><span>2:30</span></div>
        <div className="info"><b>Founding First Pour</b><span>DUSK winter blend · members</span></div>
        <div className="tag soon">Next</div>
      </div>
    </section>
  );
}

export default function TruckScreen() {
  const { enabled } = useAuth();
  return enabled ? <TruckLive /> : <TruckDemo />;
}
