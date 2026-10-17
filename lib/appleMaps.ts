import { createHash, createPrivateKey, sign } from "node:crypto";
import { b64url, es256Jwt, pem } from "./appleKey";
import { limitAddress } from "./rateLimit";

// APPLE MAPS, FROM THE SERVER (2026-10-10, Ryan: "When someone types in their address, it goes out and finds it.
// Prepopulate. Is that any security risk?"). The address fields suggest real addresses as they are typed, and a pick
// fills the street, city, state and ZIP. The suggestions are Apple's (the Maps Server API: searchAutocomplete, then the
// one search a pick's completionUrl names), asked from here and never from the phone, so:
//   · the key never leaves the server. APPLE_MAPS_KEY_ID, APPLE_MAPS_TEAM_ID and APPLE_MAPS_PRIVATE_KEY (a Maps key's
//     .p8, made in the Apple Developer account) sign a token here; Apple trades it for a 30-minute access token,
//     kept in this instance until it is nearly spent. With none of the three set the fields are plain fields.
//   · a pick can only ever be Apple's own search path on Apple's own host (isCompletion): what the browser hands back
//     is a path checked against one pattern, appended to one fixed origin — never a URL of its own.
//   · nothing typed is stored or logged. Apple gives a team 25,000 calls a day and refuses (429) past them rather
//     than charging; app/api/address keeps each caller and the whole app well under that.
const API = "https://maps-api.apple.com";

export type Suggestion = { line1: string; line2: string; pick: string };
export type Address = { street: string; city: string; state: string; zip: string; formatted: string };

export function mapsConfigured(): boolean {
  return Boolean(process.env.APPLE_MAPS_KEY_ID && process.env.APPLE_MAPS_TEAM_ID && process.env.APPLE_MAPS_PRIVATE_KEY);
}

// The key's text becomes a key in lib/appleKey (pem), which the Sign in with Apple key shares.
function authToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return es256Jwt({ kid: process.env.APPLE_MAPS_KEY_ID, typ: "JWT" }, { iss: process.env.APPLE_MAPS_TEAM_ID, iat: now, exp: now + 1800 }, process.env.APPLE_MAPS_PRIVATE_KEY ?? "");
}

