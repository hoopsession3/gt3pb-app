import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

// HEALTH CHECK (2026-07-30 — the "crash/error/outage email" round, part 2). Point any free
// uptime monitor (UptimeRobot, BetterStack, …) at GET /api/health every few minutes:
//
//   200 {ok:true}  — Vercel is serving AND Supabase answers a real query
//   503 {ok:false} — the app is up but its database isn't (the monitor emails you)
//   no response    — Vercel itself is down (the monitor emails you; nothing app-side can)
//
// Each healthy check also stamps ops_heartbeat, which the pg_cron watchdog (part 3, migration
// 0255) watches from the OTHER side: if stamps stop arriving while Supabase is still up, the
// watchdog raises one critical alert → push + admin email. Monitor and watchdog deliberately
// cover each other's blind spot — the monitor sees "app down", the watchdog sees "app can't
// reach the database it thinks it's using".
export async function GET() {
  const noStore = { "cache-control": "no-store" };
  try {
    if (!supabaseAdmin) return NextResponse.json({ ok: false, why: "db unconfigured" }, { status: 503, headers: noStore });
    const t0 = Date.now();
    // A real round-trip, not a static pong — head-count on a tiny always-present table.
    const { error } = await supabaseAdmin.from("admin_emails").select("email", { count: "exact", head: true });
    if (error) throw error;
    // Feed the watchdog. Best-effort but awaited — serverless won't flush a dangling write.
    await supabaseAdmin.from("ops_heartbeat").upsert({ id: 1, seen_at: new Date().toISOString(), source: "health" });
    return NextResponse.json({ ok: true, db_ms: Date.now() - t0 }, { headers: noStore });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: noStore });
  }
}
