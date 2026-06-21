"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

export interface RoutePoint {
  name: string;
  lat: number;
  lng: number;
  live?: boolean;
}

export interface TruckPos {
  lat: number;
  lng: number;
}

// Lightweight Leaflet map (dark CartoDB tiles, no API key) showing the truck's stops
// connected into a non-self-intersecting loop — the "strategic circle" route — plus a
// live truck marker that moves in place (the map is NOT rebuilt when the truck moves).
export default function RouteMap({ points, truck }: { points: RoutePoint[]; truck?: TruckPos | null }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const truckRef = useRef<import("leaflet").CircleMarker | null>(null);

  // Build the base map + route + stop markers. Re-runs only when the stops change
  // (the parent memoizes `points`), so realtime truck moves don't tear this down.
  useEffect(() => {
    if (!elRef.current || points.length === 0) return;
    let map: import("leaflet").Map | undefined;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !elRef.current) return;

      // Order the stops by angle around their centroid → a clean loop (no crossings).
      const cx = points.reduce((s, p) => s + p.lng, 0) / points.length;
      const cy = points.reduce((s, p) => s + p.lat, 0) / points.length;
      const ordered = [...points].sort(
        (a, b) => Math.atan2(a.lat - cy, a.lng - cx) - Math.atan2(b.lat - cy, b.lng - cx)
      );
      const latlngs = ordered.map((p) => [p.lat, p.lng] as [number, number]);

      map = L.map(elRef.current, { scrollWheelZoom: false, attributionControl: false });
      mapRef.current = map;
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        subdomains: "abcd",
      }).addTo(map);

      L.polyline([...latlngs, latlngs[0]], {
        color: "#B82420",
        weight: 3,
        opacity: 0.9,
        dashArray: "2 8",
        lineCap: "round",
      }).addTo(map);

      // Stagger labels above/below alternately so neighbouring stops don't overlap;
      // centered (top/bottom) keeps them inside the map rather than clipping at the edges.
      ordered.forEach((p, i) => {
        const dir = i % 2 === 0 ? "top" : "bottom";
        L.circleMarker([p.lat, p.lng], {
          radius: p.live ? 8 : 6,
          color: p.live ? "#B82420" : "#cda84b",
          weight: 2,
          fillColor: p.live ? "#B82420" : "#2c2a22",
          fillOpacity: 1,
        })
          .addTo(map!)
          .bindTooltip(p.live ? `${p.name} · LIVE` : p.name, {
            permanent: true,
            direction: dir,
            offset: dir === "top" ? [0, -7] : [0, 7],
            className: `rm-tip${p.live ? " rm-tip-live" : ""}`,
          });
      });

      // Extra horizontal padding so the left/right stop labels aren't clipped at the edges.
      map.fitBounds(latlngs, { paddingTopLeft: [78, 40], paddingBottomRight: [78, 28] });
    })();

    return () => {
      cancelled = true;
      truckRef.current = null;
      mapRef.current = null;
      map?.remove();
    };
  }, [points]);

  // Live truck marker: created/moved/removed independently of the base map so a position
  // update is a single setLatLng() — no flicker, no lost zoom/pan.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = mapRef.current;
      if (!map) return;
      const L = (await import("leaflet")).default;
      if (cancelled) return;

      if (!truck) {
        if (truckRef.current) { truckRef.current.remove(); truckRef.current = null; }
        return;
      }
      if (truckRef.current) {
        truckRef.current.setLatLng([truck.lat, truck.lng]);
      } else {
        truckRef.current = L.circleMarker([truck.lat, truck.lng], {
          radius: 7,
          color: "#F5F1E8",
          weight: 3,
          fillColor: "#B82420",
          fillOpacity: 1,
        })
          .addTo(map)
          .bindTooltip("Truck · here now", {
            permanent: true,
            direction: "right",
            offset: [9, 0],
            className: "rm-tip rm-tip-live",
          });
      }
    })();
    return () => { cancelled = true; };
  }, [truck]);

  return <div className="routemap" ref={elRef} role="img" aria-label="Truck route map across the upstate" />;
}
