import { NextResponse } from "next/server";
import { adminFromRequest, callerClient, userFromRequest } from "@/lib/apiAuth";
import { limitsFit } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { accountEmail, sendEmail, notifyCustomer, emailEnabled } from "@/lib/notify";
import { moneyRound } from "@/lib/money";
import { route } from "@/lib/apiRoute";
import { salesReport } from "@/lib/salesReport";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// FOUNDER DIGEST (on-demand) — composes the same business roll-up as founder_digest_alert() (0208) and
// EMAILS/TEXTS it to the founders (profiles with role owner/admin) via Resend/Twilio. It is the "Send digest now" button,
// which the console shows owners and admins — and since R10b (2026-10-16, the 10/10 audit) only they may press it: any
// crew role could, and read the week's revenue in its answer and email and text every founder as often as it liked. A
// few an hour each, and for everyone together. The automated daily version runs in-DB via pg_cron → alerts. Returns
// the composed summary so the button can confirm what went out.

async function count(table: "incident_log" | "alerts", filter: (q: any) => any): Promise<number> {
  try {
    const { count: c } = await filter(supabaseAdmin!.from(table).select("id", { count: "exact", head: true }));
    return c ?? 0;
  } catch { return 0; }
}

async function post(req: Request) {
  if (!(await adminFromRequest(req))) return NextResponse.json({ ok: false, error: "Owners and admins send the digest." }, { status: 403 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
  const me = await userFromRequest(req);
  if (!(await limitsFit(supabaseAdmin, [
    { bucket: `digest:u:${me?.id ?? "?"}`, windowMs: 3_600_000, max: 3 },
    { bucket: "digest:all", windowMs: 3_600_000, max: 10 },
  ]))) return NextResponse.json({ ok: false, error: "The digest just went out — try again in an hour." }, { status: 429 });

  // THE WEEK'S REVENUE, AS MONEY COUNTS IT (R39 — the fresh audit's API11-07). This added the week up itself: each table
  // in one read (PostgREST stops at 1,000 rows — a busy week's cups summed short), a read that failed counted as $0, and
  // the walk-ups matched against at most 1,000 app payments of each kind (past that, an app payment counted again as a
  // walk-up). It asks report_sales (0420) — the one sum Money and Home read — as the owner or admin who pressed the
  // button: reconciled, refunds taken off, on the business's days, with the shop and the reserves the old sum left out.
  // A sum that couldn't be read is said so, never $0.
  const report = await salesReport(callerClient(req), 7);

  const [blockers, reorders, crit] = await Promise.all([
    count("incident_log", (q) => q.eq("resolved", false).eq("severity", "blocker")),
    count("alerts", (q) => q.is("ack_at", null).eq("category", "prep").like("title", "📦 Reorder%")),
    count("alerts", (q) => q.is("ack_at", null).eq("severity", "critical")),
  ]);

  let verdict = "no criteria yet", blocked = 0;
  try {
    const { data: rc } = await supabaseAdmin.from("readiness_checks").select("status, critical");
    const critical = (rc ?? []).filter((r: any) => r.critical);
    blocked = critical.filter((r: any) => r.status === "blocked").length;
    verdict = critical.length === 0 ? "no criteria yet" : blocked > 0 ? "NO-GO" : "on track";
  } catch { /* leave defaults */ }

  const headline = `Revenue 7d ${report ? moneyRound(report.revenueCents) : "—"} · Launch ${verdict}${blocked ? ` (${blocked} blocked)` : ""} · Blockers ${blockers} · Reorders ${reorders} · Needs you ${crit}`;
  const ch = report?.byChannel;
  const emailBody = [
    "GT3 Performance Bar — founder digest",
    "",
    ...(report && ch ? [
      `Revenue (last 7 days, reconciled): ${moneyRound(report.revenueCents)}`,
      `   walk-up ${moneyRound(ch.walkup)} · cup ${moneyRound(ch.cup)} · pack ${moneyRound(ch.packs)} · delivery ${moneyRound(ch.delivery)} · office ${moneyRound(ch.office)} · shop ${moneyRound(ch.shop)} · reserve ${moneyRound(ch.reserve)}`,
    ] : ["Revenue (last 7 days): couldn't be read just now — open Money for it."]),
    `Launch readiness: ${verdict}${blocked ? ` — ${blocked} critical blocked` : ""}`,
    `Open blockers: ${blockers}`,
    `Reorders needed: ${reorders}`,
    `Needs you (unacked critical): ${crit}`,
    "",
    "Open the Pit Wall → Command Board for the full picture.",
  ].join("\n");

  // Recipients = the founders (owner/admin profiles). Email is reliable; a text goes the way every text goes (R7,
  // 2026-10-15): through lib/notify's gate — texts switched on, a standing yes from that number, never at night. It went
  // straight to Twilio, whatever the switch said, to a number that had said yes to nothing.
  const { data: leaders } = await supabaseAdmin.from("profiles").select("id").in("role", ["owner", "admin"]);
  let sent = 0;
  for (const p of (leaders ?? []) as { id: string }[]) {
    const email = await accountEmail(p.id);
    if (email) { if ((await sendEmail(email, "📊 GT3 founder digest", emailBody)).ok) sent++; }
    try {
      const { data: cust } = await supabaseAdmin.from("customers").select("phone").eq("user_id", p.id).not("phone", "is", null).limit(1).maybeSingle();
      if (cust?.phone) await notifyCustomer({ phone: cust.phone, subject: "GT3 founder digest", message: `GT3 digest — ${headline}` });
    } catch { /* SMS best-effort */ }
  }

  return NextResponse.json({ ok: true, sent, emailConfigured: emailEnabled(), summary: headline });
}

export const POST = route("cron/digest", post);
