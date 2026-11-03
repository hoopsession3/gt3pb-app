// IMS8 · RESEARCH SETTLEMENT ON A REAL POSTGRESQL SERVER, MANY CONNECTIONS AT ONCE (0473). Ryan, 2026-11-03: "Run research
// settlement against real PostgreSQL with multiple connections: same-key retries, competing keys, concurrent settlement
// and settlement versus expiry/auto-charge." PGlite has one connection, so these can't run there.
//
// Opt-in: PG_URL (a superuser connection to a server this may create a database on) and PG_MODULE (where `pg` is
// installed). Without them it says NOT RUN and exits 2 — never a pass. Every person and run is made up.
import { realSchema, pgClientClass } from "./fixtures/schema.pg.mjs";

if (!process.env.PG_URL) { console.log("IMS8 SETTLEMENT ON REAL POSTGRESQL: NOT RUN — no PG_URL (see scripts/fixtures/schema.pg.mjs)."); process.exit(2); }
const Client = pgClientClass();
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c473000-0000-4000-8000-0000000000e1";

const s = await realSchema({});
const connect = async () => { const c = new Client({ connectionString: s.url }); await c.connect(); return c; };
const root = await connect();
const ver = (await root.query(`show server_version`)).rows[0].server_version;
await root.query(`insert into auth.users (id, email) values ($1, 'owner@example.test')`, [OWNER]);
await root.query(`update public.profiles set role = 'owner', tenant_id = $2 where id = $1`, [OWNER, T1]);
const intake = (await root.query(`insert into public.std_intakes (kind, input, request_hash, tenant_id) values ('describe', 'a bench', repeat('c', 64), $1) returning id`, [T1])).rows[0].id;
await root.query(`insert into public.std_research_budget (tenant_id, daily_cents, per_run_cents) values ($1, 10000, 50) on conflict (tenant_id) do update set daily_cents = 10000, per_run_cents = 50`, [T1]);

// A session on its own connection: the claims and role a request would carry, inside one transaction (left open
// when `hold` is set, so its row locks stay held until commit()).
const session = async (who, sql, params, { hold = false } = {}) => {
  const c = await connect();
  const role = who === "service" ? "service_role" : "authenticated";
  const sub = who === "service" ? "" : who;
  await c.query("begin");
  await c.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)`,
    [sub, role, JSON.stringify({ sub, role, aal: "aal1" })]);
  await c.query(`set local role ${role}`);
  const p = c.query(sql, params).then((r) => ({ rows: r.rows, code: null }), (e) => ({ rows: [], code: e.code ?? "?", error: e.message }));
  if (hold) return { c, result: p, commit: async () => { await p; await c.query("commit").catch(() => c.query("rollback")); await c.end(); } };
  const r = await p;
  await c.query(r.code ? "rollback" : "commit"); await c.end();
  return r;
};
const reserve = async () => (await session(OWNER, `select public.std_research_reserve($1, 'light') run`, [intake])).rows[0]?.run;
const usage = JSON.stringify({ searches: 2, fetches: 1, input_tokens: 4000, output_tokens: 900 });
const SETTLE = `select public.std_research_settle_server($1, $2, $3::jsonb, $4, 'done', null, $5) c`;
const key = (n) => `0c473000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const run1 = async (r) => (await root.query(`select outcome, charged_cents, settle_key from public.std_research_runs where id = $1`, [r])).rows[0];

// 1. The same key, twelve connections at once (a retry storm): one write, twelve identical answers.
{
  const r = await reserve();
  const K = key(1);
  const all = await Promise.all(Array.from({ length: 12 }, () => session("service", SETTLE, [T1, r, usage, 7.25, K])));
  ok("twelve concurrent settles with the same key: every one answers, with the same charge", all.every((x) => !x.code && Number(x.rows[0].c) === 7.25), all.filter((x) => x.code));
  const row = await run1(r);
  ok("…and the run was written once: done, 7.25, that key", row.outcome === "done" && Number(row.charged_cents) === 7.25 && row.settle_key === K, row);
  const audit = (await root.query(`select count(*)::int n from public.admin_audit where table_name = 'std_research_runs' and row_pk = $1 and action = 'UPDATE'`, [r])).rows[0].n;
  ok("…one change in the run's history, not twelve", audit === 1, audit);
}

// 2. Twelve different keys at once (two servers both think they own the run): exactly one wins, the rest are refused.
{
  const r = await reserve();
  const all = await Promise.all(Array.from({ length: 12 }, (_, i) => session("service", SETTLE, [T1, r, usage, 1 + i, key(100 + i)])));
  const won = all.filter((x) => !x.code), lost = all.filter((x) => x.code);
  ok("twelve concurrent settles with competing keys: exactly one is taken", won.length === 1, all.map((x) => x.code ?? Number(x.rows[0].c)));
  ok("…the other eleven are refused PT409, none half-applied", lost.length === 11 && lost.every((x) => x.code === "PT409"), lost.map((x) => x.code));
  const row = await run1(r);
  ok("…the run holds the winner's charge", Number(row.charged_cents) === Number(won[0]?.rows[0].c), { row, won: won[0]?.rows });
}

