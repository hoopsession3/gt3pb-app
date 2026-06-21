"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useAuth } from "@/components/AuthProvider";
import AccountPill from "@/components/AccountPill";
import RouteMap, { type RoutePoint } from "@/components/RouteMap";
import Skeleton from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import { clickable } from "@/lib/a11y";
import { openDirections } from "@/lib/maps";
import { supabase } from "@/lib/supabase";
import type { Stop, LiveStatus } from "@/lib/db";

const DEMO_POINTS: RoutePoint[] = [
  { name: "Duncan Town Square", lat: 34.9382, lng: -82.1426, live: true },
  { name: "Greenville Run Club", lat: 34.8526, lng: -82.394 },
  { name: "Spartanburg Market", lat: 34.9496, lng: -81.932 },
  { name: "Founding First Pour", lat: 34.9387, lng: -82.2271 },
];

// ───────────────────────── editorial dispatch header (no card/tiles/clock) ─────────────────────────
function Dispatch({ live, place, sub, openLabel, wait, next, onOrder }: {
  live: boolean; place: string; sub: string; openLabel: string; wait: string; next: string | null; onOrder: () => void;
}) {
  return (
    <header className="disp">
      <div className={`disp-eye${live ? " live" : ""}`}>{live && <span className="livedot" />}{live ? "Live now" : "Next stop"}</div>
      <h1 className="disp-name">{place}</h1>
      {sub && <p className="disp-sub">{sub}</p>}
      <div className="disp-facts">
        <div className="fact"><span className="fk">Status</span><span className={`fv${live ? " ok" : ""}`}>{live ? "Live" : "Soon"}</span></div>
        <div className="fact"><span className="fk">Open</span><span className="fv">{openLabel || "—"}</span></div>
        <div className="fact"><span className="fk">Wait</span><span className="fv">{wait}</span></div>
      </div>
      {next && <p className="disp-next">Next · <b>{next}</b></p>}
      <button type="button" className="t-order" onClick={onOrder}>Pre-order · skip the line</button>
    </header>
  );
}

function nextLabelFrom(stops: Stop[], liveId?: string) {
  const idx = stops.findIndex((s) => s.id === liveId);
  const n = (idx >= 0 ? stops.slice(idx + 1) : stops).find((s) => s.id !== liveId) ?? stops.find((s) => s.id !== liveId);
  return n ? `${n.name} — ${[n.when_label, n.time_label].filter(Boolean).join(" ")}`.trim().replace(/—\s*$/, "").trim() : null;
}

