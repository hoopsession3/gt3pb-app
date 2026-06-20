"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

export interface RoutePoint {
  name: string;
  lat: number;
  lng: number;
  live?: boolean;
}

// Lightweight Leaflet map (dark CartoDB tiles, no API key) showing the truck's stops
// connected into a non-self-intersecting loop — the "strategic circle" route.
export default function RouteMap({ points }: { points: RoutePoint[] }) {
  const elRef = useRef<HTMLDivElement>(null);

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

      ordered.forEach((p) => {
        // Direction by side of the centroid so labels fan outward and overlap less.
        const dir = p.lng < cx ? "left" : "right";
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
            offset: dir === "left" ? [-8, 0] : [8, 0],
            className: `rm-tip${p.live ? " rm-tip-live" : ""}`,
          });
      });

      map.fitBounds(latlngs, { padding: [34, 34] });
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [points]);

  return <div className="routemap" ref={elRef} role="img" aria-label="Truck route map across the upstate" />;
}