// 3. Many runs settled at once while reservations keep coming: the day's count is the sum of what was charged, and the
//    cap holds (each reservation reads the day under the budget row's lock).
{
  await root.query(`update public.std_research_budget set daily_cents = 2000 where tenant_id = $1`, [T1]);
  const spent0 = Number((await root.query(`select coalesce(sum(charged_cents), 0) s from public.std_research_runs where tenant_id = $1 and started_at >= date_trunc('day', now())`, [T1])).rows[0].s);
  const room = Math.floor((2000 - spent0) / 50);
  const tries = await Promise.all(Array.from({ length: room + 8 }, () => session(OWNER, `select public.std_research_reserve($1, 'light') run`, [intake])));
  const got = tries.filter((x) => !x.code).map((x) => x.rows[0].run), refused = tries.filter((x) => x.code);
  ok(`${room + 8} concurrent reservations with room for ${room}: exactly ${room} taken`, got.length === room, { got: got.length, codes: [...new Set(refused.map((x) => x.code))] });
  ok("…the rest refused as over budget (PT429), not as errors", refused.every((x) => x.code === "PT429"), refused.map((x) => x.code));
  const settled = await Promise.all(got.map((r, i) => session("service", SETTLE, [T1, r, usage, 10 + (i % 3), key(500 + i)])));
  ok("…and all of them settled at once, each by its own key", settled.every((x) => !x.code), settled.filter((x) => x.code));
  const day = Number((await root.query(`select coalesce(sum(charged_cents), 0) s from public.std_research_runs where tenant_id = $1 and started_at >= date_trunc('day', now())`, [T1])).rows[0].s);
  const want = spent0 + got.reduce((a, _, i) => a + 10 + (i % 3), 0);   // each run counted 50 while running, then what it cost
  ok("…the day's count is exactly what was charged", Math.abs(day - want) < 1e-9, { day, want });
  await root.query(`update public.std_research_budget set daily_cents = 10000 where tenant_id = $1`, [T1]);
}

// 4a. Settle first, the expiry second: the settle holds the run's lock; a reservation that would close it as abandoned
//     waits, then finds it settled and leaves it alone.
{
  const r = await reserve();
  await root.query(`update public.std_research_runs set deadline_at = now() - interval '1 second' where id = $1`, [r]);
  const a = await session("service", SETTLE, [T1, r, usage, 9.5, key(900)], { hold: true });
  await new Promise((res) => setTimeout(res, 150));
  const b = session(OWNER, `select public.std_research_reserve($1, 'light') run`, [intake]);
  await new Promise((res) => setTimeout(res, 300));
  const waiting = (await root.query(`select count(*)::int n from pg_stat_activity where wait_event_type = 'Lock' and datname = $1`, [s.name])).rows[0].n;
  ok("settle vs expiry, settle first: the reservation waits on the settle's lock", waiting >= 1, waiting);
  await a.commit();
  const rb = await b;
  ok("…then goes on (its own run reserved)", !rb.code, rb);
  const row = await run1(r);
  ok("…and the settled run keeps the settle's charge and outcome (not closed as unreported)", row.outcome === "done" && Number(row.charged_cents) === 9.5, row);
}

// 4b. The expiry first, the settle second: the reservation closes the late run at its full reservation; the settle that
//     was waiting then finds it closed by its deadline, records its report, and charges the higher of the two.
for (const [label, cost, want] of [["cheaper than its reservation", 9.5, 50], ["dearer than its reservation", 72, 72]]) {
  const r = await reserve();
  await root.query(`update public.std_research_runs set deadline_at = now() - interval '1 second' where id = $1`, [r]);
  const b = await session(OWNER, `select public.std_research_reserve($1, 'light') run`, [intake], { hold: true });
  await new Promise((res) => setTimeout(res, 150));
  const a = session("service", SETTLE, [T1, r, usage, cost, key(950 + Math.round(cost))]);
  await new Promise((res) => setTimeout(res, 300));
  const waiting = (await root.query(`select count(*)::int n from pg_stat_activity where wait_event_type = 'Lock' and datname = $1`, [s.name])).rows[0].n;
  ok(`settle vs expiry, expiry first (${label}): the settle waits on the reservation's lock`, waiting >= 1, waiting);
  await b.commit();
  const ra = await a;
  const row = await run1(r);
  ok(`…then takes the late report and charges the higher of reservation and cost (${want})`, !ra.code && Number(ra.rows[0].c) === want && Number(row.charged_cents) === want && row.outcome === "done", { ra, row });
  const again = await session("service", SETTLE, [T1, r, usage, cost, key(950 + Math.round(cost))]);
  ok("…a retry of that late settle gets the same answer", Number(again.rows[0]?.c) === want, again);
  ok("…another key is refused", (await session("service", SETTLE, [T1, r, usage, 0, key(990)])).code === "PT409");
}

// 5. A run closed by its deadline is not reopened by a settle that says less than was counted.
{
  const r = await reserve();
  await root.query(`update public.std_research_runs set deadline_at = now() - interval '1 second' where id = $1`, [r]);
  await reserve();   // closes r at 50
  const low = await session("service", SETTLE, [T1, r, JSON.stringify({ searches: 0, fetches: 0, input_tokens: 1, output_tokens: 1 }), 0, key(995)]);
  ok("a late report of $0 can't lower a closed run below its reservation", Number(low.rows[0]?.c) === 50 && Number((await run1(r)).charged_cents) === 50, low);
}

// 6. Sessions still can't settle, even concurrently with the server.
{
  const r = await reserve();
  const [srv, own] = await Promise.all([session("service", SETTLE, [T1, r, usage, 5, key(999)]), session(OWNER, SETTLE, [T1, r, usage, 0, key(998)])]);
  ok("an owner's session racing the server is refused (42501); the server's settle stands", own.code === "42501" && !srv.code && Number((await run1(r)).charged_cents) === 5, { own: own.code, srv });
}

await root.end();
await s.drop();
console.log(`  · PostgreSQL ${ver}, real connections (production runs 17.6)`);
console.log(`IMS8 SETTLEMENT ON REAL POSTGRESQL (0473, many connections): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
