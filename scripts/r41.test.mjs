// R41 — THE UPTIME CHECK IS OUTSIDE, AND GITHUB'S CHECK IS JUDGED BY THE GAP IT KEEPS (2026-10-19 — Ryan: "Outside monitor
// + 6h").
//
//   1 · 0440 as text: the six hours, the marker the smoke reads, the old line retired, the rules every migration keeps.
//       (It is run in Postgres in db.r41.test.mjs.)
//   2 · the paste file carries it, its own transaction.
//   3 · the smoke holds the pair: six hours at least, and the outside monitor written down.
//   4 · RELEASE.md says how to set the monitor and what its email means; production.yml says what its schedule really is.
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ── 1 · 0440 as text ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const m = read("supabase/migrations/0440_the_scheduled_check_is_judged_by_the_gap_it_keeps.sql");
  ok("0440 waits six hours, and says so where the smoke reads it", /^-- heartbeat-stale-after: 360$/m.test(m) && /if hb > now\(\) - interval '360 minutes' then/.test(m)
    && !/interval '90 minutes'/.test(m));
  ok("…its line names GitHub's check and leaves the site's uptime to the outside monitor, under the title the push function knows",
    /'The uptime check went quiet',/.test(m) && /GitHub''s production check hasn''t reached \/api\/health since/.test(m) && /is the outside monitor''s to say/.test(m)
      && /heartbeat_stale: "The uptime check went quiet"/.test(read("supabase/functions/push/policy.ts")));
  ok("…the line the old rule opened is retired by a mechanism, not restated", /update public\.alerts\n\s+set ack_at = now\(\)\n\s+where kind = 'heartbeat_stale'\n\s+and ack_at is null;/.test(m));
  ok("…and it keeps every migration's rules: a lock wait first, no API role to run it, recorded, its changelog said",
    /^set lock_timeout = '5s';$/m.test(m) && m.indexOf("set lock_timeout") < m.indexOf("create or replace function")
      && /revoke all on function public\.heartbeat_watchdog\(\) from public, anon, authenticated;/.test(m)
      && /select public\.record_migration\('0440_the_scheduled_check_is_judged_by_the_gap_it_keeps'\);/.test(m) && /^-- changelog: none/m.test(m) && /^reset lock_timeout;/m.test(m));
}

// ── 2 · the paste file ────────────────────────────────────────────────────────────────────────────────────────────────
{
  const paste = read("supabase/APPLY_ALL_PENDING.sql");
  // Until production's ledger holds it (R45: 0440 was applied 2026-10-20 — the paste moved on, and carries none of the three).
  ok("the paste file carries 0440, its own transaction, after 0438 and 0439 — until production holds them",
    (/^-- pending-from: 0440$/m.test(paste) && /^-- pending-count: 3$/m.test(paste)
      && paste.indexOf("begin;   -- 0438,") < paste.indexOf("begin;   -- 0439,") && paste.indexOf("begin;   -- 0439,") < paste.indexOf("begin;   -- 0440,"))
    || (!/^-- pending-from: 04[0-3]\d$/m.test(paste) && !/begin;   -- 04(38|39|40),/.test(paste)));
}

// ── 3 · the smoke holds the pair ──────────────────────────────────────────────────────────────────────────────────────
{
  const sm = read("scripts/smoke.cjs");
  ok("the smoke holds the watchdog to six hours at least, and the outside monitor to being written down",
    /Number\(declared\[1\]\) >= 360/.test(sm) && /## The outside monitor/.test(sm) && /api\\\/health/.test(sm));
}

// ── 4 · RELEASE.md and production.yml ─────────────────────────────────────────────────────────────────────────────────
{
  const rel = read("RELEASE.md");
  const sec = rel.slice(rel.indexOf("## The outside monitor"), rel.indexOf("## What a red Production run means"));
  ok("RELEASE.md: the outside monitor — the address, the keyword or the 503, every three minutes, email; no secret, feeding nothing",
    rel.indexOf("## The outside monitor") > 0 && /`https:\/\/app\.gt3pb\.com\/api\/health`/.test(sec) && /`"ok":true`/.test(sec) && /answers 503 when the database doesn't/.test(sec)
      && /Every 3 minutes; alert by email/.test(sec) && /No header or secret/.test(sec) && /the watchdog listens for GitHub's check only/.test(sec), sec.slice(0, 600));
  ok("…what its email means and where to go, and that GitHub's schedule is no uptime check (0440's six hours)",
    /Its email means the site or its database isn't answering/.test(sec) && /CONTINUITY_RUNBOOK\.md/.test(sec) && /every two to six hours, so it is no uptime\s+check/.test(sec)
      && /waits six hours for it before it says it stopped \(0440\)/.test(sec));
  const wf = read(".github/workflows/production.yml");
  ok("production.yml says what its schedule really is: GitHub's room, 101 runs where it names about 800, the longest gap, the monitor outside",
    /101 scheduled runs from 2026-10-02 to\s+#\s+10-19 where this names about 800, the longest gap 5h 45m/.test(wf) && /an outside monitor is, every few minutes/.test(wf) && /\(0440\) waits six hours/.test(wf));
}

{
  const pkg = JSON.parse(read("package.json"));
  ok("this file runs with every test, and 0440's own with the database's",
    /node scripts\/r40\.test\.mjs && node scripts\/r41\.test\.mjs/.test(pkg.scripts.test) && /node scripts\/db\.r39\.test\.mjs && node scripts\/db\.r41\.test\.mjs/.test(pkg.scripts["db:test"]));
}

console.log(`\nR41 — THE UPTIME CHECK IS OUTSIDE: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
