"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { openDirections } from "@/lib/maps";

export interface RoutePoint {
  name: string;
  lat: number;
  lng: number;
  live?: boolean;
}

// Static orientation map + one-tap navigation. Interaction (pan/zoom) is OFF so it
// never traps page scroll on mobile; tapping a pin opens native directions, and the
// "Directions" button routes to the live (or next) stop.
export default function RouteMap({ points }: { points: RoutePoint[] }) {
  const elRef = useRef<HTMLDivElement>(null);
  const target = points.find((p) => p.live) ?? points[0];

  useEffect(() => {
    if (!elRef.current || points.length === 0) return;
    let map: import("leaflet").Map | undefined;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !elRef.current) return;

      // Order stops by angle around their centroid → a clean loop (no crossings).
      const cx = points.reduce((s, p) => s + p.lng, 0) / points.length;
      const cy = points.reduce((s, p) => s + p.lat, 0) / points.length;
      const ordered = [...points].sort(
        (a, b) => Math.atan2(a.lat - cy, a.lng - cx) - Math.atan2(b.lat - cy, b.lng - cx)
      );
      const latlngs = ordered.map((p) => [p.lat, p.lng] as [number, number]);

      // Fully static: no dragging/zoom so the map can't hijack a scroll gesture.
      map = L.map(elRef.current, {
        dragging: false,
        scrollWheelZoom: false,
        touchZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        zoomControl: false,
        attributionControl: false,
      });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        subdomains: "abcd",
      }).addTo(map);

      L.polyline([...latlngs, latlngs[0]], {
        color: "#B82420",
        weight: 3,
        opacity: 0.8,
        dashArray: "2 8",
        lineCap: "round",
        interactive: false,
      }).addTo(map);

      ordered.forEach((p) => {
        const marker = L.circleMarker([p.lat, p.lng], {
          radius: p.live ? 9 : 7,
          color: p.live ? "#B82420" : "#cda84b",
          weight: 2,
          fillColor: p.live ? "#B82420" : "#2c2a22",
          fillOpacity: 1,
          className: "rm-pin",
        }).addTo(map!);
        // Only the live stop is labelled — labelling every close-together stop just
        // produces overlap on a phone. The list below names the rest.
        if (p.live) {
          marker.bindTooltip(`${p.name} · LIVE`, { permanent: true, direction: "top", offset: [0, -8], className: "rm-tip rm-tip-live" });
        }
        marker.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          openDirections(p.lat, p.lng);
        });
      });

      map.fitBounds(latlngs, { paddingTopLeft: [46, 34], paddingBottomRight: [46, 26] });
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [points]);

  return (
    <div className="routemap-wrap">
      <div className="routemap" ref={elRef} role="img" aria-label="Truck route map across the upstate" />
      {target && (
        <button className="rm-go" onClick={() => openDirections(target.lat, target.lng)} aria-label={`Directions to ${target.name}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z" /></svg>
          Directions
        </button>
      )}
    </div>
  );
}
