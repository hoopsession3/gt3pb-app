// Open native turn-by-turn directions to a coordinate. The universal Google Maps
// "dir" URL hands off to the Maps app on iOS/Android (or the web) and works
// cross-platform without an API key.
export function directionsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export function openDirections(lat: number, lng: number) {
  if (typeof window !== "undefined") {
    window.open(directionsUrl(lat, lng), "_blank", "noopener,noreferrer");
  }
}

// Navigate to a plain address (no coords needed) — hands off to the Maps app.
export function openAddress(address: string) {
  if (typeof window !== "undefined") {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`, "_blank", "noopener,noreferrer");
  }
}

// One tap → the WHOLE run in the native Maps app, in order, as multi-stop driving directions.
export function fullRouteUrl(stops: { lat?: number | null; lng?: number | null; address: string }[]): string {
  if (!stops.length) return "";
  const pt = (s: { lat?: number | null; lng?: number | null; address: string }) =>
    (s.lat != null && s.lng != null) ? `${s.lat},${s.lng}` : encodeURIComponent(s.address);
  const dest = pt(stops[stops.length - 1]);
  const waypoints = stops.slice(0, -1).map(pt).join("|");
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}${waypoints ? `&waypoints=${waypoints}` : ""}&travelmode=driving`;
}

// Geocode an address → { lat, lng } via OpenStreetMap Nominatim (allowed in CSP connect-src).
// Cached in localStorage forever (addresses don't move), and negative results are cached too so a
// bad address isn't retried every load. Respect Nominatim's 1 req/sec policy at the call site.
export async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  if (typeof window === "undefined" || !address.trim()) return null;
  const key = "gt3geo:" + address.toLowerCase().replace(/\s+/g, " ").trim();
  try {
    const cached = localStorage.getItem(key);
    if (cached !== null) { const p = JSON.parse(cached); return p && typeof p.lat === "number" ? p : null; }
  } catch { /* ignore */ }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(address)}`, { headers: { Accept: "application/json" } });
    const j = await r.json();
    const hit = Array.isArray(j) && j[0] ? { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) } : null;
    try { localStorage.setItem(key, JSON.stringify(hit)); } catch { /* quota */ }
    return hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng) ? hit : null;
  } catch { return null; }
}
