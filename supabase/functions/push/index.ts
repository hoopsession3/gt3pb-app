// Supabase Edge Function - sends Web Push (browsers) and APNs (the iPhone app) on order / subscription / booking changes.
// Triggered by Database Webhooks (orders INSERT/UPDATE, subscriptions UPDATE, booking_requests
// INSERT, alerts INSERT, event_tasks UPDATE, profiles INSERT, delivery_orders INSERT,
// drop_orders INSERT, live_status UPDATE — the customer go-live ping, 0257), and by an alerts UPDATE when a
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
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  alertShown, channelsFor, escalationShown, isEscalation, liveShown, mayEmail, newOrderShown, orderStatusShown,
  severityOf, signoffShown, stillUnanswered, subscriptionShown, taskShown, whoRings, type NotifPrefsRow, type Shown,
} from "./policy.ts";

webpush.setVapidDetails(
  "mailto:hello@gt3pb.com",
  Deno.env.get("VAPID_PUBLIC")!,
  Deno.env.get("VAPID_PRIVATE")!,
);
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const firstName = (full?: string | null) => (full || "").trim().split(/\s+/)[0] || "";

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

/** One alert to one app install. Returns Apple's status, or 0 when APNs is not set up here. An alert that could not
 *  reach the phone within the hour is dropped, not delivered late ("your order's ready" at midnight is wrong). */
async function sendApns(endpoint: string, alert: { title: string; body: string; url: string }): Promise<number> {
  const bearer = await apnsBearer();
  const token = endpoint.slice("apns:".length);
  if (!bearer || !/^[0-9a-f]{32,200}$/i.test(token)) return 0;
  const r = await fetch(`${APNS_HOST}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${bearer}`, "apns-topic": APNS_TOPIC, "apns-push-type": "alert", "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600), "content-type": "application/json",
    },
    body: JSON.stringify({ aps: { alert: { title: alert.title.slice(0, 120), body: alert.body.slice(0, 900) }, sound: "default" }, url: alert.url }),
  });
  if (r.status === 400 || r.status === 403) {
    const reason = ((await r.json().catch(() => ({}))) as { reason?: string }).reason;
    if (r.status === 403 && (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken")) apnsAuth = null;
    if (r.status === 400 && reason === "BadDeviceToken") return 410;
  }
  return r.status;
}

type Sub = { endpoint: string; p256dh: string | null; auth: string | null; platform: string | null };
type SubQuery = ReturnType<ReturnType<typeof supabase.from>["select"]>;

async function subsFor(filter: (q: SubQuery) => SubQuery): Promise<Sub[]> {
  const { data } = await filter(supabase.from("push_subscriptions").select("*"));
  // One send per device - dedup by endpoint so a duplicated row can't double-notify.
  const seen = new Set<string>();
  return ((data ?? []) as Sub[]).filter((s) => (seen.has(s.endpoint) ? false : (seen.add(s.endpoint), true)));
}

async function nameForUser(userId: string) {
  const { data } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  return firstName(data?.display_name);
}

// WHO AN ALERT REACHES (2026-10-11). Its own person when it has one; a broadcast, the leadership of its tenant
// (event_manager, admin, owner — 0157). An escalation (0373) is sent to those again AND to every admin and owner of
// the tenant, so a critical nobody picked up reaches the people who answer for the business, not only its lane.
async function peopleFor(a: { target_user_id?: string | null; tenant_id?: string | null }, escalation = false): Promise<string[]> {
  const ids = new Set<string>();
  if (a.target_user_id) ids.add(a.target_user_id);
  const roles = new Set<string>(a.target_user_id ? [] : ["event_manager", "admin", "owner"]);
  if (escalation) { roles.add("admin"); roles.add("owner"); }
  if (roles.size) {
    const { data } = await supabase.from("profiles").select("id").eq("tenant_id", tenantOf(a)).in("role", [...roles]);
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

// Post an alert card to the Teams channel (best-effort; skipped with no webhook, and wherever ./policy.ts says a
// severity does not post — an fyi).
async function postTeams(severity: string, ttl: string, body: string) {
  const teams = Deno.env.get("TEAMS_WEBHOOK_URL");
  if (!teams || !channelsFor(severity).teams) return;
  const themeColor = severityOf(severity) === "critical" ? "D2554A" : "A97C3F";
  const flag = severityOf(severity) === "critical" ? "🔴 " : "🟠 ";
  try {
    await fetch(teams, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "@type": "MessageCard", "@context": "https://schema.org/extensions", themeColor, summary: ttl, title: flag + ttl, text: body || "" }),
    });
  } catch { /* never fail on a channel error */ }
}
// Drop a row in the in-app inbox (service role bypasses RLS — these are system-raised). Its fan-out (0157) carries
// the push and the Teams card, so a caller here sends neither itself — that made two Teams cards per booking.
async function insertAlert(a: { severity: string; category: string; title: string; body?: string; link?: string; tenant_id?: string | null }) {
  await supabase.from("alerts").insert({ severity: a.severity, category: a.category, title: a.title, body: a.body ?? null,
    link: a.link ?? "/admin", tenant_id: tenantOf(a) });
}

