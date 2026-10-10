import { createHash, createPrivateKey, sign } from "node:crypto";

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

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

// The .p8's text, however it was pasted into Vercel: literal \n, lost line breaks, a dropped BEGIN or END line — the
// key is rebuilt from its own base64, the way the TestFlight job rebuilds the App Store Connect key.
function pem(text: string): string {
  const body = text.replace(/\\n/g, "\n").replace(/-----(BEGIN|END)[A-Z ]*-----/g, "").replace(/[^A-Za-z0-9+/=]/g, "");
  return `-----BEGIN PRIVATE KEY-----\n${(body.match(/.{1,64}/g) ?? []).join("\n")}\n-----END PRIVATE KEY-----\n`;
}

function authToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: process.env.APPLE_MAPS_KEY_ID, typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: process.env.APPLE_MAPS_TEAM_ID, iat: now, exp: now + 1800 }));
  const key = createPrivateKey(pem(process.env.APPLE_MAPS_PRIVATE_KEY ?? ""));
  return `${head}.${body}.${b64url(sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" }))}`;
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

/** Up to four US street addresses for what has been typed so far. */
export async function suggest(q: string): Promise<Suggestion[]> {
  const p = new URLSearchParams({ q, resultTypeFilter: "Address", limitToCountries: "US", lang: "en-US" });
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

/** A caller, for the limiter, without keeping their address: a short one-way hash of it. */
export function callerKey(req: Request): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`gt3-address:${ip}`).digest("hex").slice(0, 16);
}
