// Supabase Edge Function - sends Web Push (browsers) and APNs (the iPhone app) on order / subscription / booking changes.
// Triggered by Database Webhooks (orders INSERT/UPDATE, subscriptions UPDATE, booking_requests
// INSERT, alerts INSERT, event_tasks UPDATE, profiles INSERT, delivery_orders INSERT,
// drop_orders INSERT, live_status UPDATE — the customer go-live ping, 0257; cup_reminders and pack_notices UPDATE — 0394,
// 0399), and by an alerts UPDATE when a
// critical nobody picked up is escalated (0373's alerts_push_escalation trigger, through the same door as 0157's).
// Secrets: VAPID_PUBLIC, VAPID_PRIVATE. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected.
// The iPhone app (2026-10-11): APNS_PRIVATE_KEY, the .p8's text of the Apple Developer key "GT3 Push Notifications"
// (APNs, Production, team-scoped) — a secret, set in the dashboard. Its Key ID (HQ7722ND83) and the team (7SC4HB6V2J)
// are not secrets — Apple reads both off every token's header — so they are written here, and APNS_KEY_ID /
// APNS_TEAM_ID override them if a key is ever replaced. Without the private key an 'apns' row is skipped, never an error.
// Deploy: TWO FILES since 2026-10-11 — this one and ./policy.ts beside it (what a severity sends, what a lock screen
// may show). Supabase dashboard -> Edge Functions -> "push" -> paste index.ts AND add policy.ts -> deploy; or
// `supabase functions deploy push`, which takes the folder. Deploy it BEFORE pasting 0373 and 0374 — and 0383
// (2026-10-12: a muted category and quiet hours hold a non-critical alert's push; an escalation asks for the claim).
// Pinned to exact versions (R21, 2026-10-18 — the 10/10 audit, operations F12): "@2" was whatever 2.x npm had on the day
// it was deployed. supabase-js is the version the app runs (package-lock.json) — scripts/functions.check.mjs holds the
// two together, and type-checks this file and ./policy.ts against it; scripts/push.function.test.mjs runs this file.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import {
  alertOutside, alertShown, bookingOutside, channelsFor, escalationShown, eventKey, freshRow, isEscalation, liveShown, mayEmail, newOrderShown, orderStatusShown,
  orderVoidShown, packNoticeShown, packNoticeTold, reminderShown, severityOf, sitePath, stillUnanswered, stopCanceledShown,
  subscriptionShown, taskOutside, taskShown, CUSTOMER_MUTE, EVENT_TABLES, LIVE_NEWS_MS, pushHostOk, SEND_AT_ONCE, smsPlain, textNumber,
  textQuiet, usTextable, whoRings, type NotifPrefsRow, type Shown,
} from "./policy.ts";

webpush.setVapidDetails(
  "mailto:hello@gt3pb.com",
  Deno.env.get("VAPID_PUBLIC")!,
  Deno.env.get("VAPID_PRIVATE")!,
);
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// WHICH BUILD OF THIS FUNCTION IS DEPLOYED (R21 — operations F12). It is deployed by hand, apart from every push to
// main, and nothing said when the deployed one lagged the repo. A GET answers this; verify:prod asks it and fails when it
// isn't this tree's. Change this file or ./policy.ts and scripts/push.function.test.mjs asks for a new one.
const PUSH_VERSION = "2026-10-18 R29";

// No call out of here waits for ever (R21, as the app's since R20): Teams, Resend, Twilio, Apple and the browsers' push
// services are each given ten seconds. One that hung held every send after it, for as long as the platform let it run.
const OUT_MS = 10_000;

