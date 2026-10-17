// R19 — WHO IS CALLING IS ASKED ONCE A QUERY, IN EVERY POLICY, RUN IN POSTGRES (2026-10-17; Ryan: "Keep working to
// improve to a 10").
//
//   0425  every policy in public that called auth.uid(), auth.jwt(), is_staff(), is_admin(), is_owner(),
//         effective_tenant() or current_tenant() bare is rewritten with the call in a sub-select (database F3).
//
// What is run here is the whole schema up to 0424 (R18's, held 0424 with it), the finding counted on it, what each signed-in kind of person can see
// and do measured, then 0425 — twice — and the same measured again: the same rules, the same answers, no call left bare.
// Every other db test loads 0425 with the rest, so each of them runs its rules on the rewritten policies too. Every
// person and row is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M425 = readFileSync(join(ROOT, "supabase/migrations/0425_who_is_calling_is_asked_once_a_query_in_every_policy.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c424000-0000-4000-8000-0000000000c1", CREW = "0c424000-0000-4000-8000-0000000000c2";
const ADMIN = "0c424000-0000-4000-8000-0000000000c3", SAM = "0c424000-0000-4000-8000-0000000000a1", BEA = "0c424000-0000-4000-8000-0000000000a2";

const t0 = Date.now();
const db = await fullSchema({ before: "0425" });
console.log(`the schema to 0424 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const EMAIL = {};   // who → their made-up address, for the claims auth.jwt() reads
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);
  select set_config('request.jwt.claims', '', false);`);
// A request as PostgREST makes one: the claims a policy reads through auth.uid() and auth.role(), and the whole token
// auth.jwt() reads (the offer letters' "sent to your address" is its email — R19 review).
const as = async (who, sql, params) => {
  const role = who ? "authenticated" : "anon";
  const claims = JSON.stringify(who ? { sub: who, role, email: EMAIL[who] } : { role });
  await db.exec(`select set_config('request.jwt.claim.sub', '${who ?? ""}', false);
    select set_config('request.jwt.claim.role', '${role}', false); select set_config('request.jwt.claims', '${claims}', false); set role ${role};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e).split("\n")[0], code: e.code ?? null }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated, service_role;
  do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
  grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;
  alter role service_role bypassrls;`);
for (const [id, role, name] of [[OWNER, "owner", "Alex Rivera"], [CREW, "operator", "Kim Lee"], [ADMIN, "admin", "Dana Cole"], [SAM, "member", "Sam Ito"], [BEA, "member", "Bea Park"]]) {
  EMAIL[id] = `${name.split(" ")[0].toLowerCase()}@example.test`;
  await q(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, EMAIL[id]]);
  await q(`update public.profiles set role = $2, tenant_id = $3, display_name = $4, is_admin = ($2 in ('owner', 'admin')) where id = $1`, [id, role, T1, name]);
}

// The finding's measure, in Postgres's own print: a zero-argument caller helper not inside a sub-select.
const BARE = `(?<![[:alnum:]_.])(?<!SELECT )(auth\\.(uid|jwt)|(public\\.)?(is_staff|is_admin|is_owner|effective_tenant|current_tenant))\\(\\)`;
const policies = () => q(`select t.relname as tbl, p.polname as pol, p.polcmd::text as cmd, p.polpermissive as perm, p.polroles::text as roles,
    pg_get_expr(p.polqual, p.polrelid) as qual, pg_get_expr(p.polwithcheck, p.polrelid) as chk
  from pg_policy p join pg_class t on t.oid = p.polrelid join pg_namespace s on s.oid = t.relnamespace
  where s.nspname = 'public' order by 1, 2`);
const bareCount = async () => Number((await q1(`select count(*)::int n from pg_policy p join pg_class t on t.oid = p.polrelid join pg_namespace s on s.oid = t.relnamespace
  where s.nspname = 'public' and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ $1`, [BARE])).n);

// ── before 0425: the finding, counted ─────────────────────────────────────────────────────────────────────────────────
const before = await policies();
const bareBefore = await bareCount();
ok("before: well over a hundred policies call a caller helper bare (the snapshot at 0422 counted 133)", bareBefore > 100, bareBefore);