// The ONE Resend send under emailAdmins/emailUser. First address on To, the rest BCC
// (2026-07-30 — Ryan: "Why can you see CC, maybe BCC?"): one visible To keeps deliverability
// happy; BCC keeps the list private and the header clean. RESEND_API_KEY / NOTIFY_FROM_EMAIL
// must be set on this function's env or this is a clean no-op — same contract as lib/notify.ts.
async function sendEmail(to: string[], subject: string, body: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("NOTIFY_FROM_EMAIL");
  if (!key || !from || !to.length) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: to.slice(0, 1), ...(to.length > 1 ? { bcc: to.slice(1) } : {}), subject: subject.slice(0, 200), text: body }),
    });
  } catch { /* never fail the webhook on a mail-provider hiccup */ }
}

// Email the owner/manager list (public.admin_emails — 0004). Push needs a subscribed device and
// Teams needs its webhook configured; email is the net under both for anything that must not
// silently go cold.
async function emailAdmins(subject: string, body: string) {
  const { data: admins } = await supabase.from("admin_emails").select("email");
  await sendEmail(((admins ?? []) as { email: string }[]).map((a) => a.email), subject, body);
}

// Email ONE user by id (2026-07-30, Ryan: "I want to get emails on critical notes and tasks as
// well. Owners of those should get [them]"). The service role this function runs with can look
// the address up via the auth admin API. A critical must never go cold: if the owner's email
// can't be resolved, the admin list gets it instead.
async function emailUser(userId: string, subject: string, body: string) {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    const em = data?.user?.email;
    if (em) { await sendEmail([em], subject, body); return; }
  } catch { /* fall through to the admin list */ }
  await emailAdmins(subject, body);
}

