import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildInfo } from "@/lib/buildInfo";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs";

// public: the uptime probe — answers ok/not-ok and the build id, nothing else
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
//
// It also answers WHICH BUILD is serving, in `build` (lib/buildInfo.ts). That question used to be
// answered by looking at GitHub and Vercel and inferring — which is how a deploy got called landed
// three times when it had not been checked at all. Both the healthy and the unhealthy response
// carry it, because "which commit is broken" is exactly what you want at 503. `build.known` is
// false rather than guessed when the platform did not say.
// THE APP'S OWN QUESTIONS DO NOT FEED THE WATCHDOG (R13 — the 10/10 audit's operations pass, F6). Every web tab that came
// back after a minute asked this route which build was live (components/FreshTab), and every ask stamped the heartbeat:
// while customers used the app, the watchdog could not see the uptime check stop — it was fed by the traffic. The app now
// asks with ?from=app: FreshTab's question (which build) is answered without the database at all, the crew's Integrations
// card gets the real check without the stamp. Any other caller — the scheduled check, a monitor Ryan points here — is the
// probe, and feeds it as before.
async function get(req: Request) {
  const noStore = { "cache-control": "no-store" };
  const build = buildInfo();
  const from = new URL(req.url).searchParams.get("from");
  if (from === "app-build") return NextResponse.json({ ok: true, build }, { headers: noStore });
  try {
    if (!supabaseAdmin) return NextResponse.json({ ok: false, why: "db unconfigured", build }, { status: 503, headers: noStore });
    const t0 = Date.now();
    // A real round-trip, not a static pong — head-count on a tiny always-present table.
    const { error } = await supabaseAdmin.from("admin_emails").select("email", { count: "exact", head: true });
    if (error) throw error;
    // Feed the watchdog — the probe only (above). Best-effort but awaited — serverless won't flush a dangling write.
    if (from !== "app") {
      const beat = await supabaseAdmin.from("ops_heartbeat").upsert({ id: 1, seen_at: new Date().toISOString(), source: "health" });
      if (beat.error) console.warn(`health: the watchdog's heartbeat wasn't written — ${beat.error.message}`);   // the probe still answers; said (R12b)
    }
    return NextResponse.json({ ok: true, db_ms: Date.now() - t0, build }, { headers: noStore });
  } catch {
    return NextResponse.json({ ok: false, build }, { status: 503, headers: noStore });
  }
}

export const GET = route("health", get);