// ───────────────────────── live (Supabase + realtime) ─────────────────────────
function TruckLive() {
  const { toast } = useApp();
  const router = useRouter();
  const [stops, setStops] = useState<Stop[]>([]);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [openStop, setOpenStop] = useState<string | null>(null);

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
    const ch = supabase
      .channel("truck-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_status" }, (p) => setLive(p.new as LiveStatus))
      .on("postgres_changes", { event: "*", schema: "public", table: "stops" }, () => load())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [load]);

  const liveStop = stops.find((s) => s.id === live?.current_stop_id) ?? stops.find((s) => s.status === "live") ?? stops[0];
  const isLive = Boolean(live?.is_live);
  // Memoize on `stops` only, so a realtime position update (which changes `live`, not
  // `stops`) doesn't rebuild the whole map — the truck dot just moves.
  const points: RoutePoint[] = useMemo(() => stops
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ name: s.name, lat: s.lat as number, lng: s.lng as number, live: s.status === "live" })), [stops]);
  // Show the live dot only while the truck is actually live and broadcasting a position.
  const truckPos = useMemo(
    () => (isLive && live?.truck_lat != null && live?.truck_lng != null ? { lat: live.truck_lat, lng: live.truck_lng } : null),
    [isLive, live?.truck_lat, live?.truck_lng]
  );

  return (
    <section className="screen truck" id="s-truck">
      <div className="toprow">
        <div className="eyb">On the ground</div>
        <AccountPill />
      </div>

      <Dispatch
        live={isLive}
        place={liveStop?.name ?? (loaded ? "No stops yet" : "…")}
        sub={liveStop ? `${liveStop.location_text ?? ""}${liveStop.location_text ? " — " : ""}the full bar on board` : ""}
        openLabel={liveStop?.time_label ?? ""}
        wait="~7 min"
        next={nextLabelFrom(stops, liveStop?.id)}
        onOrder={() => router.push("/menu")}
      />

      <div className="dchapter"><span className="dchn">The Route</span><span className="dchw">this week</span></div>
      <div className="dchrule" />

      {!loaded && <Skeleton variant="row" count={4} />}
      {stops.map((s) => {
        const rowLive = s.status === "live";
        const isOpen = openStop === s.id;
        return (
          <div key={s.id}>
            <div
              className={`stop${rowLive ? " now" : ""}${isOpen ? " open" : ""}`}
              aria-expanded={isOpen}
              aria-label={`${s.name}, ${rowLive ? "live now" : "upcoming"} — details`}
              {...clickable(() => setOpenStop(isOpen ? null : s.id))}
            >
              <div className="when"><b>{s.when_label ?? ""}</b><span>{s.time_label ?? ""}</span></div>
              <div className="info"><b>{s.name}</b><span>{s.location_text ?? ""}</span></div>
              {rowLive && <div className="tag live">Live</div>}
              <span className={`stop-caret${isOpen ? " open" : ""}`} aria-hidden="true">›</span>
            </div>
            {isOpen && (
              <div className="stop-detail">
                <p className="stop-notes">{s.notes ?? "Full bar on board. Order ahead or save a reminder."}</p>
                {rowLive ? (
                  <button className="t-order" style={{ marginTop: 12 }} onClick={() => router.push("/menu")}>Pre-order · skip the line</button>
                ) : (
                  <button className="t-ghost" style={{ marginTop: 12 }} onClick={() => toast("Saved — we'll remind you before this stop")}>Remind me</button>
                )}
                {s.lat != null && s.lng != null && (
                  <button className="t-ghost" style={{ marginTop: 10 }} onClick={() => openDirections(s.lat as number, s.lng as number)}>Get directions</button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {loaded && stops.length === 0 && <EmptyState title="No stops scheduled" sub="Check back soon — this week's route posts here." />}

      {points.length >= 2 && (
        <>
          <div className="dchapter"><span className="dchn">The Circuit</span><span className="dchw">tap a stop for directions</span></div>
          <div className="dchrule" />
          <RouteMap points={points} truck={truckPos} />
        </>
      )}
    </section>
  );
}

// ───────────────────────── demo (Supabase not configured) ─────────────────────────
function TruckDemo() {
  const { toast } = useApp();
  const router = useRouter();
  const rows = [
    { when: "NOW", time: "til 3p", name: "Duncan Town Square", desc: "Saturday Market", live: true, tag: "Live" },
    { when: "SUN", time: "10–2", name: "Greenville Run Club", desc: "Hydrate + Rebuild", live: false, tag: "Sun" },
    { when: "WED", time: "7–11", name: "Spartanburg Market", desc: "Full bar", live: false, tag: "Wed" },
    { when: "SAT", time: "2:30", name: "Founding First Pour", desc: "DUSK winter blend · members", live: false, tag: "Next" },
  ];
  return (
    <section className="screen truck" id="s-truck">
      <div className="toprow">
        <div className="eyb">On the ground</div>
        <AccountPill />
      </div>

      <Dispatch
        live
        place="Duncan Town Square"
        sub="Saturday Market — the full bar on board"
        openLabel="til 3p"
        wait="~7 min"
        next="Greenville Run Club — Sun 10–2"
        onOrder={() => router.push("/menu")}
      />

      <div className="dchapter"><span className="dchn">The Route</span><span className="dchw">this week</span></div>
      <div className="dchrule" />
      {rows.map((r) => (
        <div
          key={r.name}
          className={`stop${r.live ? " now" : ""}`}
          aria-label={`${r.name}, ${r.live ? "live now — pre-order" : "upcoming — save reminder"}`}
          {...clickable(() => (r.live ? router.push("/menu") : toast("Saved — we'll remind you")))}
        >
          <div className="when"><b>{r.when}</b><span>{r.time}</span></div>
          <div className="info"><b>{r.name}</b><span>{r.desc}</span></div>
          {r.live && <div className="tag live">Live</div>}
          <span className="stop-caret" aria-hidden="true">›</span>
        </div>
      ))}

      <div className="dchapter"><span className="dchn">The Circuit</span><span className="dchw">tap a stop for directions</span></div>
      <div className="dchrule" />
      <RouteMap points={DEMO_POINTS} />
    </section>
  );
}

export default function TruckScreen() {
  const { enabled } = useAuth();
  return enabled ? <TruckLive /> : <TruckDemo />;
}
