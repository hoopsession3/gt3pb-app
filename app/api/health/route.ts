import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildInfo } from "@/lib/buildInfo";
import { route } from "@/lib/apiRoute";
import { tokenOk } from "@/lib/webhookSignature";
import { CRON_JOBS, PUSH_HOOKS } from "@/lib/opsWatch";

export const runtime = "nodejs";

// public: the uptime probe — answers ok/not-ok, the build id, and whether the scheduled jobs run and the push hooks are on (an age and counts), nothing else
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
// THE PROBE, NAMED (R19, 2026-10-17 — the 10/10 audit, operations F6). "Any other caller" was anyone: a crawler, a link
// preview, a script — each GET kept the watchdog fed while the real check could have stopped. With HEALTH_PROBE_SECRET
// set, only a check that carries it (the x-health-probe header — the scheduled check sends it from its own secret)
// feeds the watchdog; everyone else gets the same answer and no stamp. Unset, nothing changes.
// Every outside check is told whether it was taken as the probe (`probe`, R19 review): a site's secret and the check's
// that differ — or a site given one before the check was — would otherwise starve the watchdog in silence, and the
// scheduled check fails on `probe: false` instead. Both are read trimmed — a secret pasted with its newline is the same
// secret. A preview deployment never feeds production's watchdog (R19 review): it may share production's database.
// THE WATCHER, WATCHED, AND THE PUSH WEBHOOKS COUNTED (R24, 2026-10-18 — the 10/10 audit, database F8 and F6, operations
// F11 and F19). pg_cron runs every scheduled job and cron_watch says one that fails or stops — but nothing in the database
// can say that pg_cron, or cron_watch, stopped; and ten of the webhooks that carry pushes were made in the dashboard, in
// no migration, where one switched off is a push that never goes. This asks from outside (0430 ops_alive, lib/opsWatch):
// `cron.ok` is false when cron_watch hasn't finished in 25 minutes (it runs every ten) or a job the applied migrations
// made is missing or off; `hooks.ok` when a push webhook is not there or off. The half-hourly production check fails on
// either. Counts and an age only. null: not measured — 0430 not pasted yet, or the question went unanswered.
const CRON_STALE_MIN = 25;
type OpsState = { cron: { ok: boolean; watched_min: number | null; missing: number } | null; hooks: { ok: boolean; off: number } | null };
async function opsState(): Promise<OpsState> {
  const none: OpsState = { cron: null, hooks: null };
  if (!supabaseAdmin) return none;
  try {
    const { data, error } = await supabaseAdmin.rpc("ops_alive", {
      p_jobs: CRON_JOBS.map(([job]) => job), p_from: CRON_JOBS.map(([, madeBy]) => madeBy), p_hooks: [...PUSH_HOOKS],
    });
    if (error || !data || typeof data !== "object") return none;
    const d = data as { watched_at?: string | null; missing?: number; hooks_off?: number };
    const at = Date.parse(d.watched_at ?? "");
    const watched_min = Number.isFinite(at) ? Math.max(0, Math.floor((Date.now() - at) / 60_000)) : null;
    const missing = Number(d.missing) || 0, off = Number(d.hooks_off) || 0;
    return {
      cron: { ok: watched_min !== null && watched_min <= CRON_STALE_MIN && missing === 0, watched_min, missing },
      hooks: { ok: off === 0, off },
    };
  } catch { return none; }
}

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
    const secret = (process.env.HEALTH_PROBE_SECRET ?? "").trim();
    const sent = req.headers.get("x-health-probe");
    const probe = from !== "app" && (!secret || tokenOk(sent?.trim(), secret));
    const stamps = process.env.VERCEL_ENV !== "preview" && process.env.VERCEL_ENV !== "development";
    if (probe && stamps) {
      const beat = await supabaseAdmin.from("ops_heartbeat").upsert({ id: 1, seen_at: new Date().toISOString(), source: "health" });
      if (beat.error) console.warn(`health: the watchdog's heartbeat wasn't written — ${beat.error.message}`);   // the probe still answers; said (R12b)
    }
    const db_ms = Date.now() - t0;
    const { cron, hooks } = await opsState();
    return NextResponse.json({ ok: true, db_ms, build, cron, hooks, ...(from !== "app" ? { probe } : {}) }, { headers: noStore });
  } catch {
    return NextResponse.json({ ok: false, build }, { status: 503, headers: noStore });
  }
}

export const GET = route("health", get);
