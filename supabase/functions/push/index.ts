// Supabase Edge Function - sends native Web Push on order / subscription / booking changes.
// Triggered by Database Webhooks (orders INSERT/UPDATE, subscriptions UPDATE, booking_requests
// INSERT, alerts INSERT, event_tasks UPDATE, profiles INSERT, delivery_orders INSERT,
// drop_orders INSERT, live_status UPDATE — the customer go-live ping, 0257).
// Secrets: VAPID_PUBLIC, VAPID_PRIVATE. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected.
// Deploy: Supabase dashboard -> Edge Functions -> "push" -> paste -> deploy.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

webpush.setVapidDetails(
  "mailto:hello@gt3pb.com",
  Deno.env.get("VAPID_PUBLIC")!,
  Deno.env.get("VAPID_PRIVATE")!,
);
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const DRINKS: Record<string, string> = { rise: "RISE", flow: "FLOW", dusk: "DUSK", tide: "TIDE", forge: "FORGE", hunt: "HUNT", wild: "WILD" };
const firstName = (full?: string | null) => (full || "").trim().split(/\s+/)[0] || "";

// deno-lint-ignore no-explicit-any
async function subsFor(filter: (q: any) => any) {
  const { data } = await filter(supabase.from("push_subscriptions").select("*"));
  // One send per device - dedup by endpoint so a duplicated row can't double-notify.
  const seen = new Set<string>();
  return (data ?? []).filter((s: { endpoint: string }) => (seen.has(s.endpoint) ? false : (seen.add(s.endpoint), true)));
}

async function nameForUser(userId: string) {
  const { data } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  return firstName(data?.display_name);
}

// Post an alert card to the Teams channel (best-effort; skipped if no webhook / fyi tier).
async function postTeams(severity: string, ttl: string, body: string) {
  const teams = Deno.env.get("TEAMS_WEBHOOK_URL");
  if (!teams || severity === "fyi") return;
  const themeColor = severity === "critical" ? "D2554A" : "A97C3F";
  const flag = severity === "critical" ? "🔴 " : "🟠 ";
  try {
    await fetch(teams, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "@type": "MessageCard", "@context": "https://schema.org/extensions", themeColor, summary: ttl, title: flag + ttl, text: body || "" }),
    });
  } catch (_e) { /* never fail on a channel error */ }
}
// Drop a row in the in-app inbox (service role bypasses RLS — these are system-raised).
async function insertAlert(a: { severity: string; category: string; title: string; body?: string; link?: string }) {
  await supabase.from("alerts").insert({ severity: a.severity, category: a.category, title: a.title, body: a.body ?? null, link: a.link ?? "/admin" });
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
  } catch (_e) { /* never fail the webhook on a mail-provider hiccup */ }
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
  } catch (_e) { /* fall through to the admin list */ }
  await emailAdmins(subject, body);
}