// WHAT DIDN'T GO, SAID (R21 — operations F12). A Teams card refused, a mail the provider wouldn't take, Apple refusing
// our key, a read of the database that failed on the way: each went unsaid — the function answered "ok" and nobody heard.
// Each is a line in the function's log now and, when it is ours to put right, a fault the function says itself, in the
// crew's inbox (sayFaults, below — the database stops listening for this answer after a second or five, and a fault can
// take longer to find). A phone that is gone, or one device's own refusal, is not the function's fault: it is deleted,
// or logged, as before.
type Faults = string[];
// The keys this function holds. Whatever an error says, none of them is repeated (R21 review: a webhook address pasted
// without its https:// came back whole in fetch's "Invalid URL" — no address pattern would have caught it).
const KEYS = ["TEAMS_WEBHOOK_URL", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "RESEND_API_KEY", "APNS_PRIVATE_KEY", "VAPID_PRIVATE", "SUPABASE_SERVICE_ROLE_KEY"];
/** An error's own words with no key and no address in them — Teams' webhook address and Twilio's account path are keys. */
function whyOf(e: unknown): string {
  let said = String((e as { message?: unknown } | null)?.message ?? e);
  for (const name of KEYS) { const v = Deno.env.get(name); if (v && v.length >= 8) said = said.split(v).join("(a key)"); }
  return said.replace(/\bhttps?:\/\/[^\s"'<>)]+/g, "(an address)").slice(0, 160);
}
/** For a call whose address is itself a key (Teams' webhook, Twilio's account path): what kind of failure, and no words. */
const reachOf = (e: unknown) => ((e as { name?: unknown } | null)?.name === "TimeoutError" ? "no answer in ten seconds" : "could not be reached");
function fault(faults: Faults, where: string, what: string): void {
  const line = `${where}: ${what}`;
  if (!faults.includes(line)) faults.push(line);
  console.error(`[push] ${line}`);
}
const codeOf = (error: { code?: string | null } | null | undefined) => error?.code || "no code";

// ONE BUSINESS AT A TIME (2026-10-11). A row's tenant, as 0134 stamps it — the founding tenant when there is none.
// The crew's devices and the leadership a broadcast reaches are looked up in THIS tenant: they used to be every
// tenant's, so a second business's order would have rung the first's phones.
const FOUNDING = "00000000-0000-0000-0000-000000000001";
const tenantOf = (r: { tenant_id?: string | null } | null | undefined) => r?.tenant_id || FOUNDING;

// ── APNs: THE IPHONE APP'S ALERTS (2026-10-11) ──────────────────────────────────────────────────────────────────
// A phone running the app is kept as an 'apns' row (0367; endpoint 'apns:<token>'). Apple's HTTP/2 API takes a JSON
// alert per token, authorized by a short ES256 token the team's key signs (iss: the team, kid: the key). Apple asks
// that the token be reused for up to an hour and not remade more often than every twenty minutes: it is kept for forty,
// and made ONCE however many phones a send goes to — a new order goes to every crew phone at once, and each send that
// found no token used to sign its own, which Apple answers with 429 TooManyProviderTokenUpdates (2026-10-11, the
// review). A token Apple calls expired or invalid is made again on the next send. A phone Apple says is gone (410, or
// 400 BadDeviceToken) is deleted, as a dead browser endpoint is.
const APNS_TOPIC = "com.gt3pb.app";
const APNS_HOST = "https://api.push.apple.com";   // TestFlight and the App Store both use the production service
let apnsAuth: { token: string; at: number } | null = null;
let apnsSigning: Promise<string | null> | null = null;
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const text64 = (s: string) => b64url(new TextEncoder().encode(s));

async function apnsBearer(): Promise<string | null> {
  if (apnsAuth && Math.floor(Date.now() / 1000) - apnsAuth.at < 40 * 60) return apnsAuth.token;
  apnsSigning ??= signApns().finally(() => { apnsSigning = null; });
  return apnsSigning;
}

async function signApns(): Promise<string | null> {
  const keyId = Deno.env.get("APNS_KEY_ID") || "HQ7722ND83", pem = Deno.env.get("APNS_PRIVATE_KEY"), team = Deno.env.get("APNS_TEAM_ID") || "7SC4HB6V2J";
  if (!keyId || !pem) return null;
  const now = Math.floor(Date.now() / 1000);
  // A key pasted with its line breaks written out as "\n" is the same key.
  const body = pem.replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signing = `${text64(JSON.stringify({ alg: "ES256", kid: keyId }))}.${text64(JSON.stringify({ iss: team, iat: now }))}`;
  // WebCrypto's ECDSA signature is already r‖s, the form a JWT carries.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signing)));
  apnsAuth = { token: `${signing}.${b64url(sig)}`, at: now };
  return apnsAuth.token;
}

/** One alert to one app install: Apple's status and its reason, or status 0 when APNs is not set up here. An alert that
 *  could not reach the phone within the hour is dropped, not delivered late ("your order's ready" at midnight is wrong). */
async function sendApns(endpoint: string, alert: { title: string; body: string; url: string }): Promise<{ status: number; reason?: string }> {
  const bearer = await apnsBearer();
  const token = endpoint.slice("apns:".length);
  if (!bearer || !/^[0-9a-f]{32,200}$/i.test(token)) return { status: 0 };
  const r = await fetch(`${APNS_HOST}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${bearer}`, "apns-topic": APNS_TOPIC, "apns-push-type": "alert", "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600), "content-type": "application/json",
    },
    body: JSON.stringify({ aps: { alert: { title: alert.title.slice(0, 120), body: alert.body.slice(0, 900) }, sound: "default" }, url: alert.url }),
    signal: AbortSignal.timeout(OUT_MS),
  });
  if (r.status === 200) return { status: 200 };
  const reason = ((await r.json().catch(() => ({}))) as { reason?: string }).reason;
  if (r.status === 403 && (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken")) apnsAuth = null;
  // A token that is no phone of this app's is gone, as Apple's 410 is (BadDeviceToken: a development build's).
  if (r.status === 400 && reason === "BadDeviceToken") return { status: 410, reason };
  return { status: r.status, reason };
}

type Sub = { endpoint: string; p256dh: string | null; auth: string | null; platform: string | null };
type SubQuery = ReturnType<ReturnType<typeof supabase.from>["select"]>;

async function subsFor(filter: (q: SubQuery) => SubQuery, faults: Faults): Promise<Sub[]> {
  // Page by page (R9): one read stopped at the API's row cap, so the go-live ping reached the first thousand devices and
  // not the rest. Twenty pages at most — far past every subscriber this business has.
  const rows: Sub[] = [];
  for (let page = 0; page < 20; page++) {
    const { data, error } = await filter(supabase.from("push_subscriptions").select("*")).order("endpoint").range(page * 1000, page * 1000 + 999);
    // A list that couldn't be read is said (R21): what was read is sent to, and the rest is a fault, not an empty list.
    if (error) fault(faults, "devices", `the list could not be read (${codeOf(error)})`);
    if (error || !data) break;
    rows.push(...(data as Sub[]));
    if (data.length < 1000) break;
  }
  // One send per device - dedup by endpoint so a duplicated row can't double-notify.
  const seen = new Set<string>();
  return rows.filter((s) => (seen.has(s.endpoint) ? false : (seen.add(s.endpoint), true)));
}

// WHAT HAPPENED, FROM THE DATABASE (R10, 2026-10-16 — the 10/10 audit). This function is reached with the public key
// every page carries, so the body it is sent is a pointer and nothing more: the row it names is read here with the service
// role, and every push, email and text is built from that. A row the database does not have is not sent.
// A row of any of the tables below, as the database returns it — read field by field, the way the request body was before.
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function rowNow(table: string, id: unknown): Promise<Row | null> {
  if (!EVENT_TABLES.has(table) || (typeof id !== "string" && typeof id !== "number")) return null;
  const { data, error } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
  // A read that failed is not a row that isn't there (R21): the event is said lost — a 500 the database keeps, which
  // cron_watch reads — where "skip: not in the database" answered 200 and nothing went, in silence.
  if (error) throw new Error(`the ${table} row could not be read (${codeOf(error)})`);
  return (data as Row | null) ?? null;
}

// SENT ONCE (R10, 0419 push_sent): the first send of an event keeps its key; the same event told again finds it and is
// not sent twice. A key that cannot be kept for any other reason is sent all the same — a push missed is worse than one
// doubled — and since R21 it is said: push_sent is there (0419), so a write it refuses is a fault.
async function firstSend(key: string, faults: Faults): Promise<boolean> {
  const { error } = await supabase.from("push_sent").insert({ event_key: key.slice(0, 200) });
  if (!error) return true;
  if (error.code === "23505") return false;
  fault(faults, "sent once", `the event's key could not be kept (${codeOf(error)})`);
  return true;
}

// WHO AN ALERT REACHES (2026-10-11). Its own person when it has one; a broadcast, the leadership of its tenant
// (event_manager, admin, owner — 0157). An escalation (0373) is sent to those again AND to every admin and owner of
// the tenant, so a critical nobody picked up reaches the people who answer for the business, not only its lane.
async function peopleFor(a: { target_user_id?: string | null; tenant_id?: string | null }, faults: Faults, escalation = false): Promise<string[]> {
  const ids = new Set<string>();
  if (a.target_user_id) ids.add(a.target_user_id);
  const roles = new Set<string>(a.target_user_id ? [] : ["event_manager", "admin", "owner"]);
  if (escalation) { roles.add("admin"); roles.add("owner"); }
  if (roles.size) {
    const { data, error } = await supabase.from("profiles").select("id").eq("tenant_id", tenantOf(a)).in("role", [...roles]);
    if (error) fault(faults, "people", `the leadership could not be read (${codeOf(error)})`);
    for (const p of (data ?? []) as { id: string }[]) ids.add(p.id);
  }
  return [...ids];
}

// WHOSE PHONE IT RINGS NOW (2026-10-12). Each of an alert's people, asked by ./policy.ts whoRings: a category they
// muted, or their quiet hours on their market's clock, hold a non-critical alert's push to them (notif_prefs, 0177 —
// Settings › Notifications); a critical rings everyone, as before. Only the push is held: the row, its inbox line,
// Teams and the email are untouched. A FAILED READ IS NOT A MUTE: if the prefs cannot be read, everyone is pinged, as
// before this rule; if a market's zone cannot, the founding market's clock is used.
async function ringingNow(a: { severity?: unknown; category?: unknown }, ids: string[]): Promise<string[]> {
  if (!ids.length || severityOf(a.severity) === "critical") return ids;
  const [prefs, people] = await Promise.all([
    supabase.from("notif_prefs").select("user_id, muted_categories, quiet_start, quiet_end").in("user_id", ids),
    supabase.from("profiles").select("id, market").in("id", ids),
  ]);
  if (prefs.error) return ids;
  const marketOf = new Map(((people.data ?? []) as { id: string; market: string | null }[]).map((p) => [p.id, p.market ?? ""]));
  const zoneOf = new Map<string, string>();
  const markets = [...new Set([...marketOf.values()].filter(Boolean))];
  if (markets.length) {
    const { data } = await supabase.from("markets").select("slug, timezone").in("slug", markets);
    for (const m of (data ?? []) as { slug: string; timezone: string | null }[]) if (m.timezone) zoneOf.set(m.slug, m.timezone);
  }
  const prefsOf = new Map(((prefs.data ?? []) as ({ user_id: string } & NonNullable<NotifPrefsRow>)[]).map((p) => [p.user_id, p]));
  return whoRings(a, ids.map((id) => ({ id, prefs: prefsOf.get(id) ?? null, timeZone: zoneOf.get(marketOf.get(id) ?? "") })), new Date()).ring;
}

// Post an alert card to the Teams channel (skipped with no webhook, and wherever ./policy.ts says a severity does not
// post — an fyi). Never thrown out of; since R21 a card Teams didn't take is said — a fault — where it was dropped
// unread (a connector Microsoft retires answers 4xx to every card, and the crew would have gone on hearing nothing).
async function postTeams(severity: string, ttl: string, body: string, faults: Faults) {
  const teams = Deno.env.get("TEAMS_WEBHOOK_URL");
  if (!teams || !channelsFor(severity).teams) return;
  const themeColor = severityOf(severity) === "critical" ? "D2554A" : "A97C3F";
  const flag = severityOf(severity) === "critical" ? "🔴 " : "🟠 ";
  try {
    const r = await fetch(teams, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "@type": "MessageCard", "@context": "https://schema.org/extensions", themeColor, summary: ttl, title: flag + ttl, text: body || "" }),
      signal: AbortSignal.timeout(OUT_MS),
    });
    // A connector answers 200 when it took the card, a Workflows webhook 202: anything else is a card nobody saw.
    if (!r.ok) fault(faults, "teams", `HTTP ${r.status}`);
  } catch (e) { fault(faults, "teams", reachOf(e)); }   // never the error's words: its address is the webhook's key
}
// Drop a row in the in-app inbox (service role bypasses RLS — these are system-raised). Its fan-out (0157) carries
// the push and the Teams card, so a caller here sends neither itself — that made two Teams cards per booking.
async function insertAlert(a: { severity: string; category: string; title: string; body?: string; link?: string; tenant_id?: string | null }, faults: Faults) {
  const { error } = await supabase.from("alerts").insert({ severity: a.severity, category: a.category, title: a.title, body: a.body ?? null,
    link: a.link ?? "/admin", tenant_id: tenantOf(a) });
  if (error) fault(faults, "inbox", `"${a.title}" could not be written (${codeOf(error)})`);
}

