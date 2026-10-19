// R41 — THE SCHEDULED CHECK IS JUDGED BY THE GAP IT KEEPS (0440), IN POSTGRES (2026-10-19 — Ryan: an outside monitor for
// the site's uptime, and six hours for GitHub's check).
//
// The whole schema to 0439 is loaded; the old watchdog (0340's ninety minutes) is run against a check two hours quiet —
// the line GitHub's real cadence opened most days — then 0440, twice. What is read: the old line retired by a mechanism;
// a check two hours or five hours fifty-nine quiet raising nothing; six hours and a minute raising one line that names
// GitHub's check and the outside monitor; the same silence counted once; a check back rewriting the line to say so; no
// API role able to run it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M440 = readFileSync(join(ROOT, "supabase/migrations/0440_the_scheduled_check_is_judged_by_the_gap_it_keeps.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const t0 = Date.now();
const db = await fullSchema({ before: "0440" });
console.log(`the schema to 0439 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const quietFor = (minutes) => db.exec(`insert into public.ops_heartbeat (id, seen_at, source) values (1, now() - interval '${minutes} minutes', 'health')
  on conflict (id) do update set seen_at = excluded.seen_at`);
const lines = () => q(`select id, severity, title, body, occurrences, ack_at, ack_by from public.alerts where kind = 'heartbeat_stale' order by created_at, id`);
const open = async () => (await lines()).filter((l) => l.ack_at === null);
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);

// ── before 0440: two hours quiet is a line ─────────────────────────────────────────────────────────────────────────────
await quietFor(120);
await db.exec(`select public.heartbeat_watchdog()`);
const before = await open();
ok("before 0440: a check two hours quiet — GitHub's ordinary gap — opened 'The uptime check went quiet'",
  before.length === 1 && before[0].title === "The uptime check went quiet", before);

await db.exec(M440);
await db.exec(M440);
ok("0440 twice: recorded (applied twice), one watchdog", (await q1(`select applied_count::int n from public.schema_migrations where version like '0440%'`)).n === 2
  && (await q1(`select count(*)::int n from pg_proc where proname = 'heartbeat_watchdog'`)).n === 1);
const retired = (await lines()).find((l) => l.id === before[0].id);
ok("…and the line the old rule opened is retired by a mechanism — acknowledged, by nobody", retired?.ack_at !== null && retired?.ack_by === null, retired);

// ── the new wait ──────────────────────────────────────────────────────────────────────────────────────────────────────
await quietFor(120);
await db.exec(`select public.heartbeat_watchdog()`);
ok("two hours quiet raises nothing now", (await open()).length === 0, await open());
await quietFor(359);
await db.exec(`select public.heartbeat_watchdog()`);
ok("…nor five hours fifty-nine — longer than any gap GitHub has kept (5h 45m)", (await open()).length === 0, await open());
await quietFor(361);
await db.exec(`select public.heartbeat_watchdog()`);
const raised = await open();
ok("six hours and a minute raises one important line, under its old title (the push function names it)",
  raised.length === 1 && raised[0].severity === "important" && raised[0].title === "The uptime check went quiet", raised);
ok("…that says what it is about: GitHub's check, how long, why it stops, and that the site's uptime is the outside monitor's",
  /^GitHub's production check hasn't reached \/api\/health since .+ ET — over 6 hours\. /.test(raised[0]?.body ?? "")
    && /pauses it after 60 days without a push/.test(raised[0]?.body ?? "") && /the outside monitor's to say/.test(raised[0]?.body ?? ""), raised[0]?.body);
await db.exec(`select public.heartbeat_watchdog()`);
const again = await open();
ok("the same silence asked about again is the same line, counted once", again.length === 1 && again[0].id === raised[0].id && Number(again[0].occurrences) === Number(raised[0].occurrences), again);
await quietFor(0);
await db.exec(`select public.heartbeat_watchdog()`);
const back = (await lines()).find((l) => l.id === raised[0].id);
ok("GitHub's check back: the line stops saying nothing has checked — it says it went quiet and is running again",
  /^GitHub's check went quiet after .+ ET and was still quiet at .+ ET\. It has been running again since\./.test(back?.body ?? ""), back?.body);

// ── who may run it ────────────────────────────────────────────────────────────────────────────────────────────────────
const fn = (await q1(`select prosrc from pg_proc where proname = 'heartbeat_watchdog'`)).prosrc;
ok("the threshold is six hours, written the way the smoke reads it", /hb > now\(\) - interval '360 minutes'/.test(fn) && /^-- heartbeat-stale-after: 360$/m.test(M440), fn.slice(0, 200));
ok("no API role may run it — a stranger can't make it write to the owners' inbox",
  (await q1(`select has_function_privilege('anon', 'public.heartbeat_watchdog()', 'execute') a, has_function_privilege('authenticated', 'public.heartbeat_watchdog()', 'execute') b`)).a === false
  && (await q1(`select has_function_privilege('authenticated', 'public.heartbeat_watchdog()', 'execute') b`)).b === false);

console.log(`R41 — THE SCHEDULED CHECK, BY THE GAP IT KEEPS (0440, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
