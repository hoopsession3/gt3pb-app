// R21 — A SLOW ANSWER IS NOT A FAILED ONE (0427), on PGlite, at the schema before it (2026-10-18 — the 10/10 audit,
// operations F12; the R21 review of 0423).
//
// cron_watch reads pg_net's answers to the requests the database makes (the push function's webhook). What 0427 holds it
// to: a 4xx/5xx answer or a request never made is a failure, said at once and in the answer's own words (the push
// function names what it couldn't do); a request the database stopped waiting for is said only while nothing in the
// window was answered, two at least; and everything 0423 said of jobs is said as before. Every row is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M427 = readFileSync(join(ROOT, "supabase/migrations/0427_a_slow_answer_is_not_a_failed_one.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const MEMBER = "0c427000-0000-4000-8000-0000000000a1";
const t0 = Date.now();
const db = await fullSchema({ before: "0427" });
console.log(`the schema to 0426 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const n = async (s, p) => Number((await q1(s, p)).n);
await db.exec(`grant usage on schema public to anon, authenticated;`);
await q(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'sam@example.test', now())`, [MEMBER]);

await db.exec(M427);
await db.exec(M427);   // a second paste changes nothing
ok("0427: pasted twice, recorded once", (await n(`select count(*) n from public.schema_migrations where version like '0427%'`)) === 1);
ok("0427: cron_watch reads what was answered (its rule is in the function)", (await n(`select count(*) n from pg_proc where proname = 'cron_watch' and prosrc like '%answered = 0%'`)) === 1);

const answer = (id, minutesAgo, { status = null, timedOut = false, error = null, content = null } = {}) =>
  q(`insert into net._http_response (id, status_code, timed_out, error_msg, content, created) values ($1, $2, $3, $4, $5, now() - make_interval(mins => $6))`,
    [id, status, timedOut, error, content, minutesAgo]);
const line = async () => q(`select title, body, ack_at is not null as closed from public.alerts where kind = 'db_http_failed' order by created_at`);
const reset = async () => { await q(`delete from net._http_response`); await q(`delete from public.alerts where kind = 'db_http_failed'`); };
const watch = () => q(`select public.cron_watch()`);

// ── a slow answer among answers is not a failure ──────────────────────────────────────────────────────────────────────
{
  await reset();
  await answer(1, 3, { status: 200 });
  await answer(2, 2, { timedOut: true, error: "Timeout of 1000 ms reached. Total time: 1001.2 ms" });
  await answer(3, 1, { timedOut: true, error: "Timeout of 1000 ms reached. Total time: 1003.9 ms" });
  await watch();
  ok("0427: two requests the database stopped waiting for, with an answer beside them, are not a failure (0423 said them)", (await line()).length === 0, await line());

  await reset();
  await answer(1, 2, { timedOut: true, error: "Timeout of 1000 ms reached" });
  await watch();
  ok("0427: one timeout alone is not an outage — a cold start on a quiet night", (await line()).length === 0, await line());

  await reset();
  await answer(1, 4, { timedOut: true, error: "Timeout of 1000 ms reached" });
  await answer(2, 1, { timedOut: true, error: "Timeout of 1000 ms reached" });
  await watch();
  const quiet = await line();
  ok("0427: …but every request timing out, two or more and nothing answered, is a function that isn't answering — said",
    quiet.length === 1 && quiet[0].title === "Requests the database sends are failing — 2 in 20 minutes"
      && /The last said: nothing it sent was answered before the database stopped waiting\.$/.test(quiet[0].body), quiet);
}