// The ONE Resend send under every email here. First address on To, the rest BCC
// (2026-07-30 — Ryan: "Why can you see CC, maybe BCC?"): one visible To keeps deliverability
// happy; BCC keeps the list private and the header clean. RESEND_API_KEY / NOTIFY_FROM_EMAIL
// must be set on this function's env or this is a clean no-op — same contract as lib/notify.ts.
// "sent", "off" (that no-op), or what stopped it (R21: a refusal was a bare false, and nobody was told).
async function mail(to: string[], subject: string, body: string): Promise<string> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("NOTIFY_FROM_EMAIL");
  if (!key || !from) return "off";
  if (!to.length) return "no address to send it to";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: to.slice(0, 1), ...(to.length > 1 ? { bcc: to.slice(1) } : {}), subject: subject.slice(0, 200), text: body }),
      signal: AbortSignal.timeout(OUT_MS),
    });
    if (r.ok) return "sent";
    // Resend's own name for the refusal (validation_error, missing_api_key, rate_limit_exceeded…), never its message.
    const name = ((await r.json().catch(() => ({}))) as { name?: unknown }).name;
    return `Resend ${r.status}${typeof name === "string" && /^[a-z_]{1,40}$/.test(name) ? ` ${name}` : ""}`;
  } catch (e) { return whyOf(e); /* never fail the webhook on a mail-provider hiccup — say it */ }
}
/** A mail to whoever `to` names: true when Resend took it. What stopped one is logged. */
async function sendEmail(to: string[], subject: string, body: string): Promise<boolean> {
  const got = await mail(to, subject, body);
  if (got !== "sent" && got !== "off") console.error(`[push] email: ${got}`);
  return got === "sent";
}

