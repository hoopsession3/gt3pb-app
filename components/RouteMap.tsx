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

export interface TruckPos {
  lat: number;
  lng: number;
}

// Static orientation map + one-tap navigation. Interaction (pan/zoom) is OFF so it
// never traps page scroll on mobile; tapping a pin opens native directions, and the
// "Directions" button routes to the live (or next) stop. When the truck is broadcasting
// its position, a live dot rides on top and moves in place (no rebuild, no flicker).
export default function RouteMap({ points, truck }: { points: RoutePoint[]; truck?: TruckPos | null }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const truckRef = useRef<import("leaflet").CircleMarker | null>(null);
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

      // Interactive: pinch/drag/zoom + zoom buttons so it's actually usable. Page-
      // scroll wheel is left OFF so a desktop scroll doesn't get trapped by the map.
      map = L.map(elRef.current, {
        dragging: true,
        scrollWheelZoom: false,
        touchZoom: true,
        doubleClickZoom: true,
        boxZoom: false,
        keyboard: false,
        zoomControl: true,
        attributionControl: false,
      });
      mapRef.current = map;
      // Dark tiles WITH street/place labels — you can actually read where each stop is.
      // Brand red/gold markers still carry the live/route meaning on top.
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        subdomains: "abcd",
      }).addTo(map);

      L.polyline([...latlngs, latlngs[0]], {
        color: "#cda84b",
        weight: 1.5,
        opacity: 0.45,
        dashArray: "1 7",
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
          marker.bindTooltip(p.name, { permanent: true, direction: "top", offset: [0, -8], className: "rm-tip rm-tip-live" });
        }
        marker.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          openDirections(p.lat, p.lng);
        });
      });

      // Frame the route, but cap zoom so a single/clustered stop still shows street
      // context instead of a blank max-zoom tile. If one stop is live, lean into it.
      const fitOpts = { paddingTopLeft: [40, 44] as [number, number], paddingBottomRight: [40, 30] as [number, number], maxZoom: 14 };
      const liveP = points.find((p) => p.live);
      if (liveP && points.length > 1) {
        map.setView([liveP.lat, liveP.lng], 13);
      } else {
        map.fitBounds(latlngs, fitOpts);
      }
      // The container can settle a frame after init inside the scroll view — recompute
      // size so tiles fill it (classic Leaflet "gray map" fix) and re-frame once.
      requestAnimationFrame(() => {
        if (cancelled || !mapRef.current) return;
        mapRef.current.invalidateSize();
        if (liveP && points.length > 1) mapRef.current.setView([liveP.lat, liveP.lng], 13);
        else mapRef.current.fitBounds(latlngs, fitOpts);
      });
    })();

    return () => {
      cancelled = true;
      truckRef.current = null;
      mapRef.current = null;
      map?.remove();
    };
  }, [points]);

  // Live truck dot: created / moved / removed independently of the base map, so a
  // realtime position update is a single setLatLng() — no flicker, no lost framing.
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
          radius: 7, color: "#F5F1E8", weight: 3, fillColor: "#B82420", fillOpacity: 1, className: "rm-truck",
        })
          .addTo(map)
          .bindTooltip("Truck · here now", { permanent: true, direction: "right", offset: [9, 0], className: "rm-tip rm-tip-live" });
      }
    })();
    return () => { cancelled = true; };
  }, [truck]);

  return (
    <div className="routemap-wrap">
      <div className="routemap" ref={elRef} role="group" aria-label="Truck route map across the upstate" />
      {target && (
        <button className="rm-go" onClick={() => openDirections(target.lat, target.lng)} aria-label={`Directions to ${target.name}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z" /></svg>
          Directions
        </button>
      )}
    </div>
  );
}