let held: { token: string; until: number } | null = null;
async function accessToken(): Promise<string> {
  if (held && held.until > Date.now() + 60_000) return held.token;
  const r = await fetch(`${API}/v1/token`, { headers: { authorization: `Bearer ${authToken()}` }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Apple Maps token: HTTP ${r.status}`);
  const j = (await r.json()) as { accessToken?: string; expiresInSeconds?: number };
  if (!j.accessToken) throw new Error("Apple Maps token: none came back");
  held = { token: j.accessToken, until: Date.now() + (j.expiresInSeconds ?? 1800) * 1000 };
  return held.token;
}

async function maps(path: string): Promise<unknown> {
  const r = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(8000) });
  if (r.status === 401) held = null;
  if (!r.ok) throw new Error(`Apple Maps: HTTP ${r.status}`);
  return r.json();
}

/** A pick is Apple's own search path and nothing else: "/v1/search?…", one line, no fragment, bounded. */
export function isCompletion(u: string): boolean {
  return /^\/v1\/search\?[^\s#]{1,1500}$/.test(u);
}

// Where GT3 delivers and pours — the Carolinas and Georgia (lib/markets: Greenville, Atlanta), as Apple's region hint:
// north latitude, east longitude, south latitude, west longitude. A hint, not a fence: an address typed out in full
// anywhere in the US still comes back (the shop ships nationwide), but "600 E 4th St Char" offers Charlotte before
// Saint Charles, Arkansas (2026-10-10, the first live query).
const REGION = "36.6,-75.4,30.3,-85.7";

/** Up to four US street addresses for what has been typed so far, those near GT3 first. */
export async function suggest(q: string): Promise<Suggestion[]> {
  const p = new URLSearchParams({ q, resultTypeFilter: "Address", limitToCountries: "US", lang: "en-US", searchRegion: REGION });
  const j = (await maps(`/v1/searchAutocomplete?${p}`)) as { results?: { displayLines?: string[]; completionUrl?: string }[] };
  return (j.results ?? [])
    .filter((x) => typeof x.completionUrl === "string" && isCompletion(x.completionUrl) && x.displayLines?.[0])
    .slice(0, 4)
    .map((x) => ({ line1: String(x.displayLines![0]).slice(0, 120), line2: String(x.displayLines![1] ?? "").slice(0, 120), pick: x.completionUrl! }));
}

/** The address a pick names, in the form's own fields. */
export async function resolve(pick: string): Promise<Address | null> {
  if (!isCompletion(pick)) return null;
  const j = (await maps(pick)) as { results?: { formattedAddressLines?: string[]; structuredAddress?: Record<string, string | undefined> }[] };
  const r = j.results?.[0];
  const a = r?.structuredAddress;
  if (!r || !a) return null;
  const street = a.fullThoroughfare || [a.subThoroughfare, a.thoroughfare].filter(Boolean).join(" ") || r.formattedAddressLines?.[0] || "";
  return {
    street: street.slice(0, 120),
    city: (a.locality ?? "").slice(0, 60),
    state: /^[A-Za-z]{2}$/.test(a.administrativeAreaCode ?? "") ? a.administrativeAreaCode!.toUpperCase() : "",
    zip: /^\d{5}/.test(a.postCode ?? "") ? a.postCode!.slice(0, 5) : "",
    formatted: (r.formattedAddressLines ?? []).join(", ").slice(0, 200),
  };
}

// A PICTURE OF THE PLACE (2026-10-10, Find Us 10: Ryan, "Feel free to propose a redesign"). Apple's Maps Web
// Snapshots draw one point as an image — the same Maps key, the request's path and query signed with it (ES256). The
// snapshot is asked from here and its bytes passed on (app/api/map), so neither the signature nor the key's ids reach a
// browser. Apple does not say in one place which form of the ES256 signature it reads, so both forms are offered, the
// JWS form (r‖s, as the token above is signed) first; the first answer that is an image wins, for this instance.
const SNAPSHOT = "https://snapshot.apple-mapkit.com";
let sigForm: "ieee-p1363" | "der" | null = null;

/** A map of one point, Apple's muted style, as image bytes, or null. With pin "apple" Apple draws GT3's red pin with its
 *  3 on the point; with "none" the place alone, centred on the point, for the page to set the truck's photo on (Find Us). */
export async function snapshot(o: { lat: number; lng: number; scheme: "dark" | "light"; pin: "apple" | "none" }): Promise<{ body: ArrayBuffer; type: string } | null> {
  if (!mapsConfigured()) return null;
  const at = `${o.lat.toFixed(6)},${o.lng.toFixed(6)}`;
  const p = new URLSearchParams({
    center: at, z: "15", size: "600x300", scale: "2", t: "mutedStandard", colorScheme: o.scheme, poi: "0", lang: "en-US",
    ...(o.pin === "apple" ? { annotations: JSON.stringify([{ point: at, color: "B82420", glyphText: "3", markerStyle: "balloon" }]) } : {}),
    teamId: process.env.APPLE_MAPS_TEAM_ID ?? "", keyId: process.env.APPLE_MAPS_KEY_ID ?? "",
  });
  const path = `/api/v1/snapshot?${p.toString()}`;
  const key = createPrivateKey(pem(process.env.APPLE_MAPS_PRIVATE_KEY ?? ""));
  for (const form of sigForm ? [sigForm] : (["ieee-p1363", "der"] as const)) {
    const signature = b64url(sign("sha256", Buffer.from(path), { key, dsaEncoding: form }));
    const r = await fetch(`${SNAPSHOT}${path}&signature=${signature}`, { signal: AbortSignal.timeout(8000) });
    const type = r.headers.get("content-type") ?? "";
    if (r.ok && type.startsWith("image/")) { sigForm = form; return { body: await r.arrayBuffer(), type }; }
  }
  return null;
}

/** Where a street is — Apple's geocoder, its first answer — or null. For a stop saved without a pin (lib/maps mapStreet). */
export async function placeOf(street: string): Promise<{ lat: number; lng: number } | null> {
  const p = new URLSearchParams({ q: street, limitToCountries: "US", lang: "en-US" });
  const j = (await maps(`/v1/geocode?${p}`)) as { results?: { coordinate?: { latitude?: number; longitude?: number } }[] };
  const c = j.results?.[0]?.coordinate;
  const lat = Number(c?.latitude), lng = Number(c?.longitude);
  return c && c.latitude != null && c.longitude != null && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** A caller, for the limiter, without keeping their address: a short one-way hash of it — an IPv6 caller's /64, as every
 *  limit counts it (lib/rateLimit's limitAddress, R18 review). */
export function callerKey(req: Request): string {
  const ip = limitAddress((req.headers.get("x-forwarded-for") ?? "").split(",")[0]) || req.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`gt3-address:${ip}`).digest("hex").slice(0, 16);
}