// ── a failed answer is said at once, in its own words ────────────────────────────────────────────────────────────────
{
  await reset();
  await answer(1, 5, { status: 200 });
  await answer(2, 2, { status: 502, content: "ok — but teams: HTTP 410" });
  await watch();
  const said = await line();
  ok("0427: a 502 from the push function is a failure at once — and says what it couldn't do, after its status",
    said.length === 1 && said[0].title === "Requests the database sends are failing — 1 in 20 minutes"
      && /The last said: HTTP 502 — ok — but teams: HTTP 410\.$/.test(said[0].body), said);

  await reset();
  await answer(1, 3, { status: 500, content: "err: the orders row could not be read (57014)" });
  await answer(2, 1, { status: 401, content: "" });
  await watch();
  const two = await line();
  ok("0427: two failures counted; the newest said, and an empty answer is its status alone",
    two.length === 1 && two[0].title === "Requests the database sends are failing — 2 in 20 minutes" && /The last said: HTTP 401\.$/.test(two[0].body), two);

  await reset();
  await answer(1, 1, { error: "Couldn't resolve host name" });
  await watch();
  const unmade = await line();
  ok("0427: a request that could not be made at all is a failure, in pg_net's words", unmade.length === 1 && /The last said: Couldn't resolve host name\.$/.test(unmade[0].body), unmade);

  await reset();
  await answer(1, 1, { status: 502, content: "x".repeat(400) });
  await watch();
  ok("0427: a long answer is cut short in the alert", (await line())[0]?.body.length < 400, (await line())[0]?.body.length);

  await reset();
  await answer(1, 30, { status: 502, content: "ok — but teams: HTTP 410" });
  await answer(2, 2, { status: 200 });
  await watch();
  ok("0427: a failure older than twenty minutes is not said", (await line()).length === 0);
}

// ── the line closes itself, stays open when unread, and is nobody's to call ──────────────────────────────────────────
{
  await reset();
  await answer(1, 2, { status: 502, content: "ok — but teams: HTTP 410" });
  await watch();
  await q(`update net._http_response set created = now() - interval '30 minutes'`);
  await answer(2, 1, { status: 200 });
  await watch();
  const closed = await line();
  ok("0427: answering again closes the line — the mechanism's ack", closed.length === 1 && closed[0].closed === true, closed);

  await reset();
  await answer(1, 2, { status: 502, content: "ok — but teams: HTTP 410" });
  await watch();
  await q(`update net._http_response set created = now() - interval '30 minutes'`);
  await watch();
  ok("0427: twenty quiet minutes with nothing sent prove nothing — the line stays open (closing then reopened it at every next failure: the R21 review)",
    (await line()).filter((l) => !l.closed).length === 1, await line());

  await reset();
  await answer(1, 4, { error: "Timeout was reached" });
  await answer(2, 2, { status: 200 });
  await watch();
  ok("0427: a timeout pg_net said only in words (an older pg_net, no flag) is a timeout, not a failure", (await line()).length === 0, await line());
  await answer(3, 1, { error: "Operation timed out after 1000 milliseconds" });
  await q(`delete from net._http_response where id = 2`);
  await watch();
  ok("0427: …and two of them with nothing answered are a function not answering", (await line()).length === 1 && /nothing it sent was answered/.test((await line())[0].body), await line());

  await reset();
  await answer(1, 2, { status: 502 });
  await watch();
  await q(`alter table net._http_response rename column content to content_was`);
  const blind = await watch().then(() => null, (e) => e.message);
  await q(`alter table net._http_response rename column content_was to content`);
  ok("0427: pg_net's answers unreadable — the run goes on, and the open line stays open (unread is not answering again)",
    blind === null && (await line()).filter((l) => !l.closed).length === 1, { blind, line: await line() });

  const job = (await q1(`insert into cron.job (jobname, schedule, command) values ('r21-stopped', '*/10 * * * *', 'select 1') returning jobid`)).jobid;
  for (const m of [120, 130, 140, 150]) await q(`insert into cron.job_run_details (jobid, status, return_message, start_time, end_time)
    values ($1, 'succeeded', '', now() - make_interval(mins => $2), now() - make_interval(mins => $2) + interval '1 second')`, [job, m]);
  await watch();
  ok("0427: a job that stopped is still said, as 0423 says it", (await n(`select count(*) n from public.alerts where kind = 'cron_stalled' and title = 'A scheduled job stopped running — r21-stopped' and ack_at is null`)) === 1);

  await db.exec(`select set_config('request.jwt.claim.sub', '${MEMBER}', false); select set_config('request.jwt.claim.role', 'authenticated', false); set role authenticated;`);
  const refused = await db.query(`select public.cron_watch()`).then(() => null, (e) => e.message);
  await db.exec(`reset role;`);
  ok("0427: cron_watch is still nobody's door", /permission denied/i.test(refused ?? ""), refused);
}

console.log(`R21 (0427): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