// What each kind of person sees and may do, across the tables the policies guard most: measured before and after.
await q(`insert into public.alerts (severity, category, title, body, target_user_id, tenant_id) values
  ('fyi', 'system', 'For Sam', 'x', $1, $3), ('fyi', 'system', 'For Bea', 'x', $2, $3), ('important', 'system', 'For the crew', 'x', null, $3)`, [SAM, BEA, T1]);
// A cup each for Sam and Bea, a pack each, a phone each and a crew invite: rows the rules give to some and not others.
await q(`insert into public.orders (items, total_cents, status, user_id, tenant_id) values ('{rise}', 900, 'new', $1, $3), ('{flow}', 900, 'new', $2, $3)`, [SAM, BEA, T1]);
await q(`insert into public.drop_orders (user_id, name, phone, size, glass, total_cents, drop_date, tenant_id) values
  ($1, 'Sam', '864-555-0101', 6, 'new', 6000, current_date + 2, $3), ($2, 'Bea', '864-555-0102', 6, 'new', 6000, current_date + 2, $3)`, [SAM, BEA, T1]);
await q(`insert into public.push_subscriptions (endpoint, platform, p256dh, auth, user_id, is_admin, tenant_id) values
  ('https://push.example/sam', 'web', 'k', 'a', $1, false, $3), ('https://push.example/bea', 'web', 'k', 'a', $2, false, $3)`, [SAM, BEA, T1]);
await q(`insert into public.team_invites (email, role, invited_by, tenant_id) values ('new.hire@example.test', 'operator', $1, $2)`, [OWNER, T1]);
// An offer sent to Sam's address before his account is linked to it: only the token's email (auth.jwt()) lets him read it.
await q(`insert into public.offer_letters (candidate_name, candidate_email, title, base_cents, rate_per, status, tenant_id) values ('Sam Ito', $1, 'Barista', 1800, 'hour', 'sent', $2)`, [EMAIL[SAM], T1]);
const probes = [
  ["own profile only", (who) => as(who, `select count(*)::int n from public.profiles`)],
  ["alerts", (who) => as(who, `select count(*)::int n from public.alerts`)],
  ["orders", (who) => as(who, `select count(*)::int n from public.orders`)],
  ["drop orders", (who) => as(who, `select count(*)::int n from public.drop_orders`)],
  ["team invites", (who) => as(who, `select count(*)::int n from public.team_invites`)],
  ["push devices", (who) => as(who, `select count(*)::int n from public.push_subscriptions`)],
  // Refused by the column grant (0008 takes update(role) from the API roles) before any rule is read — kept as a fence.
  ["a profile's role changed by its own member (the column grant)", (who) => as(who, `update public.profiles set role = 'admin' where id = $1 returning id`, [who ?? SAM])],
  // The profile's write rule itself (R19 review): one's own display name, and someone else's.
  ["a display name, one's own", (who) => as(who, `update public.profiles set display_name = display_name where id = $1 returning id`, [who ?? SAM])],
  ["a display name, someone else's", (who) => as(who, `update public.profiles set display_name = display_name where id = $1 returning id`, [BEA])],
  ["an offer sent to one's address", (who) => as(who, `select count(*)::int n from public.offer_letters`)],
  ["an alert written for someone else", (who) => as(who, `insert into public.alerts (severity, category, title, body, target_user_id, tenant_id) values ('fyi','system','x','x',$1,$2) returning id`, [BEA, T1])],
];
const measure = async () => {
  const out = {};
  for (const [name, run] of probes) for (const who of [null, SAM, CREW, ADMIN, OWNER]) {
    const r = await run(who);
    out[`${name} · ${who ?? "anon"}`] = r.error ? `refused: ${r.code ?? r.error.slice(0, 60)}` : r.rows.length === 1 && "n" in r.rows[0] ? r.rows[0].n : `${r.rows.length} row(s)`;
  }
  return out;
};
const seenBefore = await measure();
if (process.env.SHOW) console.log(seenBefore, { bareBefore });
// The writes just measured are undone, so the second measure starts where the first did.
await q(`update public.profiles set role = 'member', is_admin = false where id in ($1, $2)`, [SAM, BEA]);
await q(`delete from public.alerts where title = 'x'`);

