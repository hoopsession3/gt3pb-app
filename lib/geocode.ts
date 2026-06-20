// Address → coordinates via OpenStreetMap Nominatim (free, no key). Used by the
// operator to set a stop's exact spot so customer directions are accurate.
// Low-volume admin use only; nominatim is allow-listed in the CSP connect-src.
export async function geocode(address: string): Promise<{ lat: number; lng: number; label: string } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await res.json();
    const hit = Array.isArray(data) ? data[0] : null;
    if (!hit) return null;
    return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), label: hit.display_name as string };
  } catch {
    return null;
  }
}