Deno.serve(async (req) => {
  try {
    const { table, type, record, old_record } = await req.json();
    // What the phone shows (./policy.ts — no customer name, phone, address, email or amount, whatever the row
    // holds) and where a tap opens. The row's own words stay in the app.
    let shown: Shown | null = null, url = "/";
    let targets: Sub[] = [];

    if (table === "orders" && type === "INSERT") {
      shown = newOrderShown(record);
      // A tap opens the Pass itself (2026-10-11, the KDS audit): "/admin" opened the console wherever it was last left,
      // a screen or two from the ticket. &a=kitchen-pass is the console's own jump to the Pass (app/crew/page.tsx jumpTo).
      url = "/crew?s=now&a=kitchen-pass";
      targets = await subsFor((q) => q.eq("is_admin", true).eq("tenant_id", tenantOf(record)));

    } else if (table === "orders" && type === "UPDATE" && record.user_id) {
      // Only fire on a real status TRANSITION - this is what stops the duplicate spam
      // when the row is rewritten with the same status (optimistic + reconcile, etc.).
      if (old_record && old_record.status === record.status) return new Response("skip: no transition");
      shown = orderStatusShown(record);
      if (!shown) return new Response("skip");
      targets = await subsFor((q) => q.eq("user_id", record.user_id));

    } else if (table === "subscriptions" && type === "UPDATE" && record.user_id) {
      if (old_record && old_record.status === record.status) return new Response("skip: no transition");
      shown = subscriptionShown(record);
      if (!shown) return new Response("skip");
      url = "/3mpire";
      targets = await subsFor((q) => q.eq("user_id", record.user_id));

    } else if (table === "booking_requests" && type === "INSERT") {
      // No direct push targets here (2026-07-30, Ryan's screenshot: "Should I have gotten three?").
      // insertAlert below fans out to leadership via the alerts webhook — pushing directly here TOO
      // meant every booking notified twice from this function alone. One event, one push. And one Teams card
      // (2026-10-11): the fan-out posts it, so posting here as well made two.
      // Producer: a new lead → inbox + Teams + email so it's chased before it goes cold. Email is
      // the one channel here that doesn't depend on a subscribed device or a configured webhook —
      // an owner who's away from the crew app for a day still finds out a lead came in, and when.
      const message = `${record.name ?? "Someone"}${record.event_date ? " - " + record.event_date : ""}${record.location_text ? " - " + record.location_text : ""}`;
      await insertAlert({ severity: "important", category: "booking", title: "New booking lead", body: message, tenant_id: record.tenant_id });
      if (mayEmail("important", true)) await emailAdmins(
        `New booking request${record.name ? ` — ${record.name}` : ""}`,
        [
          `${record.name ?? "Someone"} wants to book GT3PB.`,
          "",
          `Submitted: ${new Date(record.created_at ?? Date.now()).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} ET`,
          record.event_date ? `Event date: ${record.event_date}` : null,
          record.headcount ? `Headcount: ${record.headcount}` : null,
          record.location_text ? `Location: ${record.location_text}` : null,
          record.email ? `Email: ${record.email}` : null,
          record.phone ? `Phone: ${record.phone}` : null,
          record.notes ? `Notes: ${record.notes}` : null,
          "",
          "Manage it: https://app.gt3pb.com/crew?s=plan",
        ].filter((line) => line !== null).join("\n"),
      );
      return new Response("ok: booking");

    } else if (table === "profiles" && type === "INSERT") {
      // New sign-up (2026-07-30): an fyi in the inbox, and it asks for an email. Since 2026-10-11 an fyi gets the inbox
      // and nothing else (./policy.ts, FYI STAYS QUIET), so the rule refuses the email — no push, no Teams either. A
      // sign-up the owner wants to hear about is an 'important' one: that one word below brings back the email (asked
      // for here) with a push and a Teams card.
      const who = record.display_name?.trim() || "Someone new";
      const role = record.role && record.role !== "member" ? ` (${record.role})` : "";
      const severity: string = "fyi";
      await insertAlert({ severity, category: "system", title: "New member signed up", body: `${who}${role} just joined.`, link: "/crew?s=customers", tenant_id: record.tenant_id });
      if (mayEmail(severity, true)) await emailAdmins("New member signed up", [
        `${who}${role} just created an account.`,
        "",
        "Customer book: https://app.gt3pb.com/crew?s=customers",
      ].join("\n"));
      return new Response("ok: signup");

    } else if (table === "delivery_orders" && type === "INSERT") {
      // New delivery order (2026-07-30): an email to the owners. The inbox line, its push and its Teams card come
      // from the route that took the order (app/api/delivery/checkout, 'important' since 2026-10-11). The alert this
      // inserted beside it carried category 'delivery', which 0232's alerts_category_canon refuses, so it had never
      // been written since — and its Teams card, posted here directly, was the only one. One event, one of each.
      const message = `${record.pack_size ?? "?"}-bottle delivery for ${record.delivery_date ?? "soon"}`;
      if (mayEmail("important", true)) await emailAdmins(`New delivery order — ${record.pack_size ?? "?"}-pack`, [
        message + ".",
        "",
        "Run sheet: https://app.gt3pb.com/crew?s=driver",
      ].join("\n"));
      return new Response("ok: delivery");

    } else if (table === "drop_orders" && type === "INSERT") {
      // New reserve (2026-07-30): as deliveries — the email here; the inbox line, push and Teams card from the route
      // (app/api/reserve, 'important' since 2026-10-11). The alert inserted here said category 'drop', refused by 0232.
      const message = `${record.size ?? "?"}-pack reserved for ${record.drop_date ?? "the next drop"}${record.paid ? " · paid" : " · pay at pickup"}`;
      if (mayEmail("important", true)) await emailAdmins(`New reserve — ${record.size ?? "?"}-pack for ${record.drop_date ?? "next drop"}`, [
        message + ".",
        "",
        "Drop board: https://app.gt3pb.com/crew?s=now",
      ].join("\n"));
      return new Response("ok: reserve");

    } else if (table === "event_tasks" && type === "UPDATE" && record.assignee) {
      // Crew assignment → tell the assigned member they're on a task. Fires on a real assignee
      // change — and, since 2026-07-30 (Ryan: critical tasks email their owner), also when a task
      // FLIPS to critical with an assignee already on it. Done-toggles and re-saves still skip.
      const assigneeChanged = !old_record || old_record.assignee !== record.assignee;
      const becameCritical = !!record.critical && !!old_record && !old_record.critical;
      if (!assigneeChanged && !becameCritical) return new Response("skip: no assignee/critical change");
      shown = taskShown(record, becameCritical && !assigneeChanged);
      url = "/admin";
      targets = await subsFor((q) => q.eq("user_id", record.assignee));
      // Critical tasks EMAIL their owner too (push alone depends on a subscribed device) — both
      // when a critical task is assigned and when an assigned task turns critical. The email says what the task is;
      // the lock screen does not (a label or an event's title can be a client's name).
      if (record.critical) {
        let ctx = " - an event";
        if (record.event_id) {
          const { data: e } = await supabase.from("events").select("title").eq("id", record.event_id).maybeSingle();
          if (e?.title) ctx = ` - ${e.title}`;
        } else if (record.meeting_note_id) {
          // follow-up captured from a meeting note (0049)
          const { data: m } = await supabase.from("meeting_notes").select("title").eq("id", record.meeting_note_id).maybeSingle();
          ctx = m?.title ? ` - follow-up - ${m.title}` : " - meeting follow-up";
        }
        const name = await nameForUser(record.assignee);
        const said = becameCritical && !assigneeChanged
          ? `Critical now: ${record.label}${ctx}`
          : `${name ? name + ", you're" : "You're"} on: ${record.label}${ctx}`;
        await emailUser(record.assignee, `Critical task — ${record.label}`, [
          said + ".",
          "",
          "Your day: https://app.gt3pb.com/crew?s=day",
        ].join("\n"));
      }

    } else if (table === "live_status" && type === "UPDATE") {
      // Customer go-live ping (0257) — the truck flips live, everyone who raised a hand on the
      // Find Us chip gets ONE push. Fires only on the false→true flip: location changes while
      // already live, and going offline, stay silent (nobody wants a "we left" buzz). These are
      // guests, not crew — no alert row, no Teams, no email; the push IS the product.
      const wentLive = !!record.is_live && !!old_record && !old_record.is_live;
      if (!wentLive) return new Response("skip: not a go-live flip");
      let stopName: string | null = null;
      if (record.current_stop_id) {
        // The stop's name, which the Find Us page shows anyone (stops.name is not null, 0001) — never its street.
        const { data: s } = await supabase.from("stops").select("name").eq("id", record.current_stop_id).maybeSingle();
        stopName = s?.name ?? null;
      }
      shown = liveShown(stopName);
      url = "/";
      targets = await subsFor((q) => q.eq("wants_live", true).eq("tenant_id", tenantOf(record)));

    } else if (table === "alerts" && type === "INSERT") {
      // Alert spine (0050) — fan one alert out to the channels its severity gets (./policy.ts: an fyi gets none).
      const ch = channelsFor(record.severity);
      // "Ring this phone" (0374): the person's own test, to their own devices — never Teams, never email.
      const ownTest = record.kind === "device_test";
      if (ownTest && !record.target_user_id) return new Response("skip: a device test is someone's own");
      if (!ch.push && !ownTest) return new Response("ok: fyi stays in the inbox");
      // 1) Teams (classic Incoming Webhook / MessageCard). If you wired a Power Automate
      // "Workflows" webhook instead, it expects an Adaptive Card — say so and I'll switch it.
      if (!ownTest) await postTeams(record.severity, record.title, record.body || "");
      // Critical alerts EMAIL as well (2026-07-30, Ryan: "emails on critical notes... owners of
      // those should get"): the alert's own target user when there is one, the admin list when
      // there isn't. Push needs a subscribed device; a critical can't depend on that.
      if (!ownTest && mayEmail(record.severity)) {
        const subj = `Critical — ${record.title}`;
        const bodyTxt = [record.body || record.title, "", `Open it: https://app.gt3pb.com${record.link || "/crew?s=day"}`].join("\n");
        if (record.target_user_id) await emailUser(record.target_user_id, subj, bodyTxt);
        else await emailAdmins(subj, bodyTxt);
      }
      // 2) Push: to the target user, or all leadership of the alert's business when there's no specific target —
      // each of them asked first whether this alert may ring them now (ringingNow: their mutes, their quiet hours;
      // a critical always rings).
      shown = alertShown(record);
      url = record.link || "/admin";
      const ids = await ringingNow(record, await peopleFor(record));
      targets = ids.length ? await subsFor((q) => q.in("user_id", ids)) : [];

    } else if (table === "alerts" && type === "UPDATE") {
      // A CRITICAL NOBODY PICKED UP (0373). escalate_unacked_criticals() marks it escalated once it has gone ten
      // minutes unacknowledged; this sends it again, once, to its own people and every admin and owner of its
      // business. Acknowledging stops it: one acknowledged between the mark and this send — "Got it" on the row, or
      // on a broadcast its claim (0383: the first Got it, kept on the alert; before 0383, anyone's alert_reads row,
      // 0157) — is not sent (./policy.ts stillUnanswered). The whole row is read, so the claim is seen once its column
      // exists, and this is right on either side of 0383's paste.
      if (!isEscalation(record, old_record)) return new Response("skip: not an escalation");
      const { data: now } = await supabase.from("alerts").select("*").eq("id", record.id).maybeSingle();
      let reads: number | null = null;
      if (now && !("claimed_by" in now)) {
        const { count } = await supabase.from("alert_reads").select("alert_id", { count: "exact", head: true }).eq("alert_id", record.id);
        reads = count ?? 0;
      }
      if (!stillUnanswered(now, reads)) return new Response("skip: acknowledged");
      shown = escalationShown(record);
      url = record.link || "/admin";
      const ids = await peopleFor(record, true);
      targets = ids.length ? await subsFor((q) => q.in("user_id", ids)) : [];

    } else if (table === "event_approval_request" && Array.isArray(record.approver_ids) && record.approver_ids.length) {
      // Owner/manager prep sign-off request → ping the people who still need to approve.
      shown = signoffShown(record);
      url = "/admin";
      targets = await subsFor((q) => q.in("user_id", record.approver_ids));

    } else {
      return new Response("skip");
    }

    if (!shown) return new Response("skip");
    const title = shown.title, message = shown.body;
    // tag and ring are the browser's (public/sw.js): one notification per event, and shown even with the app open
    // for a critical, an escalation and a test. A worker from before reads title, body and url as it always did.
    const payload = JSON.stringify({ title, body: message, url, tag: shown.tag, ring: shown.ring });
    await Promise.all(targets.map(async (s) => {
      try {
        // The iPhone app's row: Apple's service, not a browser's (0367).
        if (s.platform === "apns") {
          const status = await sendApns(s.endpoint, { title, body: message, url });
          if (status === 410) await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          return;
        }
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh ?? "", auth: s.auth ?? "" } }, payload);
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
    }));
    return new Response("ok");
  } catch (e) {
    return new Response("err: " + e, { status: 500 });
  }
});