// ── 0425 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
let applied = null;
try { await db.exec(M425); applied = true; } catch (e) { applied = String(e.message || e).split("\n")[0]; }
ok("0425 loads", applied === true, applied);
const after = await policies();
ok("after: no policy calls a caller helper bare", (await bareCount()) === 0, await bareCount());
ok("after: every policy is still there — the same table, name, command, roles and kind", JSON.stringify(after.map((p) => [p.tbl, p.pol, p.cmd, p.perm, p.roles]))
  === JSON.stringify(before.map((p) => [p.tbl, p.pol, p.cmd, p.perm, p.roles])), { before: before.length, after: after.length });
// The same rule: read back with every wrapped call unwrapped, each expression is what it was.
const unwrap = (e) => e == null ? e : e
  .replace(/\( SELECT auth\.(uid|jwt)\(\) AS \1\)/g, "auth.$1()")
  .replace(/\( SELECT (is_staff|is_admin|is_owner|effective_tenant|current_tenant)\(\) AS \1\)/g, "$1()");
const changedOnlyThere = before.filter((b, i) => unwrap(b.qual) !== unwrap(after[i].qual) || unwrap(b.chk) !== unwrap(after[i].chk));
ok("after: each expression is its old one, changed only at the calls it wrapped", changedOnlyThere.length === 0,
  changedOnlyThere.slice(0, 2).map((b) => ({ tbl: b.tbl, pol: b.pol, before: b.qual, after: after.find((a) => a.tbl === b.tbl && a.pol === b.pol)?.qual })));
const rewritten = before.filter((b, i) => b.qual !== after[i].qual || b.chk !== after[i].chk).length;
ok("after: the policies rewritten are the ones that called one bare", rewritten === bareBefore, { rewritten, bareBefore });
const seenAfter = await measure();
const differ = Object.keys(seenBefore).filter((k) => seenBefore[k] !== seenAfter[k]);
ok("after: what each kind of person sees and may do is what it was — anon, a member, the crew, an admin, the owner", differ.length === 0,
  differ.map((k) => `${k}: ${seenBefore[k]} → ${seenAfter[k]}`));
ok("after: a member still sees only their own profile and their own alerts; the owner sees the team's", seenAfter[`own profile only · ${SAM}`] === 1 && seenAfter[`alerts · ${SAM}`] >= 1
  && seenAfter[`alerts · ${SAM}`] < seenAfter[`alerts · ${OWNER}`] && seenAfter[`own profile only · ${OWNER}`] >= 5, seenAfter);
ok("after: a member writes their own display name and not another's; signed out, neither",
  seenAfter[`a display name, one's own · ${SAM}`] === "1 row(s)" && seenAfter[`a display name, someone else's · ${SAM}`] === "0 row(s)"
    && !/^1 row/.test(String(seenAfter["a display name, one's own · anon"])), seenAfter);
ok("after: an offer sent to Sam's address is his to read by the token's email (auth.jwt()), an admin's, and not the crew's",
  seenAfter[`an offer sent to one's address · ${SAM}`] === 1 && seenAfter[`an offer sent to one's address · ${ADMIN}`] === 1
    && seenAfter[`an offer sent to one's address · ${CREW}`] === 0 && seenAfter["an offer sent to one's address · anon"] !== 1, seenAfter);

// ── 0425 again: nothing to change ─────────────────────────────────────────────────────────────────────────────────────
let again = null;
try { await db.exec(M425); again = true; } catch (e) { again = String(e.message || e).split("\n")[0]; }
const after2 = await policies();
ok("0425 a second time: loads, and changes nothing", again === true && JSON.stringify(after2) === JSON.stringify(after), again);
ok("0425 a second time: recorded once, and one changelog line", Number((await q1(`select count(*)::int n from public.schema_migrations where version like '0425%'`)).n) === 1
  && Number((await q1(`select count(*)::int n from public.changelog where title = 'Every list asks who you are once, not once a row'`)).n) === 1);
ok("the rewrite's own function went with the paste's session", Number((await q1(`select count(*)::int n from pg_proc where proname = 'asked_once'`)).n) === 0);