Deno.serve(async (req) => {
  try {
    const { table, type, record, old_record } = await req.json();
    let title = "GT3 Performance Bar", message = "", url = "/";
    // deno-lint-ignore no-explicit-any
    let targets: any[] = [];

    if (table === "orders" && type === "INSERT") {
      const names = (record.items ?? []).map((i: string) => DRINKS[i] ?? i).join(" - ");
      title = "New order";
      message = `${record.customer ? record.customer + " - " : ""}${names} - $${(record.total_cents / 100).toFixed(2)}`;
      url = "/admin";
      targets = await subsFor((q) => q.eq("is_admin", true));

    } else if (table === "orders" && type === "UPDATE" && record.user_id) {
      // Only fire on a real status TRANSITION - this is what stops the duplicate spam
      // when the row is rewritten with the same status (optimistic + reconcile, etc.).
      if (old_record && old_record.status === record.status) return new Response("skip: no transition");
      const name = firstName(record.customer);
      const map: Record<string, string> = {
        preparing: name ? `${name}, we're making your order now.` : "We're making your order now.",
        ready: name ? `${name}, your order's ready - come grab it at the bar.` : "Your order's ready - come grab it at the bar.",
        // 'done' intentionally sends nothing - they already have it in hand.
      };
      if (!map[record.status]) return new Response("skip");
      message = map[record.status];
      targets = await subsFor((q) => q.eq("user_id", record.user_id));

    } else if (table === "subscriptions" && type === "UPDATE" && record.user_id) {
      if (old_record && old_record.status === record.status) return new Response("skip: no transition");
      const name = await nameForUser(record.user_id);
      const map: Record<string, string> = {
        active: name ? `${name}, your subscription's live - your bottles are ready when you are.` : "Your subscription's live - your bottles are ready when you are.",
        past_due: name ? `${name}, your subscription payment didn't go through - update your card to keep your bottles coming.` : "Your subscription payment didn't go through - update your card to keep your bottles coming.",
      };
      if (!map[record.status]) return new Response("skip");
      message = map[record.status];
      url = "/3mpire";
      targets = await subsFor((q) => q.eq("user_id", record.user_id));

    } else if (table === "booking_requests" && type === "INSERT") {
      title = "New booking request";
      message = `${record.name ?? "Someone"}${record.event_date ? " - " + record.event_date : ""}${record.location_text ? " - " + record.location_text : ""}`;
      url = "/admin";
      // No direct push targets here (2026-07-30, Ryan's screenshot: "Should I have gotten three?").
      // insertAlert below fans out to leadership via the alerts webhook — pushing directly here TOO
      // meant every booking notified twice from this function alone. One event, one push.
      // Producer: a new lead → inbox + Teams + email so it's chased before it goes cold. Email is
      // the one channel here that doesn't depend on a subscribed device or a configured webhook —
      // an owner who's away from the crew app for a day still finds out a lead came in, and when.
      await insertAlert({ severity: "important", category: "booking", title: "New booking lead", body: message });
      await postTeams("important", "New booking lead", message);
      await emailAdmins(
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

    } else if (table === "profiles" && type === "INSERT") {
      // New sign-up (2026-07-30). Low-volume, high-signal: inbox alert + email; push rides the
      // alert fan-out (the alerts INSERT webhook), so no direct targets here. Teams skips fyi.
      const who = record.display_name?.trim() || "Someone new";
      const role = record.role && record.role !== "member" ? ` (${record.role})` : "";
      message = `${who}${role} just joined.`;
      await insertAlert({ severity: "fyi", category: "system", title: "New member signed up", body: message, link: "/crew?s=customers" });
      await emailAdmins("New member signed up", [
        `${who}${role} just created an account.`,
        "",
        "Customer book: https://app.gt3pb.com/crew?s=customers",
      ].join("\n"));
      return new Response("ok: signup");

    } else if (table === "delivery_orders" && type === "INSERT") {
      // New delivery order (2026-07-30): alert (fans out push) + Teams + email. No direct targets —
      // the alert webhook is the ONE push path (see the booking case's triple-notification note).
      title = "New delivery order";
      message = `${record.pack_size ?? "?"}-bottle delivery for ${record.delivery_date ?? "soon"}`;
      url = "/admin";
      await insertAlert({ severity: "important", category: "delivery", title, body: message, link: "/crew?s=driver" });
      await postTeams("important", title, message);
      await emailAdmins(`New delivery order — ${record.pack_size ?? "?"}-pack`, [
        message + ".",
        "",
        "Run sheet: https://app.gt3pb.com/crew?s=driver",
      ].join("\n"));

    } else if (table === "drop_orders" && type === "INSERT") {
      // New reserve (2026-07-30): same single-push contract as deliveries — the alert fan-out
      // carries the push; direct targets here would double it.
      title = "New reserve";
      message = `${record.size ?? "?"}-pack reserved for ${record.drop_date ?? "the next drop"}${record.paid ? " · paid" : " · pay at pickup"}`;
      url = "/admin";
      await insertAlert({ severity: "important", category: "drop", title, body: message, link: "/crew?s=now" });
      await postTeams("important", title, message);
      await emailAdmins(`New reserve — ${record.size ?? "?"}-pack for ${record.drop_date ?? "next drop"}`, [
        message + ".",
        "",
        "Drop board: https://app.gt3pb.com/crew?s=now",
      ].join("\n"));

    } else if (table === "event_tasks" && type === "UPDATE" && record.assignee) {
      // Crew assignment → tell the assigned member they're on a task. Fires on a real assignee
      // change — and, since 2026-07-30 (Ryan: critical tasks email their owner), also when a task
      // FLIPS to critical with an assignee already on it. Done-toggles and re-saves still skip.
      const assigneeChanged = !old_record || old_record.assignee !== record.assignee;
      const becameCritical = !!record.critical && !!old_record && !old_record.critical;
      if (!assigneeChanged && !becameCritical) return new Response("skip: no assignee/critical change");
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
      title = becameCritical && !assigneeChanged ? "Task flagged critical" : "You're on the crew";
      message = becameCritical && !assigneeChanged
        ? `Critical now: ${record.label}${ctx}`
        : `${name ? name + ", you're" : "You're"} on: ${record.label}${ctx}`;
      url = "/admin";
      targets = await subsFor((q) => q.eq("user_id", record.assignee));
      // Critical tasks EMAIL their owner too (push alone depends on a subscribed device) — both
      // when a critical task is assigned and when an assigned task turns critical.
      if (record.critical) {
        await emailUser(record.assignee, `Critical task — ${record.label}`, [
          message + ".",
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
      let where = "";
      if (record.current_stop_id) {
        const { data: s } = await supabase.from("stops").select("name, location_text").eq("id", record.current_stop_id).maybeSingle();
        if (s?.name) where = ` at ${s.name}`;
        else if (s?.location_text) where = ` at ${s.location_text}`;
      }
      title = "GT3 is LIVE";
      message = `We're pouring${where} — come thru.`;
      url = "/";
      targets = await subsFor((q) => q.eq("wants_live", true));

    } else if (table === "alerts" && type === "INSERT") {
      // Alert spine (0050) — fan one alert out to the chosen channels by severity.
      const sev = record.severity || "important";
      // 1) Teams (classic Incoming Webhook / MessageCard). If you wired a Power Automate
      // "Workflows" webhook instead, it expects an Adaptive Card — say so and I'll switch it.
      await postTeams(sev, record.title, record.body || "");
      // Critical alerts EMAIL as well (2026-07-30, Ryan: "emails on critical notes... owners of
      // those should get"): the alert's own target user when there is one, the admin list when
      // there isn't. Push needs a subscribed device; a critical can't depend on that.
      if (sev === "critical") {
        const subj = `Critical — ${record.title}`;
        const bodyTxt = [record.body || record.title, "", `Open it: https://app.gt3pb.com${record.link || "/crew?s=day"}`].join("\n");
        if (record.target_user_id) await emailUser(record.target_user_id, subj, bodyTxt);
        else await emailAdmins(subj, bodyTxt);
      }
      // 2) Web push: to the target user, or all leadership when there's no specific target.
      title = (sev === "critical" ? "Critical — " : "") + record.title;
      message = record.body || "";
      url = record.link || "/admin";
      if (record.target_user_id) {
        targets = await subsFor((q) => q.eq("user_id", record.target_user_id));
      } else {
        const { data: leads } = await supabase.from("profiles").select("id").in("role", ["event_manager", "admin", "owner"]);
        const ids = (leads ?? []).map((p: { id: string }) => p.id);
        targets = ids.length ? await subsFor((q) => q.in("user_id", ids)) : [];
      }

    } else if (table === "event_approval_request" && Array.isArray(record.approver_ids) && record.approver_ids.length) {
      // Owner/manager prep sign-off request → ping the people who still need to approve.
      title = "Prep needs your sign-off";
      message = `Review & approve prep for ${record.title ?? "an event"}`;
      url = "/admin";
      targets = await subsFor((q) => q.in("user_id", record.approver_ids));

    } else {
      return new Response("skip");
    }

    const payload = JSON.stringify({ title, body: message, url });
    await Promise.all(targets.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
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
