// R30 — EVERY ROW THAT POINTS AT ANOTHER IS FOUND BY AN INDEX (0435), AND ONE ADDRESS CAN'T SPEND THE GUEST DOOR FOR
// EVERYONE (0436), IN POSTGRES (2026-10-18 — the 10/10 audit, database F19 and F14's last half).
//
// The whole schema to 0434 is loaded, and the foreign keys no index leads are counted the way Postgres's own check
// would need them: an index whose leading columns are the key's, whole or `where <col> is not null` (a null points at
// nothing), valid. Then 0435 — twice — and none is left outside the tenant keys; every key a whole migration directory
// writes from here is held to the same, so a migration that adds one without its index fails the release. A row's
// delete is shown taking the new index, a column that may be empty gets the partial index and one that can't the whole
// one, a name that is taken is stepped past, and a key written twice gets one index.
//
// Then 0436, twice: a caller's address is read as Cloudflare gives it (cf-connecting-ip — an IPv4 address whole, an IPv6
// one as its /64, anything else nothing), and a new device nobody is signed in on is counted from that address first —
// thirty an hour — and only then against everyone's three hundred; a device the address's own count refuses spends
// nothing of anyone else's, a second address goes on, a call with no address is counted as before, and a member's device
// is never counted. Both doors are 0428's line for line but the count. Every row and every address is made up
// (203.0.113.0/24, 198.51.100.0/24 and 2001:db8::/32 are the documentation ranges).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M435 = readFileSync(join(ROOT, "supabase/migrations/0435_every_row_that_points_at_another_is_found_by_an_index.sql"), "utf8");
const M436 = readFileSync(join(ROOT, "supabase/migrations/0436_one_address_cant_spend_the_guest_door_for_everyone.sql"), "utf8");
const M428 = readFileSync(join(ROOT, "supabase/migrations/0428_the_studio_room_is_its_editors_and_a_phone_nobody_keeps_is_let_go.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const t0 = Date.now();
const db = await fullSchema({ before: "0435" });
console.log(`the schema to 0434 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];

/** The foreign keys in public that no index leads, as Postgres's check would need one — the rule 0435 keeps. */
const UNLED = `
  select t.relname as tbl, c.conname, c.confrelid::regclass::text as ref,
         array(select a.attname::text from unnest(c.conkey) with ordinality k(n, i)
                 join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i) as cols
    from pg_constraint c join pg_class t on t.oid = c.conrelid and t.relnamespace = 'public'::regnamespace
   where c.contype = 'f'
     and not exists (select 1 from pg_index x where x.indrelid = c.conrelid and x.indisvalid
           and (x.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
           and (x.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey
           and (x.indpred is null or (cardinality(c.conkey) = 1 and pg_get_expr(x.indpred, x.indrelid) =
                format('(%s IS NOT NULL)', (select quote_ident(b.attname) from pg_attribute b
                                             where b.attrelid = c.conrelid and b.attnum = c.conkey[1])))))
   order by 1, 2`;
const unled = async () => q(UNLED);
const outsideTenants = (rows) => rows.filter((r) => r.ref !== "tenants");
const indexCount = async () => (await q1(`select count(*)::int n from pg_index x join pg_class t on t.oid = x.indrelid where t.relnamespace = 'public'::regnamespace`)).n;
const indexOn = async (tbl, col) => q(`select i.relname as name, pg_get_expr(x.indpred, x.indrelid) as pred, x.indisunique as uniq
  from pg_index x join pg_class i on i.oid = x.indexrelid join pg_class t on t.oid = x.indrelid
  where t.relname = $1 and t.relnamespace = 'public'::regnamespace and x.indkey[0] = (select attnum from pg_attribute where attrelid = t.oid and attname = $2)`, [tbl, col]);

// ── before 0435 ────────────────────────────────────────────────────────────────────────────────────────────────────
const before = await unled();
const beforeOut = outsideTenants(before);
ok("before 0435: well over a hundred foreign keys outside the tenant keys are led by no index", beforeOut.length > 100, beforeOut.length);
ok("before 0435: among them, the ones the audit named and an erasure walks (expenses.voided_by, reserve_claims.collected_by, alert_reads.user_id)",
  ["expenses:voided_by", "reserve_claims:collected_by", "alert_reads:user_id"].every((k) => beforeOut.some((r) => `${r.tbl}:${r.cols.join(",")}` === k)),
  beforeOut.slice(0, 5));
ok("before 0435: a key led only by an index kept to some rows counts as unled (todos.assignee: `where not done`)",
  beforeOut.some((r) => r.tbl === "todos" && r.cols.join() === "assignee"), (await indexOn("todos", "assignee")));
ok("before 0435: a key led by `where <col> is not null` counts as led (orders.collected_by, 0421)",
  !before.some((r) => r.tbl === "orders" && r.cols.join() === "collected_by"));
const tenantBefore = before.filter((r) => r.ref === "tenants").length;

// A name 0435 would choose is already taken by something else — it steps past it.
await db.exec(`create table public.zz_r30_name_taken (id int)`);
const taken = "expenses_voided_by_fk_idx";
await db.exec(`create index ${taken} on public.zz_r30_name_taken (id)`);
// A key written twice on the same column wants one index.
await db.exec(`create table public.zz_r30_twice (id uuid primary key, who uuid,
  constraint zz_r30_twice_a foreign key (who) references auth.users (id),
  constraint zz_r30_twice_b foreign key (who) references auth.users (id))`);
// A key on a column that can't be empty gets the whole index.
await db.exec(`create table public.zz_r30_full (id uuid primary key, who uuid not null references auth.users (id))`);

const n0 = await indexCount();
await db.exec(M435);
const n1 = await indexCount();
await db.exec(M435);
const n2 = await indexCount();
const after = await unled();
ok("0435: no foreign key outside the tenant keys is left unled", outsideTenants(after).length === 0, outsideTenants(after));
ok("0435: the tenant keys are left as they were (one tenant: an index on it alone is never chosen)",
  after.length === tenantBefore && after.every((r) => r.ref === "tenants"), { tenantBefore, after: after.length });
ok("0435: one index for each unled key (the key written twice made one)", n1 - n0 === beforeOut.length + 2, { made: n1 - n0, expected: beforeOut.length + 2 });
ok("0435: a second run changes nothing", n2 === n1, { n1, n2 });
ok("0435: pasted twice, recorded once in the ledger (and counted twice)",
  (await q1(`select count(*)::int n, max(applied_count)::int c from public.schema_migrations where version like '0435%'`)).n === 1
  && (await q1(`select applied_count::int c from public.schema_migrations where version like '0435%'`)).c === 2);

const voided = await indexOn("expenses", "voided_by");
ok("0435: a column that may be empty gets `where <col> is not null` (expenses.voided_by)",
  voided.length === 1 && voided[0].pred === "(voided_by IS NOT NULL)" && voided[0].uniq === false, voided);
ok("0435: the name taken by something else was stepped past", voided[0]?.name !== taken && /^expenses_voided_by_fk\d+_idx$/.test(voided[0]?.name ?? ""), voided);
const full = await indexOn("zz_r30_full", "who");
ok("0435: a column that can't be empty gets the whole index", full.length === 1 && full[0].pred === null, full);
const twice = await indexOn("zz_r30_twice", "who");
ok("0435: a key written twice on the same column has one index", twice.length === 1, twice);
const todo = await indexOn("todos", "assignee");
ok("0435: beside an index kept to some rows, the key gets its own (todos.assignee)",
  todo.length === 2 && todo.some((x) => x.pred === "(assignee IS NOT NULL)") && todo.some((x) => x.pred === "(NOT done)"), todo);
ok("0435: every index it made is named for its table and key, and fits Postgres's 63", (await q(`select relname from pg_class
  where relkind = 'i' and relnamespace = 'public'::regnamespace and relname ~ '_fk\\d*_idx$' and length(relname) > 63`)).length === 0);

// The delete's check takes the index: what Postgres asks when a person's row goes, planned with a whole-table read
// made as dear as it can be.
await db.exec(`set enable_seqscan = off`);
const plan = (await q(`explain select 1 from only public.expenses x where voided_by = '00000000-0000-0000-0000-000000000001'::uuid for key share of x`))
  .map((r) => r["QUERY PLAN"]).join(" | ");
await db.exec(`reset enable_seqscan`);
ok("0435: the check a delete makes (`where voided_by = $1 for key share`) is answered from the new index", /Index (Only )?Scan using expenses_voided_by_fk\d*_idx/.test(plan) || /Bitmap Index Scan on expenses_voided_by_fk\d*_idx/.test(plan), plan);

// ── 0436: one address can't spend the guest door for everyone ──────────────────────────────────────────────────────
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);
  select set_config('request.jwt.claims', '', false); select set_config('request.headers', '', false);`);
const as = async (who, sql, params, from = null) => {
  const role = who ? "authenticated" : "anon";
  await db.query(`select set_config('request.headers', $1, false)`, [from === null ? "" : JSON.stringify(typeof from === "string" ? { "cf-connecting-ip": from } : from)]);
  await db.exec(`select set_config('request.jwt.claim.sub', '${who ?? ""}', false); select set_config('request.jwt.claim.role', '${role}', false);
    select set_config('request.jwt.claims', '${JSON.stringify(who ? { sub: who, role } : { role })}', false); set role ${role};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e).split("\n")[0], code: e.code ?? null }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated;`);
const MEMBER = "0c430000-0000-4000-8000-0000000000b1";
await q(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'made-up-member@example.test', now())`, [MEMBER]);

ok("before 0436: no caller_address, no guest_device_fits", (await q1(`select count(*)::int n from pg_proc where proname in ('caller_address', 'guest_device_fits')`)).n === 0);
await db.exec(M436);
await db.exec(M436);
ok("0436 twice: recorded (applied twice), one changelog line, each function once",
  (await q1(`select applied_count::int n from public.schema_migrations where version like '0436%'`)).n === 2
  && (await q1(`select count(*)::int n from public.changelog where title = 'One address can''t turn alerts off for everyone'`)).n === 1
  && (await q1(`select count(*)::int n from pg_proc where proname in ('caller_address', 'guest_device_fits')`)).n === 2);

const addr = async (headers) => { await db.query(`select set_config('request.headers', $1, false)`, [headers]); const v = (await q1(`select public.caller_address() a`)).a; await root(); return v; };
ok("caller_address: an IPv4 address from cf-connecting-ip is itself", (await addr(JSON.stringify({ "cf-connecting-ip": "203.0.113.7" }))) === "203.0.113.7");
ok("caller_address: an IPv6 address is its /64 — one home's, one phone's — so a caller can't walk through addresses of their own",
  (await addr(JSON.stringify({ "cf-connecting-ip": "2001:db8:1:2:aaaa:bbbb:cccc:dddd" }))) === "2001:db8:1:2::/64"
  && (await addr(JSON.stringify({ "cf-connecting-ip": "2001:db8:1:2:1:1:1:1" }))) === "2001:db8:1:2::/64");
ok("caller_address: no headers, no such header, an empty one, a list, a name, or what isn't an address — nothing",
  (await addr("")) === null && (await addr(JSON.stringify({ "x-forwarded-for": "203.0.113.7" }))) === null
  && (await addr(JSON.stringify({ "cf-connecting-ip": "" }))) === null && (await addr(JSON.stringify({ "cf-connecting-ip": "203.0.113.7, 198.51.100.1" }))) === null
  && (await addr(JSON.stringify({ "cf-connecting-ip": "localhost" }))) === null && (await addr(JSON.stringify({ "cf-connecting-ip": "999.1.1.1" }))) === null
  && (await addr("not json")) === null);

const P256 = "p256dh-made-up-key-0436", AUTH = "auth-made-up-36";
const web = (i, who = null, from = null) => as(who, `select public.keep_push_device($1, '${P256}', '${AUTH}', null, null)`, [`https://fcm.googleapis.com/fcm/send/r30-guest-${i}`], from);
const app = (i, who = null, from = null) => as(who, `select public.keep_app_push_token($1)`, [i.toString(16).padStart(64, "b")], from);
const bucket = async (b) => (await q1(`select coalesce(sum(count), 0)::int n from public.rate_limit_hits where bucket = $1`, [b])).n;
const A = "203.0.113.50", B = "198.51.100.60";

const firstThirty = [];
for (let i = 0; i < 20; i++) firstThirty.push(await web(i, null, A));
for (let i = 0; i < 10; i++) firstThirty.push(await app(1000 + i, null, A));
ok("0436: thirty new devices nobody is signed in on, from one address in the hour — browsers and phones together — are kept",
  firstThirty.every((r) => !r.error) && (await bucket(`push:new-guest:${A}`)) === 30 && (await bucket("push:new-guest")) === 30,
  { errors: firstThirty.filter((r) => r.error).map((r) => r.error), mine: await bucket(`push:new-guest:${A}`), all: await bucket("push:new-guest") });
const thirtyFirst = await web(30, null, A), phone31 = await app(1030, null, A);
ok("0436: the thirty-first from that address is refused, a browser or a phone, in the words the app shows",
  /Too many devices just now/.test(thirtyFirst.error ?? "") && /Too many devices just now/.test(phone31.error ?? ""), { thirtyFirst, phone31 });
ok("0436: …and what that address's own count refused spent nothing of everyone's three hundred", (await bucket("push:new-guest")) === 30 && (await bucket(`push:new-guest:${A}`)) === 30,
  { all: await bucket("push:new-guest"), mine: await bucket(`push:new-guest:${A}`) });
ok("0436: …and wasn't kept", (await q1(`select count(*)::int n from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/r30-guest-30'`)).n === 0);
ok("0436: a device that address kept already is kept again, uncounted", !(await web(3, null, A)).error && (await bucket(`push:new-guest:${A}`)) === 30);
const other = await web(40, null, B);
ok("0436: another address goes on (its own count, then everyone's)", !other.error && (await bucket(`push:new-guest:${B}`)) === 1 && (await bucket("push:new-guest")) === 31, other);
const v6a = await web(50, null, "2001:db8:aa:bb::1"), v6b = await web(51, null, "2001:db8:aa:bb::2");
ok("0436: two addresses in one IPv6 /64 are one caller's count", !v6a.error && !v6b.error && (await bucket("push:new-guest:2001:db8:aa:bb::/64")) === 2);
const nowhere = await web(60, null, null);
ok("0436: a call with no address is counted with everyone's alone, as before 0436", !nowhere.error && (await bucket("push:new-guest")) === 34);
const mine = await web(70, MEMBER, A), myPhone = await app(2000, MEMBER, A);
ok("0436: a member's own browser and phone are never counted — not even from an address past its thirty",
  !mine.error && !myPhone.error && (await bucket(`push:new-guest:${A}`)) === 30 && (await bucket("push:new-guest")) === 34, { mine, myPhone });

// Everyone's three hundred still holds, whatever the addresses.
await q(`insert into public.rate_limit_hits (bucket, window_start, count) values ('push:new-guest', to_timestamp(floor(extract(epoch from now()) * 1000 / 3600000) * 3600000 / 1000.0), 300)
  on conflict (bucket, window_start) do update set count = 300`);
const fresh = await web(80, null, "203.0.113.99");
ok("0436: past everyone's three hundred, a new address's first device is refused too (0418's ceiling stands)", /Too many devices just now/.test(fresh.error ?? ""), fresh);
ok("0436: …and the refusal spent nothing, not even that address's own count — a refused call is undone whole", (await bucket("push:new-guest:203.0.113.99")) === 0
  && (await q1(`select count(*)::int n from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/r30-guest-80'`)).n === 0);

// Who may ask what.
const priv = await q1(`select has_function_privilege('anon', 'public.caller_address()', 'execute') a1,
  has_function_privilege('authenticated', 'public.caller_address()', 'execute') a2,
  has_function_privilege('anon', 'public.guest_device_fits()', 'execute') g1,
  has_function_privilege('authenticated', 'public.guest_device_fits()', 'execute') g2,
  has_function_privilege('anon', 'public.keep_push_device(text,text,text,boolean,boolean)', 'execute') k1,
  has_function_privilege('anon', 'public.keep_app_push_token(text)', 'execute') k2,
  has_function_privilege('authenticated', 'public.keep_app_push_token(text)', 'execute') k3`);
ok("0436: caller_address and guest_device_fits are nobody's to call — the doors read them; the doors stay open to the app, signed in or out",
  !priv.a1 && !priv.a2 && !priv.g1 && !priv.g2 && priv.k1 && priv.k2 && priv.k3, priv);
const direct = await as(null, `select public.guest_device_fits() v`, [], A);
ok("0436: a browser can't spend a count by asking guest_device_fits itself", /permission denied/.test(direct.error ?? ""), direct);
const defs = await q(`select proname, prosecdef d, array_to_string(proconfig, ',') c from pg_proc where proname in ('keep_push_device', 'keep_app_push_token', 'caller_address', 'guest_device_fits') order by 1`);
ok("0436: the doors run as their definer, and all four with search_path pinned",
  defs.length === 4 && defs.every((r) => /search_path=public/.test(r.c)) && defs.filter((r) => r.d).map((r) => r.proname).join() === "keep_app_push_token,keep_push_device", defs);

// Line for line: 0428's doors but the count.
const fnOf = (sql, name) => { const i = sql.lastIndexOf(`create or replace function public.${name}(`); return sql.slice(i, sql.indexOf("end $$;", i) + 7); };
const uncount = (src) => src
  .replace(/and not public\.guest_device_fits\(\) then/, "and not public.rate_limit_hit('push:new-guest', 3600000, 300) then")
  .replace(/^\s*--.*$/gm, "").replace(/\n{2,}/g, "\n");
const bare = (src) => src.replace(/^\s*--.*$/gm, "").replace(/\n{2,}/g, "\n");
ok("0436: the browser's door is 0428's line for line but the count", uncount(fnOf(M436, "keep_push_device")) === bare(fnOf(M428, "keep_push_device")));
ok("0436: the phone's door is 0428's line for line but the count", uncount(fnOf(M436, "keep_app_push_token")) === bare(fnOf(M428, "keep_app_push_token")));
ok("0436: its first statement is `set lock_timeout = '5s'`, it resets it last, and it names its changelog line",
  /^set lock_timeout = '5s';$/m.test(M436) && /reset lock_timeout;[^\n]*\n?$/.test(M436) && /^-- changelog: below\.$/m.test(M436));

// ── the rule from here: a key written in a migration comes with its index ─────────────────────────────────────────
// A made-up later migration that adds a key and forgets the index is caught by the same count the release runs.
await db.exec(`create table public.zz_r30_later (id uuid primary key, stop_id uuid references public.stops (id))`);
const later = outsideTenants(await unled());
ok("the rule: a key added without its index is found by name", later.length === 1 && later[0].tbl === "zz_r30_later" && later[0].cols.join() === "stop_id", later);
await db.exec(`drop table public.zz_r30_later; drop table public.zz_r30_twice; drop table public.zz_r30_full; drop table public.zz_r30_name_taken`);

// The release's own check: every migration in the directory, read in order, leaves no unled key outside the tenants.
const whole = await fullSchema();
const wholeUnled = outsideTenants((await whole.query(UNLED)).rows);
ok("every migration in supabase/migrations/, read in order: no foreign key outside the tenant keys without its index — a migration that adds one writes its index", wholeUnled.length === 0, wholeUnled);

// The paste stays a paste: a lock it waits for at most five seconds, said first; the changelog's position stated.
ok("0435: its first statement is `set lock_timeout = '5s'` and it resets it last", /^set lock_timeout = '5s';$/m.test(M435) && /reset lock_timeout;[^\n]*\n?$/.test(M435));
ok("0435: states its changelog position", /^-- changelog: none — /m.test(M435));

console.log(`\nR30 — EVERY ROW THAT POINTS AT ANOTHER IS FOUND BY AN INDEX (0435), ONE ADDRESS CAN'T SPEND THE GUEST DOOR (0436): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
