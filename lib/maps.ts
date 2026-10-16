import { stateCode } from "./usAddress";
import { isIPhoneLike } from "./ios";

// Open native turn-by-turn directions to a coordinate. The universal Google Maps
// "dir" URL hands off to the Maps app on Android (or the web) and works
// cross-platform without an API key.
//
// APPLE'S MAP ON AN IPHONE (2026-10-15, R7 of the customer re-audit). Every link went to Google — an iPhone without
// Google Maps got Google's website, in Safari or the app's browser sheet, with the stop under it. On an iPhone or iPad the
// directions are Apple Maps' (maps.apple.com hands off to the Maps app; lib/nativeLinks lets the app hand it over too);
// everywhere else, Google's, as before. Asked when tapped, never while drawing, so a page drawn on the server agrees.
export function directionsUrl(to: string | { lat: number; lng: number }, apple: boolean = isIPhoneLike()): string {
  const dest = typeof to === "string" ? encodeURIComponent(to) : `${to.lat},${to.lng}`;
  return apple
    ? `https://maps.apple.com/?daddr=${dest}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${dest}${typeof to === "string" ? "&travelmode=driving" : ""}`;
}

export function openDirections(lat: number, lng: number) {
  if (typeof window !== "undefined") {
    window.open(directionsUrl({ lat, lng }), "_blank", "noopener,noreferrer");
  }
}

// Navigate to a plain address (no coords needed) — hands off to the Maps app. The street is what to send, when there is
// one: a place name ("WineXpress") is the map's guess, the street its door (R7).
export function openAddress(address: string) {
  if (typeof window !== "undefined") {
    window.open(directionsUrl(address), "_blank", "noopener,noreferrer");
  }
}

/** A stop's directions, the same from every screen (R7b): its pin when it has one — Find Us went there while Today and the
 *  order's page sent people to Maps' guess at its name — else its street, else its place. */
export function openStop(s: { lat?: number | null; lng?: number | null; to?: string | null }) {
  if (typeof s.lat === "number" && typeof s.lng === "number" && Number.isFinite(s.lat) && Number.isFinite(s.lng)) openDirections(s.lat, s.lng);
  else if (s.to) openAddress(s.to);
}

/** Where a map should take someone: the street first, then the place name — the opposite of how a stop is said. */
export function directionsTo(row: { address?: string | null; location_text?: string | null }): string | null {
  return row.address?.trim() || row.location_text?.trim() || null;
}

// A STREET, NOT A PLACE NAME (2026-10-12). A stop saved without a pin still gets Find Us's map: Saturday's WineXpress
// was saved with its street in location_text and no lat/lng, so the page drew no map at all. The map route (app/api/map)
// asks Apple where that street is, but only for a whole US street address — a number and a street, a town, a state, a
// ZIP if it has one ("202 Scuffletown Rd, Simpsonville, SC 29681") — where Apple's answer is the door; never a place
// name ("Falls Park, Greenville, SC"), where it would be a guess. The page asks this too, so it draws a card only where
// the route will answer. The address column first, as the route reads it.
const STREET = /^(\d+[A-Za-z]?\s+[^,]+),\s*([^,]+),\s*([A-Za-z. ]+?)(?:\s+\d{5}(?:-\d{4})?)?$/;
export function mapStreet(row: { address?: string | null; location_text?: string | null }): string | null {
  for (const t of [row.address, row.location_text]) {
    const s = (t ?? "").trim().replace(/\s+/g, " ");
    const m = s.length <= 200 ? STREET.exec(s) : null;
    if (m && stateCode(m[3])) return s;
  }
  return null;
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
