import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { accountEmail, sendEmail, sendSMS } from "@/lib/notify";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// FOUNDER DIGEST (on-demand) — composes the same business roll-up as founder_digest_alert() (0208) and
// EMAILS/TEXTS it to the founders (profiles with role owner/admin) via Resend/Twilio. Staff-gated: this
// is the "Send digest now" button. The automated daily version runs in-DB via pg_cron → alerts. Returns
// the composed summary so the button can confirm what went out.

const since7d = () => new Date(Date.now() - 7 * 864e5).toISOString();
const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

async function sum(table: string, filter: (q: any) => any): Promise<number> {
  try {
    const { data } = await filter(supabaseAdmin!.from(table).select("total_cents"));
    return (data ?? []).reduce((s: number, r: any) => s + (Number(r.total_cents) || 0), 0);
  } catch { return 0; }
}
async function count(table: string, filter: (q: any) => any): Promise<number> {
  try {
    const { count: c } = await filter(supabaseAdmin!.from(table).select("id", { count: "exact", head: true }));
    return c ?? 0;
  } catch { return 0; }
}

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
  const week = since7d();

  // All-channel revenue (last 7d) — the four order tables MoneyKpis sums.
  const [cup, packs, deliv, office] = await Promise.all([
    sum("orders", (q) => q.eq("paid", true).neq("status", "void").gte("created_at", week)),
    sum("drop_orders", (q) => q.eq("paid", true).is("canceled_at", null).gte("created_at", week)),
    sum("delivery_orders", (q) => q.eq("payment_status", "paid").is("canceled_at", null).gte("created_at", week)),
    sum("business_orders", (q) => q.eq("payment_status", "paid").is("canceled_at", null).gte("created_at", week)),
  ]);
  const rev = cup + packs + deliv + office;

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

  const headline = `Revenue 7d ${money(rev)} · Launch ${verdict}${blocked ? ` (${blocked} blocked)` : ""} · Blockers ${blockers} · Reorders ${reorders} · Needs you ${crit}`;
  const emailBody = [
    "GT3 Performance Bar — founder digest",
    "",
    `Revenue (last 7 days, all channels): ${money(rev)}`,
    `   cup ${money(cup)} · pack ${money(packs)} · delivery ${money(deliv)} · office ${money(office)}`,
    `Launch readiness: ${verdict}${blocked ? ` — ${blocked} critical blocked` : ""}`,
    `Open blockers: ${blockers}`,
    `Reorders needed: ${reorders}`,
    `Needs you (unacked critical): ${crit}`,
    "",
    "Open the Pit Wall → Command Board for the full picture.",
  ].join("\n");

  // Recipients = the founders (owner/admin profiles). Email is reliable; SMS best-effort via the
  // customer phone linked to their account.
  const { data: leaders } = await supabaseAdmin.from("profiles").select("id").in("role", ["owner", "admin"]);
  let sent = 0;
  for (const p of (leaders ?? []) as { id: string }[]) {
    const email = await accountEmail(p.id);
    if (email) { if (await sendEmail(email, "📊 GT3 founder digest", emailBody)) sent++; }
    try {
      const { data: cust } = await supabaseAdmin.from("customers").select("phone").eq("user_id", p.id).not("phone", "is", null).limit(1).maybeSingle();
      if (cust?.phone) await sendSMS(cust.phone, `GT3 digest — ${headline}`);
    } catch { /* SMS best-effort */ }
  }

  return NextResponse.json({ ok: true, sent, summary: headline });
}
