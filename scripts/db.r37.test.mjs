// R37 — A WAY BACK WITHOUT THE AUTHENTICATOR (0438), IN POSTGRES (2026-10-19 — the fresh audit's UX11-10; Ryan:
// "Recovery codes").
//
// The whole schema to 0437 is loaded, then 0438 — twice. two_step_recovery_codes is there with its row security on and
// no policy, and no API role can read, write or count it: not signed out, not as the person whose codes they are, not
// with the authenticator's code given. The server's role reads and writes it. What it keeps has a hash's form (a code
// kept as itself is refused), the account's own key leads an index, and deleting the account takes its codes with it.
// Every person is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M438 = readFileSync(join(ROOT, "supabase/migrations/0438_a_way_back_without_the_authenticator.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const ALEX = "0c438000-0000-4000-8000-0000000000c1";   // an owner, with an authenticator
const RAE = "0c438000-0000-4000-8000-0000000000c2";    // an admin, with one too
const HASH = "s1$made-up-salt$made-up-hash";   // the form lib/recoveryCodes keeps (s1$salt$hash); made up

const t0 = Date.now();
const db = await fullSchema({ before: "0438" });
console.log(`the schema to 0437 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);
  select set_config('request.jwt.claims', '', false);`);
// As PostgREST calls it: the role, and the token's claims — aal1, or aal2 with the authenticator's code given.
const as = async (who, aal, sql, params) => {
  const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
  const sub = who && who !== "service" ? who : "";
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub}', false); select set_config('request.jwt.claim.role', '${role}', false);
    select set_config('request.jwt.claims', '${JSON.stringify({ sub, role, aal })}', false); set role ${role};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null, code: null }; }
  catch (e) { return { rows: [], error: String(e.message || e).split("\n")[0], code: e.code ?? null }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated, service_role;
  alter role service_role bypassrls;`);   // as Supabase makes it: the server's role reads and writes past every policy
for (const [id, role, name] of [[ALEX, "owner", "Alex Rivera"], [RAE, "admin", "Rae Kim"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name.split(" ")[0].toLowerCase()}.r37@example.test`]);
  await q(`update public.profiles set role = $2, display_name = $3 where id = $1`, [id, role, name]);
  await q(`insert into auth.mfa_factors (user_id, friendly_name, status) values ($1, 'made-up authenticator', 'verified')`, [id]);
}

// ── before 0438 ────────────────────────────────────────────────────────────────────────────────────────────────────
ok("before 0438: no two_step_recovery_codes", (await q1(`select to_regclass('public.two_step_recovery_codes') is null as v`)).v === true);

await db.exec(M438);
await db.exec(M438);
ok("0438 twice: recorded (applied twice), one changelog line, one table and one index — nothing made twice",
  (await q1(`select applied_count::int n from public.schema_migrations where version like '0438%'`)).n === 2
  && (await q1(`select count(*)::int n from public.changelog where title = 'A way back without your authenticator'`)).n === 1
  && (await q1(`select count(*)::int n from pg_indexes where tablename = 'two_step_recovery_codes' and indexname = 'two_step_recovery_codes_user_id_fk_idx'`)).n === 1);

// ── closed to every API role ───────────────────────────────────────────────────────────────────────────────────────
const t = await q1(`select relrowsecurity rls, relforcerowsecurity force from pg_class where oid = 'public.two_step_recovery_codes'::regclass`);
const policies = (await q1(`select count(*)::int n from pg_policy where polrelid = 'public.two_step_recovery_codes'::regclass`)).n;
ok("row security on, and no policy at all", t.rls === true && policies === 0, { t, policies });
const PRIVS = ["select", "insert", "update", "delete", "truncate", "references", "trigger"];
const held = async (role) => (await q(`select p from unnest($1::text[]) p where has_table_privilege($2, 'public.two_step_recovery_codes', p)`, [PRIVS, role])).map((r) => r.p);
const anonHeld = await held("anon"), authHeld = await held("authenticated"), serverHeld = await held("service_role");
ok("signed out (anon) and signed in (authenticated): no privilege on it — not even the default grant every table here gets",
  anonHeld.length === 0 && authHeld.length === 0, { anonHeld, authHeld });
ok("…the server's role reads and writes it (select, insert, update, delete)", ["select", "insert", "update", "delete"].every((p) => serverHeld.includes(p)), serverHeld);
const col = await q1(`select count(*)::int n from information_schema.column_privileges where table_name = 'two_step_recovery_codes' and grantee in ('anon', 'authenticated')`);
ok("…and no column of it is granted to either, one by one", col.n === 0, col);

