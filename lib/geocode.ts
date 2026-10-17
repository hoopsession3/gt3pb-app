// Address → coordinates via OpenStreetMap Nominatim (free, no key). Used by the
// operator to set a stop's exact spot so customer directions are accurate.
// Low-volume admin use only; nominatim is allow-listed in the CSP connect-src.
import { withDeadline } from "./deadline";

// A deadline (R20 — the 10/10 audit, API F3): the browser's own timer (lib/deadline — iOS 15 has no AbortSignal.timeout),
// so a lookup with no answer is said, never a spinner in the stop's sheet.
const lookup = withDeadline(10_000);

export type GeoHit = { lat: number; lng: number; label: string };

/** An address looked up: the spot — or why not, in two words a screen can say apart (the R20 review): no such place
 *  ("not-found"), or the lookup didn't answer, refused, or timed out ("unreachable") — never a bad address for a dropped
 *  signal. */
export async function lookUpAddress(address: string): Promise<{ hit: GeoHit } | { miss: "not-found" | "unreachable" }> {
  let data: unknown;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const res = await lookup(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return { miss: "unreachable" };
    data = await res.json();
  } catch {
    return { miss: "unreachable" };
  }
  const hit = Array.isArray(data) ? (data[0] as { lat?: unknown; lon?: unknown; display_name?: unknown } | undefined) : undefined;
  const lat = parseFloat(String(hit?.lat)), lng = parseFloat(String(hit?.lon));
  if (!hit || !Number.isFinite(lat) || !Number.isFinite(lng)) return { miss: "not-found" };
  return { hit: { lat, lng, label: String(hit.display_name ?? "") } };
}

/** The spot, or null either way — for a save that goes ahead without coordinates when there are none. */
export async function geocode(address: string): Promise<GeoHit | null> {
  const r = await lookUpAddress(address);
  return "hit" in r ? r.hit : null;
}
