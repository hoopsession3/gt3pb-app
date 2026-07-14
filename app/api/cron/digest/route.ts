import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { accountEmail, sendEmail, sendSMS, emailEnabled } from "@/lib/notify";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// FOUNDER DIGEST (on-demand) — composes the same business roll-up as founder_digest_alert() (0208) and
// EMAILS/TEXTS it to the founders (profiles with role owner/admin) via Resend/Twilio. Staff-gated: this
// is the "Send digest now" button. The automated daily version runs in-DB via pg_cron → alerts. Returns
// the composed summary so the button can confirm what went out.

const since7d = () => new Date(Date.now() - 7 * 864e5).toISOString();
const since60d = () => new Date(Date.now() - 60 * 864e5).toISOString();   // payment-id lookback for the walk-up dedupe
const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

async function sum(table: string, filter: (q: any) => any, col = "total_cents"): Promise<number> {
  try {
    const { data } = await filter(supabaseAdmin!.from(table).select(col));
    return (data ?? []).reduce((s: number, r: any) => s + (Number(r[col]) || 0), 0);
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

  // Reconciled revenue (last 7d) — THE basis (0216): every paid app order once + Square WALK-UPS
  // (event_sales rows matching no app order's payment id — the app charges through Square too, and
  // the webhook mirrors every payment, so summing both raw would double-count).
  const [cup, packs, deliv, office] = await Promise.all([
    sum("orders", (q) => q.eq("paid", true).neq("status", "void").gte("created_at", week)),
    sum("drop_orders", (q) => q.eq("paid", true).is("canceled_at", null).gte("created_at", week)),
    sum("delivery_orders", (q) => q.eq("payment_status", "paid").is("canceled_at", null).gte("created_at", week)),
    sum("business_orders", (q) => q.eq("payment_status", "paid").is("canceled_at", null).gte("created_at", week)),
  ]);
  let sq = 0;
  try {
    const [{ data: es }, ...idSets] = await Promise.all([
      supabaseAdmin.from("event_sales").select("square_payment_id, amount_cents").gte("created_at", week),
      supabaseAdmin.from("orders").select("payment_id").not("payment_id", "is", null).gte("created_at", since60d()),
      supabaseAdmin.from("drop_orders").select("payment_id").not("payment_id", "is", null).gte("created_at", since60d()),
      supabaseAdmin.from("delivery_orders").select("payment_id").not("payment_id", "is", null).gte("created_at", since60d()),
    ]);
    const appIds = new Set(idSets.flatMap((r) => (r.data ?? []).map((x: any) => x.payment_id)));
    sq = (es ?? []).reduce((s: number, r: any) => s + (appIds.has(r.square_payment_id) ? 0 : Number(r.amount_cents) || 0), 0);
  } catch { /* walk-up leg is best-effort */ }
  const rev = sq + cup + packs + deliv + office;

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
    `Revenue (last 7 days, reconciled): ${money(rev)}`,
    `   walk-up ${money(sq)} · cup ${money(cup)} · pack ${money(packs)} · delivery ${money(deliv)} · office ${money(office)}`,
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

  return NextResponse.json({ ok: true, sent, emailConfigured: emailEnabled(), summary: headline });
}