// The server keeps ALEX's ten (as app/api/two-step/codes does), and RAE's.
for (const who of [ALEX, RAE]) {
  const r = await as("service", null, `insert into public.two_step_recovery_codes (user_id, code_hash) select $1, $2 from generate_series(1, 10)`, [who, HASH]);
  ok(`the server keeps ten for ${who === ALEX ? "an owner" : "an admin"}`, r.error === null, r);
}
for (const [who, aal, label] of [[null, null, "signed out"], [ALEX, "aal1", "the owner, the code not given"], [ALEX, "aal2", "the owner, with the code given"], [RAE, "aal2", "an admin, with the code"]]) {
  const read = await as(who, aal, `select id, code_hash from public.two_step_recovery_codes`);
  const counted = await as(who, aal, `select count(*) from public.two_step_recovery_codes where user_id = '${ALEX}'`);
  const wrote = await as(who, aal, `insert into public.two_step_recovery_codes (user_id, code_hash) values ('${who ?? ALEX}', '${HASH}')`);
  const used = await as(who, aal, `update public.two_step_recovery_codes set used_at = null where user_id = '${ALEX}'`);
  const gone = await as(who, aal, `delete from public.two_step_recovery_codes where user_id = '${ALEX}'`);
  ok(`${label}: can't read, count, add, give back or delete a code — refused (42501), never an empty answer`,
    [read, counted, wrote, used, gone].every((r) => r.code === "42501" && /permission denied/.test(r.error ?? "")), [read, counted, wrote, used, gone].map((r) => r.code));
}
ok("…and every code the server kept is there still", (await q1(`select count(*)::int n from public.two_step_recovery_codes`)).n === 20);

// ── what it keeps ─────────────────────────────────────────────────────────────────────────────────────────────────
const plain = await as("service", null, `insert into public.two_step_recovery_codes (user_id, code_hash) values ($1, 'ABCDE-23456')`, [ALEX]);
const nobody = await as("service", null, `insert into public.two_step_recovery_codes (code_hash) values ($1)`, [HASH]);
const stranger = await as("service", null, `insert into public.two_step_recovery_codes (user_id, code_hash) values ('0c438000-0000-4000-8000-0000000000ff', $1)`, [HASH]);
ok("a code kept as itself is refused (the check holds a hash's form, s1$…), as is a code for nobody or for no account",
  plain.code === "23514" && nobody.code === "23502" && stranger.code === "23503", [plain.code, nobody.code, stranger.code]);
const fresh = await q1(`select made_at is not null as made, used_at is null as unused from public.two_step_recovery_codes limit 1`);
ok("each row says when it was made, and is unused until a recovery marks it", fresh.made === true && fresh.unused === true, fresh);
const lead = await q1(`select pg_get_indexdef(i.oid) d from pg_class i where i.relname = 'two_step_recovery_codes_user_id_fk_idx'`);
ok("the person's codes — and which are unused — found by an index the account's key leads (0435's rule)", /\(user_id, used_at\)/.test(lead?.d ?? ""), lead);
const plan = await q(`explain select id from public.two_step_recovery_codes where user_id = '${ALEX}' and used_at is null`);
ok("…which the planner can use for the recovery door's own read", plan.length > 0);

// ── an account deleted takes its codes ───────────────────────────────────────────────────────────────────────────────
// The admin's account (the only owner's is refused by 0353's erasure, as it should be).
await q(`delete from auth.users where id = $1`, [RAE]);
ok("deleting an account deletes its codes (on delete cascade) — another person's stay",
  (await q1(`select count(*)::int n from public.two_step_recovery_codes where user_id = $1`, [RAE])).n === 0
  && (await q1(`select count(*)::int n from public.two_step_recovery_codes where user_id = $1`, [ALEX])).n === 10);

// ── the paste stays a paste ──────────────────────────────────────────────────────────────────────────────────────────
ok("0438: its first statement is `set lock_timeout = '5s'`, it resets it last, it states its changelog and existing rows",
  /^set lock_timeout = '5s';$/m.test(M438) && /reset lock_timeout;[^\n]*\n?$/.test(M438) && /^-- changelog: below\.$/m.test(M438) && /^-- existing rows: /m.test(M438));
ok("0438: no policy made, and the revoke names anon and authenticated (Supabase grants every new table to both by name)",
  !/create policy/i.test(M438) && /revoke all on public\.two_step_recovery_codes from public, anon, authenticated;/.test(M438)
  && /alter table public\.two_step_recovery_codes enable row level security;/.test(M438));

console.log(`\nR37 — A WAY BACK WITHOUT THE AUTHENTICATOR (0438): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