// Email the owner/manager list (public.admin_emails — 0004). Push needs a subscribed device and
// Teams needs its webhook configured; email is the net under both for anything that must not
// silently go cold — so one that doesn't go is a fault (R21).
async function emailAdmins(subject: string, body: string, faults: Faults) {
  const { data: admins, error } = await supabase.from("admin_emails").select("email");
  if (error) return fault(faults, "admin email", `the list could not be read (${codeOf(error)})`);
  const got = await mail(((admins ?? []) as { email: string }[]).map((a) => a.email), subject, body);
  if (got !== "sent" && got !== "off") fault(faults, "admin email", got);
}

// Email ONE user by id (2026-07-30, Ryan: "I want to get emails on critical notes and tasks as
// well. Owners of those should get [them]"). The service role this function runs with can look
// the address up via the auth admin API. A critical must never go cold: if the owner's email
// can't be resolved, the admin list gets it instead.
async function emailUser(userId: string, subject: string, body: string, faults: Faults) {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    const em = data?.user?.email;
    if (em) {
      const got = await mail([em], subject, body);
      if (got !== "sent" && got !== "off") fault(faults, "email", got);
      return;
    }
  } catch { /* fall through to the admin list */ }
  await emailAdmins(subject, body, faults);
}

// A KIND THE MEMBER TURNED OFF (2026-10-14, R6): their Notifications screen keeps it in their notif_prefs row (0177;
// lib/customerNotify). A read that fails is a no — the news goes, as it did before the screen existed.
async function customerMuted(userId: string, key: string): Promise<boolean> {
  const { data, error } = await supabase.from("notif_prefs").select("muted_categories").eq("user_id", userId).maybeSingle();
  return !error && Array.isArray(data?.muted_categories) && data.muted_categories.includes(key);
}

// A MEMBER'S OWN NOTICE (2026-10-14, 0399): their account's email and nobody else's — no fallback to the admin list,
// which is for the crew's criticals. True when Resend took it.
async function emailMember(userId: string, subject: string, body: string): Promise<boolean> {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    const em = data?.user?.email;
    return em ? await sendEmail([em], subject, body) : false;
  } catch { return false; }
}

// A text to a member (0398, 0399): only when texts are switched on here (TEXTS_ON=1, with the Twilio number's keys —
// Ryan's, set beside Vercel's when the number is registered), to a number whose yes stands, and never at night. What
// happened is said back in lib/notify's words.
async function textMember(phone: unknown, body: string, faults: Faults): Promise<{ result: "sent" | "off" | "not-asked" | "quiet" | "no-number" | "failed"; detail?: string }> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID"), token = Deno.env.get("TWILIO_AUTH_TOKEN"), from = Deno.env.get("TWILIO_FROM_NUMBER");
  if (Deno.env.get("TEXTS_ON") !== "1" || !sid || !token || !from) return { result: "off" };
  const num = textNumber(phone);
  if (!num || !usTextable(num)) return { result: "no-number" };   // US numbers only (R9, ./policy.ts)
  const { data: yes, error } = await supabase.rpc("text_consent_standing", { p_phone: num });
  if (error || yes !== true) return { result: "not-asked" };
  if (textQuiet(new Date())) return { result: "quiet" };
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: num, From: from, Body: smsPlain(body).slice(0, 320) }),   // plain characters (R6)
      signal: AbortSignal.timeout(OUT_MS),
    });
    if (r.ok) return { result: "sent" };
    // A refusal of the number is the member's (it is written on the notice); a refusal of our keys is ours (R21).
    if (r.status === 401 || r.status === 403) fault(faults, "texts", `Twilio ${r.status} — the account's keys`);
    else console.error(`[push] text: Twilio ${r.status}`);
    return { result: "failed", detail: `Twilio ${r.status}` };
  } catch (e) {
    // Never the error's words: Twilio's path carries the account (R21 — the notice's detail is the crew's to read).
    console.error(`[push] text: ${reachOf(e)}`);
    return { result: "failed", detail: `Twilio ${reachOf(e)}` };
  }
}

// The door: a GET says which build this is (verify:prod asks it); anything else is the database telling of an event.
// Faults on the way (above) are said once everything that could go, went — by the function itself (sayFaults), and in
// its answer's words.
Deno.serve(async (req) => {
  if (req.method === "GET") return new Response(JSON.stringify({ version: PUSH_VERSION }), { headers: { "content-type": "application/json" } });
  const faults: Faults = [];
  const res = await handle(req, faults);
  if (!faults.length || res.status >= 500) return res;
  const said = `${(await res.text()).slice(0, 100)} — but ${faults.join("; ")}`.slice(0, 600);
  return new Response(said, { status: (await sayFaults(faults)) ? 200 : 502 });
});

