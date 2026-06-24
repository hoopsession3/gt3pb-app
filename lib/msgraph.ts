// Server-only Microsoft Graph client for Outlook calendar two-way sync. Holds the OAuth dance
// (authorize → code → tokens → refresh) and thin calendar helpers. Credentials are host secrets;
// never import this into client code. Degrades to "not configured" until the env is set.
/* eslint-disable @typescript-eslint/no-explicit-any */

const TENANT = process.env.MS_TENANT_ID || "common";
const SCOPES = "offline_access openid email profile User.Read Calendars.ReadWrite";

export function outlookConfigured(): boolean {
  return !!(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

// The redirect URI must match between authorize and token exchange. Derive from the request origin
// (works across preview/prod) unless explicitly pinned via env.
export function redirectUri(origin: string): string {
  return process.env.MS_REDIRECT_URI || `${origin}/api/outlook/callback`;
}

export function authUrl(origin: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri(origin),
    response_mode: "query",
    scope: SCOPES,
    state,
  });
  return `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?${p}`;
}

type TokenSet = { access_token: string; refresh_token?: string; expires_in: number };

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.MS_CLIENT_ID!, client_secret: process.env.MS_CLIENT_SECRET!, ...body }),
  });
  if (!res.ok) throw new Error(`MS token ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export function exchangeCode(origin: string, code: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(origin), scope: SCOPES });
}

export function refresh(refreshToken: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, scope: SCOPES });
}

export async function graph(token: string, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Graph ${res.status}: ${JSON.stringify(data)?.slice(0, 300)}`);
  return data;
}

// ── calendar mapping helpers ──
// Our events store a date (events.day) and optional free-text start/end times. For sync fidelity we
// push all-day events (date-only), which is robust and timezone-safe for a market schedule.
export function eventToGraph(e: { title: string | null; day: string | null; day_label?: string | null; location_text?: string | null; blurb?: string | null }) {
  const start = e.day || new Date().toISOString().slice(0, 10);
  const endDate = new Date(`${start}T00:00:00`); endDate.setDate(endDate.getDate() + 1); // all-day end is exclusive
  const end = endDate.toISOString().slice(0, 10);
  return {
    subject: e.title || e.day_label || "GT3 event",
    isAllDay: true,
    start: { dateTime: `${start}T00:00:00`, timeZone: "UTC" },
    end: { dateTime: `${end}T00:00:00`, timeZone: "UTC" },
    location: e.location_text ? { displayName: e.location_text } : undefined,
    body: e.blurb ? { contentType: "text", content: e.blurb } : undefined,
    categories: ["GT3"],
  };
}

// Pull: turn a Graph event into our event shape. dateOnly from the start.
export function graphToEvent(g: any): { title: string; day: string | null; location_text: string | null; outlook_event_id: string } {
  const startRaw = g?.start?.dateTime || g?.start?.date || null;
  const day = startRaw ? String(startRaw).slice(0, 10) : null;
  return {
    title: g?.subject || "Outlook event",
    day,
    location_text: g?.location?.displayName || null,
    outlook_event_id: g?.id,
  };
}