// ── a helper's name inside a literal is left alone (R19 review) ───────────────────────────────────────────────────────
// A pattern can't tell a literal from a call: a rule whose print has one inside quotes is left whole, and said.
{
  await db.exec(`create policy zz_r19_literal on public.alerts for select to authenticated using (title <> 'is_admin()' and target_user_id = auth.uid());
    create policy zz_r19_plain on public.alerts for select to authenticated using (title <> 'all hands'::text and target_user_id = auth.uid() and body <> 'x''s');`);
  const pol = async (name) => (await q1(`select pg_get_expr(polqual, polrelid) e from pg_policy where polname = $1`, [name])).e;
  const lit0 = await pol("zz_r19_literal");
  const notices = [];
  let third = null;
  try { await db.exec(M425, { onNotice: (n) => notices.push(String(n.message)) }); third = true; } catch (e) { third = String(e.message || e).split("\n")[0]; }
  ok("0425 with a helper's name in a literal: loads, and leaves that rule exactly as it was", third === true && (await pol("zz_r19_literal")) === lit0, { third, before: lit0, after: await pol("zz_r19_literal") });
  ok("…while a rule with literals around a call (and a quote inside one) is still rewritten",
    /\( SELECT auth\.uid\(\) AS uid\)/.test(await pol("zz_r19_plain")) && /'all hands'::text/.test(await pol("zz_r19_plain")) && /'x''s'::text/.test(await pol("zz_r19_plain")), await pol("zz_r19_plain"));
  ok("…and the one left whole is named in the notices, and counted", notices.some((m) => /zz_r19_literal on public\.alerts names a helper inside a quoted literal/.test(m))
    && notices.some((m) => /^0425: 1 policies ask who is calling once a query; 1 left whole/.test(m)), notices);
  ok("…and every real policy was rewritten, none left whole (no helper's name in a literal in this schema)", (await bareCount()) === 1, await bareCount());
  await db.exec(`drop policy zz_r19_literal on public.alerts; drop policy zz_r19_plain on public.alerts;`);
}

// ── the security snapshot, run on the whole schema: the money's keys, the buckets' caps, the triggers (R19) ──────────
{
  const { reassemble } = await import("./security.snapshot.mjs");
  const { judge, MONEY_KEYS, BUCKET_CAPS, ACCOUNT_TRIGGERS } = await import("./security.audit.mjs");
  const rows = (await db.query(readFileSync(join(ROOT, "scripts/security.snapshot.sql"), "utf8"))).rows;
  const r = reassemble(rows);
  ok("snapshot: the query runs on the whole schema and its rows reassemble", !r.error, r.error);
  const snap = r.json ?? { t: {}, f: [], x: [], k: [], g: [], b: [] };
  const v = judge(snap);
  const keyFindings = v.hard.filter((h) => h.startsWith("money-key"));
  ok(`snapshot: every unique key the money stands on is made by the migrations (${Object.keys(MONEY_KEYS).length}) — the names the audit asks for are real`, keyFindings.length === 0, keyFindings);
  const capFindings = v.hard.filter((h) => h.startsWith("bucket-caps"));
  ok("snapshot: every bucket the app writes to is made and capped by the migrations (0421, 0423) — and the private ones private",
    capFindings.length === 0 && BUCKET_CAPS.every((id) => snap.b.some((b) => b[0] === id)) && !v.hard.some((h) => h.startsWith("bucket-private")), { capFindings, buckets: snap.b.map((b) => b[0]) });
  ok("snapshot: on the rewritten policies, no table the API roles reach has RLS off and no write policy is open (the two exempted aside)",
    !v.hard.some((h) => /rls-off|open-write/.test(h) && !/booking_requests|funnel_events/.test(h)), v.hard);
  ok("snapshot: …and no policy is left calling a helper bare", (await bareCount()) === 0, await bareCount());
  ok("snapshot: the triggers are measured by name — the money guard among them", snap.g.some(([t, n]) => t === "shop_orders" && n === "a_money_columns_guard"), snap.g.length);
  // R18 review, fourth pass: the accounts' triggers (auth.users') measured, and every one the audit requires made and on.
  const atFindings = v.hard.filter((h) => h.startsWith("account-trigger"));
  ok(`snapshot (fourth pass): the accounts' triggers are measured, and every one the audit asks for (${Object.keys(ACCOUNT_TRIGGERS).length}) is made by the migrations and on — the names are real`,
    atFindings.length === 0 && v.info.accountTriggers === Object.keys(ACCOUNT_TRIGGERS).length
      && Object.keys(ACCOUNT_TRIGGERS).every((k) => snap.g.some(([t, n, on]) => `${t}.${n}` === k && on !== "D")), { atFindings, n: v.info.accountTriggers, auth: snap.g.filter(([t]) => t.startsWith("auth.")) });
}

console.log(`\nR19 — WHO IS CALLING IS ASKED ONCE A QUERY (0425): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