// SAID BY THE FUNCTION ITSELF (the R21 review). The database stops waiting for this answer after a second, or five, and
// a fault can take longer to find than that (Teams hanging for its ten seconds): a 502 nobody waited for says nothing.
// So the function writes its faults where the crew reads them — one open line (alert_open_once: refreshed while it
// stands, never a second one, and once someone has said "Got it", not raised again until six hours after the last one
// was). Only when that line can't be written is the answer a 502, for cron_watch to read (0427).
async function sayFaults(faults: Faults): Promise<boolean> {
  const { error } = await supabase.rpc("alert_open_once", {
    p_kind: "push_fault", p_subject: null, p_severity: "important", p_category: "system",
    p_title: "Alerts couldn't all go out",
    p_body: `The push service couldn't do all it was asked. The last time: ${faults.join("; ")}.`.slice(0, 900),
    p_link: "/crew?s=settings&a=set-errors", p_reopen_after: "6 hours",
  });
  if (error) console.error(`[push] the fault line could not be written (${codeOf(error)})`);
  return !error;
}

async function handle(req: Request, faults: Faults): Promise<Response> {
  try {
    // A POINTER, NOT A STORY (R10): the body names a table and a row; what happened is the database's (rowNow above).
    const body = (await req.json().catch(() => null)) as { table?: unknown; type?: unknown; record?: Row | null; old_record?: Row | null } | null;
    const table = typeof body?.table === "string" ? body.table : "", type = typeof body?.type === "string" ? body.type : "";
    const named: Row | null = body?.record ?? null, old_record: Row | null = body?.old_record ?? null;
    if (!EVENT_TABLES.has(table) || !named) return new Response("skip");
    const record = await rowNow(table, named.id);
    if (!record) return new Response("skip: not in the database");
    const nowMs = Date.now();
    // Sent once (push_sent, 0419): asked where each event is known to be one, before anything goes. And news only: each
    // branch asks the row's own stamp of what happened (created, status changed, fired, sent, escalated) to be recent —
    // an old event described again is not sent, after its key is swept as before it.
    const once = async () => { const key = eventKey(table, type, record, nowMs); return key !== null && await firstSend(key, faults); };
    // What the phone shows (./policy.ts — no customer name, phone, address, email or amount, whatever the row
    // holds) and where a tap opens. The row's own words stay in the app.
    let shown: Shown | null = null, url = "/";
    let targets: Sub[] = [];
    // Something to do once the push is sent (a pack notice writes back what went).
    let after: (() => PromiseLike<{ error: { code?: string | null } | null }>) | null = null;

    if (table === "orders" && type === "INSERT") {
      if (!freshRow(record.created_at, nowMs) || !(await once())) return new Response("skip: not news, or sent already");
      shown = newOrderShown(record);
      // A tap opens the Pass itself (2026-10-11, the KDS audit): "/admin" opened the console wherever it was last left,
      // a screen or two from the ticket. &a=kitchen-pass is the console's own jump to the Pass (app/crew/page.tsx jumpTo).
      url = "/crew?s=now&a=kitchen-pass";
      targets = await subsFor((q) => q.eq("is_admin", true).eq("tenant_id", tenantOf(record)), faults);

    } else if (table === "orders" && type === "UPDATE" && record.user_id) {
      // Only fire on a real status TRANSITION - this is what stops the duplicate spam
      // when the row is rewritten with the same status (optimistic + reconcile, etc.).
      if (old_record && old_record.status === record.status) return new Response("skip: no transition");
      // The order as the database has it now: one that has moved on since (or was never so) is not said.
      if (named.status !== record.status || !freshRow(record.status_changed_at, nowMs) || !(await once())) return new Response("skip: moved on, not news, or sent already");
      shown = orderStatusShown(record);
      // Order updates turned off on the member's Notifications screen (R6): "being made" and "ready" stay quiet. A stop
      // called off is a change to the order itself, and is said whatever the switch (below).
      if (shown && await customerMuted(record.user_id, CUSTOMER_MUTE.orderUpdates)) return new Response("skip: order updates off");
      // A stop called off voids its cup orders (crew/stops/cancel): the member hears it here, with why (R3b — 0391's
      // notices, the push half). Any other void says so too, with what becomes of the money (R7, 2026-10-15): one the crew
      // made at the Pass said nothing, and the order slipped off the bar. Like a stop called off, it is a change to the
      // order itself — said whatever the order-updates switch.
      if (!shown && record.status === "void" && record.stop_id) {
        const { data: st } = await supabase.from("stops").select("name, canceled_at, cancel_reason").eq("id", record.stop_id).maybeSingle();
        if (st?.canceled_at) shown = stopCanceledShown(record, st.name ?? null, st.cancel_reason ?? null);
      }
      if (!shown && record.status === "void") shown = orderVoidShown(record);
      if (!shown) return new Response("skip");
      // A canceled order opens its own page — why, and what becomes of the money (R7b); Today has nothing to say of it.
      if (record.status === "void" && typeof record.ticket === "string" && record.ticket) url = `/order?t=${encodeURIComponent(record.ticket)}`;
      targets = await subsFor((q) => q.eq("user_id", record.user_id), faults);

    } else if (table === "subscriptions" && type === "UPDATE" && record.user_id) {
      if (old_record && old_record.status === record.status) return new Response("skip: no transition");
      if (named.status !== record.status || !freshRow(record.updated_at, nowMs) || !(await once())) return new Response("skip: moved on, not news, or sent already");
      shown = subscriptionShown(record);
      if (!shown) return new Response("skip");
      url = "/3mpire";
      targets = await subsFor((q) => q.eq("user_id", record.user_id), faults);

    } else if (table === "booking_requests" && type === "INSERT") {
      // A lead kept past the hour's ceiling (R29 — API F1, 0434: /api/book marks it quiet) is announced to nobody: a burst
      // is told to the crew once an hour, by the door that kept it, and each lead waits in Plan › Leads.
      if (record.quiet === true) return new Response("skip: quiet — part of a burst, told once");
      // No direct push targets here (2026-07-30, Ryan's screenshot: "Should I have gotten three?").
      // insertAlert below fans out to leadership via the alerts webhook — pushing directly here TOO
      // meant every booking notified twice from this function alone. One event, one push. And one Teams card
      // (2026-10-11): the fan-out posts it, so posting here as well made two.
      // Producer: a new lead → inbox + Teams + email so it's chased before it goes cold. Email is
      // the one channel here that doesn't depend on a subscribed device or a configured webhook —
      // an owner who's away from the crew app for a day still finds out a lead came in, and when.
      if (!freshRow(record.created_at, nowMs) || !(await once())) return new Response("skip: not news, or sent already");
      const message = `${record.name ?? "Someone"}${record.event_date ? " - " + record.event_date : ""}${record.location_text ? " - " + record.location_text : ""}`;
      await insertAlert({ severity: "important", category: "booking", title: "New booking lead", body: message, tenant_id: record.tenant_id }, faults);
      // The email says a lead came in, for which day, and when — who, their number, the place and their notes stay in the
      // app (R27, API F17: ./policy.ts bookingOutside). The inbox line above is the app's own, and keeps them.
      const lead = bookingOutside(record, new Date(record.created_at ?? Date.now()).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }));
      if (mayEmail("important", true)) await emailAdmins(lead.subject, lead.text, faults);
      return new Response("ok: booking");

    } else if (table === "profiles" && type === "INSERT") {
      // New sign-up (2026-07-30): an fyi in the inbox, and it asks for an email. Since 2026-10-11 an fyi gets the inbox
      // and nothing else (./policy.ts, FYI STAYS QUIET), so the rule refuses the email — no push, no Teams either. A
      // sign-up the owner wants to hear about is an 'important' one: that one word below brings back the email (asked
      // for here) with a push and a Teams card.
      if (!freshRow(record.created_at, nowMs) || !(await once())) return new Response("skip: not news, or sent already");
      const who = record.display_name?.trim() || "Someone new";
      const role = record.role && record.role !== "member" ? ` (${record.role})` : "";
      const severity: string = "fyi";
      await insertAlert({ severity, category: "system", title: "New member signed up", body: `${who}${role} just joined.`, link: "/crew?s=customers", tenant_id: record.tenant_id }, faults);
      // Their name stays in the app (R27, API F17): the email says someone joined, and where to see who.
      if (mayEmail(severity, true)) await emailAdmins("New member signed up", [
        `Someone new${role} just created an account.`,
        "",
        "Customer book: https://app.gt3pb.com/crew?s=customers",
      ].join("\n"), faults);
      return new Response("ok: signup");

    } else if (table === "delivery_orders" && type === "INSERT") {
      // New delivery order (2026-07-30): an email to the owners. The inbox line, its push and its Teams card come
      // from the route that took the order (app/api/delivery/checkout, 'important' since 2026-10-11). The alert this
      // inserted beside it carried category 'delivery', which 0232's alerts_category_canon refuses, so it had never
      // been written since — and its Teams card, posted here directly, was the only one. One event, one of each.
      if (!freshRow(record.created_at, nowMs) || !(await once())) return new Response("skip: not news, or sent already");
      const message = `${record.pack_size ?? "?"}-bottle delivery for ${record.delivery_date ?? "soon"}`;
      if (mayEmail("important", true)) await emailAdmins(`New delivery order — ${record.pack_size ?? "?"}-pack`, [
        message + ".",
        "",
        "Run sheet: https://app.gt3pb.com/crew?s=driver",
      ].join("\n"), faults);
      return new Response("ok: delivery");

    } else if (table === "drop_orders" && type === "INSERT") {
      // New reserve (2026-07-30): as deliveries — the email here; the inbox line, push and Teams card from the route
      // (app/api/reserve, 'important' since 2026-10-11). The alert inserted here said category 'drop', refused by 0232.
      if (!freshRow(record.created_at, nowMs) || !(await once())) return new Response("skip: not news, or sent already");
      const message = `${record.size ?? "?"}-pack reserved for ${record.drop_date ?? "the next drop"}${record.paid ? " · paid" : " · pay at pickup"}`;
      if (mayEmail("important", true)) await emailAdmins(`New reserve — ${record.size ?? "?"}-pack for ${record.drop_date ?? "next drop"}`, [
        message + ".",
        "",
        "Drop board: https://app.gt3pb.com/crew?s=now",
      ].join("\n"), faults);
      return new Response("ok: reserve");

    } else if (table === "event_tasks" && type === "UPDATE" && record.assignee) {
      // Crew assignment → tell the assigned member they're on a task. Fires on a real assignee
      // change — and, since 2026-07-30 (Ryan: critical tasks email their owner), also when a task
      // FLIPS to critical with an assignee already on it. Done-toggles and re-saves still skip.
      const assigneeChanged = !old_record || old_record.assignee !== record.assignee;
      const becameCritical = !!record.critical && !!old_record && !old_record.critical;
      if (!assigneeChanged && !becameCritical) return new Response("skip: no assignee/critical change");
      if (named.assignee !== record.assignee || !(await once())) return new Response("skip: moved on, or sent already");
      shown = taskShown(record, becameCritical && !assigneeChanged);
      url = "/admin";
      targets = await subsFor((q) => q.eq("user_id", record.assignee), faults);
      // Critical tasks EMAIL their owner too (push alone depends on a subscribed device) — both
      // when a critical task is assigned and when an assigned task turns critical. Neither the email nor the lock screen
      // says what the task is (R27, API F17: a label or an event's title can be a client's name): that it is theirs, and
      // the link (./policy.ts taskOutside).
      if (record.critical) {
        const told = taskOutside(becameCritical && !assigneeChanged);
        await emailUser(record.assignee, told.subject, told.text, faults);
      }

    } else if (table === "live_status" && type === "UPDATE") {
      // Customer go-live ping (0257) — the truck flips live, everyone who raised a hand on the
      // Find Us chip gets ONE push. Fires only on the false→true flip: location changes while
      // already live, and going offline, stay silent (nobody wants a "we left" buzz). These are
      // guests, not crew — no alert row, no Teams, no email; the push IS the product.
      const wentLive = !!record.is_live && !!old_record && !old_record.is_live;
      if (!wentLive) return new Response("skip: not a go-live flip");
      // The flip as the database stamped it (0419 live_since): a truck live for an hour described as going live again is
      // not news, and two go-lives in a half hour are one push.
      if (!freshRow(record.live_since, nowMs, LIVE_NEWS_MS) || !(await once())) return new Response("skip: not news, or said already this half hour");
      let stopName: string | null = null;
      if (record.current_stop_id) {
        // The stop's name, which the Find Us page shows anyone (stops.name is not null, 0001) — never its street.
        const { data: s } = await supabase.from("stops").select("name").eq("id", record.current_stop_id).maybeSingle();
        stopName = s?.name ?? null;
      }
      shown = liveShown(stopName);
      url = "/";
      targets = await subsFor((q) => q.eq("wants_live", true).eq("tenant_id", tenantOf(record)), faults);

    } else if (table === "cup_reminders" && type === "UPDATE") {
      // Remind me when cup orders open (0394): the minute's run marked it sent — to that member's own devices, once.
      // The stop's name, which Find Us shows anyone; nothing else about them or the order.
      if (!record.fired_at || (old_record && old_record.fired_at)) return new Response("skip: not a reminder going out");
      if (!freshRow(record.fired_at, nowMs) || !(await once())) return new Response("skip: not news, or sent already");
      const { data: s } = await supabase.from("stops").select("name").eq("id", record.stop_id).maybeSingle();
      shown = reminderShown(s?.name ?? null, record.stop_id);
      url = "/";
      targets = await subsFor((q) => q.eq("user_id", record.user_id), faults);

    } else if (table === "pack_notices" && type === "UPDATE") {
      // A pack hears about its day (0399): the five minutes' run marked it sent. To the member's own devices, their own
      // email, and a text when texts are on and their number said yes (0398). The pack and its stop are read now, so the
      // words say how things stand; what went is written back on the notice.
      if (!record.sent_at || (old_record && old_record.sent_at)) return new Response("skip: not a notice going out");
      if (!freshRow(record.sent_at, nowMs) || !(await once())) return new Response("skip: not news, or sent already");
      const { data: pack, error: unread } = await supabase.from("drop_orders")
        .select("id, user_id, size, glass, drop_date, stop_id, paid, payment_status, phone").eq("id", record.pack_id).maybeSingle();
      // A pack that couldn't be read is a notice lost, not one with no pack (R21): said, as the row's own read is.
      if (unread) throw new Error(`the pack could not be read (${codeOf(unread)})`);
      if (!pack?.user_id) return new Response("skip: no pack");
      const { data: stop } = pack.stop_id
        ? await supabase.from("stops").select("name, starts_at, ends_at, location_text, address").eq("id", pack.stop_id).maybeSingle()
        : { data: null };
      shown = packNoticeShown(record.kind, pack, stop);
      const told = packNoticeTold(record.kind, pack, stop);
      if (!shown || !told) return new Response("skip: not a notice this knows");
      // The evening-before reminder, turned off on their Notifications screen (R6): nothing goes, and the notice says
      // why. A pack moved or canceled is the order itself, and goes whatever the switch.
      if (record.kind === "pickup_tomorrow" && await customerMuted(pack.user_id, CUSTOMER_MUTE.pickupReminders)) {
        const { error: unwritten } = await supabase.from("pack_notices").update({ pushed: 0, emailed: false, texted: null, detail: "pickup reminders off (Notifications)" }).eq("id", record.id);
        if (unwritten) fault(faults, "notice", `why nothing went could not be written back (${codeOf(unwritten)})`);
        return new Response("skip: pickup reminders off");
      }
      url = "/reserve";
      targets = await subsFor((q) => q.eq("user_id", pack.user_id), faults);
      const emailed = await emailMember(pack.user_id, told.subject, told.text);
      const texted = await textMember(pack.phone, told.sms, faults);
      const devices = targets.length;
      after = () => supabase.from("pack_notices").update({ pushed: devices, emailed, texted: texted.result, detail: texted.detail ?? null }).eq("id", record.id);

    } else if (table === "alerts" && type === "INSERT") {
      // Alert spine (0050) — fan one alert out to the channels its severity gets (./policy.ts: an fyi gets none).
      // The alert as the database holds it (rowNow), new, and once (R10).
      if (!freshRow(record.created_at, nowMs) || !(await once())) return new Response("skip: not news, or sent already");
      const ch = channelsFor(record.severity);
      // "Ring this phone" (0374): the person's own test, to their own devices — never Teams, never email.
      const ownTest = record.kind === "device_test";
      if (ownTest && !record.target_user_id) return new Response("skip: a device test is someone's own");
      if (!ch.push && !ownTest) return new Response("ok: fyi stays in the inbox");
      // What leaves the app (R27, API F17; Ryan: "Order # + link only"): the card and the email say what kind of thing
      // happened, the number it is about, and the link — the alert's own title and body (a customer's name, email, phone,
      // street, what they ordered) stay in the app's inbox (./policy.ts alertOutside; its link a path on this site and
      // nothing else, sitePath).
      const outside = alertOutside(record);
      // 1) Teams (classic Incoming Webhook / MessageCard). If you wired a Power Automate
      // "Workflows" webhook instead, it expects an Adaptive Card — say so and I'll switch it.
      if (!ownTest) await postTeams(record.severity, outside.line, outside.text, faults);
      // Critical alerts EMAIL as well (2026-07-30, Ryan: "emails on critical notes... owners of
      // those should get"): the alert's own target user when there is one, the admin list when
      // there isn't. Push needs a subscribed device; a critical can't depend on that.
      if (!ownTest && mayEmail(record.severity)) {
        const subj = `Critical — ${outside.line}`;
        if (record.target_user_id) await emailUser(record.target_user_id, subj, outside.text, faults);
        else await emailAdmins(subj, outside.text, faults);
      }
      // 2) Push: to the target user, or all leadership of the alert's business when there's no specific target —
      // each of them asked first whether this alert may ring them now (ringingNow: their mutes, their quiet hours;
      // a critical always rings).
      shown = alertShown(record);
      url = sitePath(record.link, "/admin");
      const ids = await ringingNow(record, await peopleFor(record, faults));
      targets = ids.length ? await subsFor((q) => q.in("user_id", ids), faults) : [];

    } else if (table === "alerts" && type === "UPDATE") {
      // A CRITICAL NOBODY PICKED UP (0373). escalate_unacked_criticals() marks it escalated once it has gone ten
      // minutes unacknowledged; this sends it again, once, to its own people and every admin and owner of its
      // business. Acknowledging stops it: one acknowledged between the mark and this send — "Got it" on the row, or
      // on a broadcast its claim (0383: the first Got it, kept on the alert; before 0383, anyone's alert_reads row,
      // 0157) — is not sent (./policy.ts stillUnanswered). The whole row is read (rowNow, R10: the alert as the
      // database holds it now), so the claim is seen once its column exists, and this is right on either side of 0383.
      if (!isEscalation(record, old_record)) return new Response("skip: not an escalation");
      let reads: number | null = null;
      if (!("claimed_by" in record)) {
        const { count } = await supabase.from("alert_reads").select("alert_id", { count: "exact", head: true }).eq("alert_id", record.id);
        reads = count ?? 0;
      }
      if (!stillUnanswered(record, reads)) return new Response("skip: acknowledged");
      if (!freshRow(record.escalated_at, nowMs) || !(await once())) return new Response("skip: not news, or sent already");
      shown = escalationShown(record);
      url = sitePath(record.link, "/admin");
      const ids = await peopleFor(record, faults, true);
      targets = ids.length ? await subsFor((q) => q.in("user_id", ids), faults) : [];

    } else {
      return new Response("skip");
    }

    if (!shown) return new Response("skip");
    const title = shown.title, message = shown.body;
    // tag and ring are the browser's (public/sw.js): one notification per event, and shown even with the app open
    // for a critical, an escalation and a test. A worker from before reads title, body and url as it always did.
    const payload = JSON.stringify({ title, body: message, url, tag: shown.tag, ring: shown.ring });
    // WHOSE REFUSAL IT IS (R21). A device that is gone is deleted (Apple's 410, a browser service's 404/410), and one
    // device's own refusal is logged — a phone sent to too fast (Apple's 429), a browser's subscription made under
    // another key (403 at Google's, 401 at Mozilla's). A refusal of what WE sent — our key, our topic, our payload, Apple
    // down — is a fault; so is every one of three or more browsers refusing it, which no single device does.
    let webTook = 0;
    const webRefused: number[] = [];
    const sendOne = async (s: Sub) => {
      try {
        // The iPhone app's row: Apple's service, not a browser's (0367).
        if (s.platform === "apns") {
          const { status, reason } = await sendApns(s.endpoint, { title, body: message, url });
          if (status === 410) await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          // One phone's own refusal: sent to too fast (429), or a token for another app (kept: a topic of ours gone wrong
          // would answer that for every phone, and deleting them all would lose every phone's alerts — R21 review).
          else if (status === 429 || reason === "DeviceTokenNotForTopic") console.warn(`[push] apns: HTTP ${status}${reason ? ` ${reason}` : ""} (one phone)`);
          else if (status !== 200 && status !== 0) fault(faults, "apns", `HTTP ${status}${reason ? ` ${reason}` : ""}`);
          return;
        }
        // A web device at a browser's push service only (R9, 0418 push_host_ok): a row kept at any other address is
        // left alone, never posted to.
        if (!pushHostOk(s.endpoint)) return;
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh ?? "", auth: s.auth ?? "" } }, payload, { timeout: OUT_MS });
        webTook++;
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        else if (s.platform === "apns") fault(faults, "apns", whyOf(e));                 // Apple unreachable, or our key unusable
        else if (code === 413) fault(faults, "web push", "HTTP 413");                     // our payload's size
        else { webRefused.push(code ?? 0); console.warn(`[push] web push: ${code ? `HTTP ${code}` : whyOf(e)} (one device)`); }
      }
    };
    // A few at a time (R9): every subscriber at the same moment was one burst of posts as wide as the list.
    for (let i = 0; i < targets.length; i += SEND_AT_ONCE) await Promise.all(targets.slice(i, i + SEND_AT_ONCE).map(sendOne));
    if (webRefused.length >= 3 && webTook === 0) {
      fault(faults, "web push", `every browser refused it (${[...new Set(webRefused)].sort().map((c) => (c ? `HTTP ${c}` : "no answer")).join(", ")})`);
    }
    if (after) {
      const { error } = await after();
      if (error) fault(faults, "notice", `what went could not be written back (${codeOf(error)})`);
    }
    return new Response("ok");
  } catch (e) {
    // Never thrown past here; said in the log and in the answer — with no address in it (whyOf).
    console.error(`[push] failed: ${whyOf(e)}`);
    return new Response("err: " + whyOf(e), { status: 500 });
  }
}
