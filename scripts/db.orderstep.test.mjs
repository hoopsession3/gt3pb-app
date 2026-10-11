// AN ORDER'S STEPS ON THE PASS — 0368, executed from its file against a real Postgres.
//
// staff_set_order_status (0023) set the status it was given, whatever the order's was, without reading the order,
// in any tenant. The pass calls it from the ticket's buttons and from the offline queue's replay — up to six hours
// later — so a tap made before a void could undo it. Each gap is shown first as 0023 has it, then closed by 0368.
//
// THE MODEL. Production's own text wherever it decides anything:
//   · is_staff(), is_admin(), current_tenant() and effective_tenant() are read out of the migrations — the LAST file
//     that defines each (printed below), as production holds it — and run as written;
//   · public.orders is 0005's table, executed from its file, with the tenant_id 0040 gives it and 0018's
//     status_changed_at and trigger (executed from its file);
//   · the function before 0368 is 0023's, cut from its file;
//   · Supabase's default grants: a new function in public is executable by anon, authenticated and service_role.
// STUBBED: auth.uid() reads a setting (test.uid), as every db test here does; profiles holds only role, is_admin and
// tenant_id; tenants only ids; changelog and the migration ledger are the shapes the other db tests use; the realtime
// publication is empty (0005 adds orders to it). NOT MODELED: 0134's tenant stamp and restrictive policy (a SECURITY
// DEFINER function is not under row-level security — the reason for the tenant test), 0155's and 0232's triggers
// (0368 does not touch them) and PostgREST itself: every call below is made by argument name, as the app's are.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = join(ROOT, "supabase/migrations");
const T1 = "00000000-0000-0000-0000-000000000001", T2 = "00000000-0000-0000-0000-000000000002";
const SERVER = "00000000-0000-0000-0000-0000000000e1",   // on the pass, GT3
  MEMBER = "00000000-0000-0000-0000-0000000000e2",        // a customer
  LEGACY = "00000000-0000-0000-0000-0000000000e3",        // an admin from before roles (member, is_admin): staff per 0035
  OTHER = "00000000-0000-0000-0000-0000000000e4";         // on the pass of another business
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s, p) => (await db.query(s, p)).rows[0];
const raises = async (s) => { try { await db.exec(s); return null; } catch (e) { return String(e.message || e); } };
const asRoot = () => db.exec("reset role; select set_config('test.uid', '', false);");

// A function as production holds it: the last migration that (re)defines it, its statement cut from that file.
// Whole-line comments are blanked first, so a header that quotes a definition is not mistaken for one.
function latestDef(name) {
  let found = null;
  const head = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "i");
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIG, f), "utf8").split("\n").map((l) => (l.trim().startsWith("--") ? "" : l)).join("\n");
    const at = sql.search(head);
    if (at < 0) continue;
    const open = sql.indexOf("$$", at), close = sql.indexOf("$$", open + 2);
    found = { file: f, text: sql.slice(at, sql.indexOf(";", close) + 1) };
  }
  return found;
}
const defs = Object.fromEntries(["is_admin", "is_staff", "current_tenant", "effective_tenant"].map((n) => [n, latestDef(n)]));
ok("production's definitions were found in the migrations", Object.values(defs).every((d) => d && /\$\$;$/.test(d.text)), defs);
console.log(Object.entries(defs).map(([n, d]) => `${n}() from ${d?.file}`).join(" · "));

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  insert into auth.users (id) values ('${SERVER}'), ('${MEMBER}'), ('${LEGACY}'), ('${OTHER}');
  create role anon; create role authenticated; create role service_role;
  -- Supabase's own default (measured in production, 2026-10-11, 0366/0367): a function made in public can be run by
  -- anon, authenticated and service_role by name, so a revoke from PUBLIC alone leaves anon its grant.
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('test.uid', true), ''), '')::uuid $$;

  create table public.tenants (id uuid primary key);
  insert into public.tenants (id) values ('${T1}'), ('${T2}');
  create table public.profiles (id uuid primary key references auth.users(id), role text not null default 'member',
    is_admin boolean not null default false, tenant_id uuid references public.tenants(id) default '${T1}');
  insert into public.profiles (id, role, is_admin, tenant_id) values
    ('${SERVER}', 'server', false, '${T1}'), ('${MEMBER}', 'member', false, '${T1}'),
    ('${LEGACY}', 'member', true, '${T1}'), ('${OTHER}', 'server', false, '${T2}');
  create publication supabase_realtime;

  create table public.changelog (id uuid primary key default gen_random_uuid(), title text,
    category text, area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null,
    applied_at timestamptz, recorded_at timestamptz not null default now(), applied_by uuid,
    applied_count int not null default 1, evidence text not null default 'stamped', note text);
  create or replace function public.record_migration(p_version text, p_note text default null)
  returns public.schema_migrations language plpgsql as $$
  declare r public.schema_migrations; begin
    insert into public.schema_migrations (version, seq, applied_at, note)
    values (p_version, substring(p_version from '^[0-9]+')::int, now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1
    returning * into r; return r; end $$;
`);
for (const n of ["is_admin", "is_staff", "current_tenant", "effective_tenant"]) await db.exec(defs[n].text);
await db.exec(readFileSync(join(MIG, "0005_orders.sql"), "utf8"));
await db.exec(`alter table public.orders add column if not exists tenant_id uuid references public.tenants(id) default '${T1}'`);   // 0040
await db.exec(readFileSync(join(MIG, "0018_order_timestamps.sql"), "utf8"));
const src23 = readFileSync(join(MIG, "0023_roles.sql"), "utf8");
const fn23 = src23.slice(src23.indexOf("create or replace function public.staff_set_order_status"), src23.indexOf("-- New signups"));
ok("0023's function was cut from its file", /returns void/.test(fn23) && /grant execute on function public\.staff_set_order_status\(uuid, text\)/.test(fn23), fn23.slice(0, 80));
await db.exec(fn23);

// One tap, as the app makes it: by argument name, signed in (or not). { status } or { error, code, detail }.
const tap = async (uid, id, status, from) => {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try {
    const r = from === undefined
      ? await db.query("select public.staff_set_order_status(p_order => $1, p_status => $2)::text as s", [id, status])
      : await db.query("select public.staff_set_order_status(p_order => $1, p_status => $2, p_from => $3) as s", [id, status, from]);
    return { status: r.rows[0].s };
  } catch (e) { return { error: String(e.message || e), code: e.code ?? null, detail: e.detail ?? null }; }
  finally { await asRoot(); }
};
const order = async (status, tenant = T1) => { await asRoot(); return (await q1(
  `insert into public.orders (items, total_cents, status, tenant_id) values ('{rise}', 900, $1, $2) returning id`, [status, tenant])).id; };
const row = async (id) => { await asRoot(); return q1(`select status, xmin::text as xmin, status_changed_at from public.orders where id = $1`, [id]); };
const statusOf = async (id) => (await row(id))?.status;
const moved = (r) => r.error === "order_moved" && r.code === "P0001";

// ── before 0368: the gaps, as production has them ─────────────────────────────────────────────────
{
  const v = await order("void");
  const r = await tap(SERVER, v, "done");
  ok("before 0368: a voided order could be moved — void → done", !r.error && (await statusOf(v)) === "done", r);
  const d = await order("done");
  const r2 = await tap(SERVER, d, "new");
  ok("before 0368: …and a handed-over one sent back to new — done → new, from any screen", !r2.error && (await statusOf(d)) === "new", r2);
  const theirs = await order("new", T1);
  const r3 = await tap(OTHER, theirs, "void");
  ok("before 0368: crew of another business voided this one's order by its id", !r3.error && (await statusOf(theirs)) === "void", r3);
  const rd = await order("ready");
  const x0 = (await row(rd)).xmin;
  await tap(SERVER, rd, "ready");
  ok("before 0368: a tap to where the order already was wrote the row again", (await row(rd)).xmin !== x0);
  ok("before 0368: anon held EXECUTE (Supabase's default grant), refused only inside by is_staff",
    (await q1(`select has_function_privilege('anon', 'public.staff_set_order_status(uuid, text)', 'execute') as a`)).a === true);
}

const sql = readFileSync(join(MIG, "0368_a_voided_order_stays_voided.sql"), "utf8");
await asRoot();
await db.exec(sql);
console.log("0368 executed against a real Postgres.\n");

// ── its shape, and who may call it ────────────────────────────────────────────────────────────────
await asRoot();
const fns = (await db.query(`select pg_get_function_identity_arguments(oid) as args, prorettype::regtype::text as ret, prosecdef, coalesce(proconfig::text, '') as cfg
  from pg_proc where proname = 'staff_set_order_status'`)).rows;
ok("one staff_set_order_status, (p_order, p_status, p_from) → text: 0023's two-argument one is gone",
  fns.length === 1 && fns[0].args === "p_order uuid, p_status text, p_from text" && fns[0].ret === "text", fns);
ok("it runs as its definer with search_path pinned", fns[0]?.prosecdef === true && /search_path=public/.test(fns[0]?.cfg), fns[0]);
const priv = await q1(`select has_function_privilege('anon', 'public.staff_set_order_status(uuid, text, text)', 'execute') as anon,
  has_function_privilege('authenticated', 'public.staff_set_order_status(uuid, text, text)', 'execute') as authed`);
ok("anon cannot execute it; a signed-in caller can", priv.anon === false && priv.authed === true, priv);
{
  const o = await order("new");
  const r = await tap(null, o, "void");
  ok("…and a call nobody is signed in for is refused before it runs", /permission denied/i.test(r.error ?? "") && (await statusOf(o)) === "new", r);
  const m = await tap(MEMBER, o, "void");
  ok("a signed-in customer is refused — 'not authorized', as before", m.error === "not authorized" && (await statusOf(o)) === "new", m);
  const l = await tap(LEGACY, o, "preparing");
  ok("an admin from before roles is crew (0035's is_staff) and moves it", l.status === "preparing" && (await statusOf(o)) === "preparing", l);
  ok("a status it doesn't know is 'invalid status', as before", (await tap(SERVER, o, "cooking")).error === "invalid status"
    && (await tap(SERVER, o, null)).error === "invalid status" && (await statusOf(o)) === "preparing");
  ok("the app's call — p_order and p_status by name, nothing more — reaches it and answers the status",
    (await tap(SERVER, o, "ready")).status === "ready" && (await statusOf(o)) === "ready");
}

// ── void is final ─────────────────────────────────────────────────────────────────────────────────
{
  const v = await order("void");
  const out = [];
  for (const to of ["new", "preparing", "ready", "done"]) out.push(await tap(SERVER, v, to));
  ok("nothing leaves void: each move out is 'order_moved', P0001, detail 'void'",
    out.every((r) => moved(r) && r.detail === "void") && (await statusOf(v)) === "void", out);
  const fromVoid = await tap(SERVER, v, "done", "void");
  ok("…even from a screen that showed it void", moved(fromVoid) && fromVoid.detail === "void" && (await statusOf(v)) === "void", fromVoid);
  const again = await tap(SERVER, v, "void");
  ok("voiding it again is harmless: answers 'void'", again.status === "void", again);
  const gone = [];
  for (const s of ["new", "preparing", "ready", "done"]) { const o = await order(s); gone.push([(await tap(SERVER, o, "void")).status, await statusOf(o)]); }
  ok("anything can be voided — new, preparing, ready, and a handed-over order too", gone.every(([a, b]) => a === "void" && b === "void"), gone);
}

// ── the moves the pass makes ──────────────────────────────────────────────────────────────────────
{
  const steps = [];
  const o = await order("new");
  for (const to of ["preparing", "ready", "done"]) steps.push((await tap(SERVER, o, to)).status);
  ok("one stage at a time: new → preparing → ready → done", steps.join(",") === "preparing,ready,done" && (await statusOf(o)) === "done", steps);
  const jumps = [];
  for (const [from, to] of [["new", "done"], ["new", "ready"], ["preparing", "done"]]) {
    const j = await order(from); jumps.push([(await tap(SERVER, j, to)).status, await statusOf(j), to]);
  }
  ok("forward jumps: new → done (the queue's coalesced taps as one write), new → ready, preparing → done",
    jumps.every(([a, b, to]) => a === to && b === to), jumps);
  const back = [];
  for (const [from, to] of [["ready", "preparing"], ["preparing", "new"]]) {
    const b = await order(from); back.push([(await tap(SERVER, b, to)).status, await statusOf(b), to]);
  }
  ok("back a stage (↩): ready → preparing, preparing → new", back.every(([a, b, to]) => a === to && b === to), back);
  const rc = await order("done");
  ok("Recall: done → ready", (await tap(SERVER, rc, "ready")).status === "ready" && (await statusOf(rc)) === "ready");
  const far = await order("ready");
  ok("back more than a stage is a move too (two ↩ the queue coalesced): ready → new",
    (await tap(SERVER, far, "new")).status === "new" && (await statusOf(far)) === "new");
}

// ── a tap to where it already is ──────────────────────────────────────────────────────────────────
{
  const o = await order("ready");
  await db.exec(`update public.orders set status_changed_at = now() - interval '1 hour' where id = '${o}'`);
  const r0 = await row(o);
  const r = await tap(SERVER, o, "ready");
  const r1 = await row(o);
  ok("the same status is a no-op that answers it: 'ready'", r.status === "ready", r);
  ok("…and writes nothing — the row is the same row, its clock where it was", r1.xmin === r0.xmin && r1.status_changed_at.getTime() === r0.status_changed_at.getTime(), { r0, r1 });
  await tap(SERVER, o, "done");
  const r2 = await row(o);
  ok("a real move still stamps status_changed_at — 0018's trigger, untouched", r2.status === "done" && r2.status_changed_at > r0.status_changed_at);
}

// ── the screen that was behind (p_from) ───────────────────────────────────────────────────────────
{
  const o = await order("ready");
  const stale = await tap(SERVER, o, "done", "preparing");
  ok("a tap from a screen that showed 'preparing', on an order now 'ready', is refused: order_moved, detail 'ready'",
    moved(stale) && stale.detail === "ready" && (await statusOf(o)) === "ready", stale);
  const fresh = await tap(SERVER, o, "done", "ready");
  ok("…from a screen that showed 'ready' it goes through", fresh.status === "done" && (await statusOf(o)) === "done", fresh);
  const already = await tap(SERVER, o, "done", "ready");
  ok("a tap someone else already made is no conflict: from 'ready' to 'done', on a done order, answers 'done'", already.status === "done", already);
  // The replay 0023 let through (done → new, above): sent with the screen it was made on, it is refused.
  const replay = await tap(SERVER, o, "new", "preparing");
  ok("done → new from a screen that showed 'preparing' — the replay a picked-up order came back by — is refused, detail 'done'",
    moved(replay) && replay.detail === "done" && (await statusOf(o)) === "done", replay);
  const lateVoid = await tap(SERVER, o, "void", "ready");
  ok("…and so is a void from a screen still showing 'ready': the order was handed over meanwhile", moved(lateVoid) && lateVoid.detail === "done" && (await statusOf(o)) === "done", lateVoid);
  ok("done → new from a screen that showed 'done' is a choice, and goes through", (await tap(SERVER, o, "new", "done")).status === "new" && (await statusOf(o)) === "new");
}

// ── the caller's own tenant, and the row held ─────────────────────────────────────────────────────
{
  const ours = await order("new", T1);
  const r = await tap(OTHER, ours, "void");
  ok("another business's crew: 'order not found', and the order is untouched", r.error === "order not found" && (await statusOf(ours)) === "new", r);
  const theirs = await order("new", T2);
  ok("…while their own order moves", (await tap(OTHER, theirs, "preparing")).status === "preparing");
  ok("an id that is no order: 'order not found'", (await tap(SERVER, "00000000-0000-0000-0000-00000000dead", "done")).error === "order not found");

  // Held until the call's transaction ends: a call that changes nothing still locked the row (its xmax is this
  // transaction) and took the table lock FOR UPDATE takes. PGlite has one connection, so this is read inside the
  // transaction rather than shown as a second phone waiting.
  const o = await order("ready");
  await db.exec(`set role authenticated; select set_config('test.uid', '${SERVER}', false); begin;`);
  await db.query("select public.staff_set_order_status(p_order => $1, p_status => 'ready')", [o]);
  await db.exec("reset role");
  const held = await q1(`select (select xmax::text from public.orders where id = $1) = (txid_current() % 4294967296)::text as row_held,
    exists (select 1 from pg_locks where relation = 'public.orders'::regclass and pid = pg_backend_pid() and mode = 'RowShareLock') as for_update`, [o]);
  await db.exec("rollback");
  await asRoot();
  ok("the order is read FOR UPDATE: held by the caller's transaction until it ends, even when nothing moves", held.row_held === true && held.for_update === true, held);
}

// ── it says so once, records itself, and runs again ───────────────────────────────────────────────
await asRoot();
ok("it says so in the changelog, once", (await q1("select count(*)::int as n from public.changelog where title = 'A voided order stays voided' and category = 'fix'")).n === 1);
ok("it records itself", (await q1("select applied_count from public.schema_migrations where version = '0368_a_voided_order_stays_voided'"))?.applied_count === 1);
ok("run again: no error, recorded twice, one changelog line, still one function", (await raises(sql)) === null
  && (await q1("select applied_count from public.schema_migrations where version = '0368_a_voided_order_stays_voided'"))?.applied_count === 2
  && (await q1("select count(*)::int as n from public.changelog where title = 'A voided order stays voided'")).n === 1
  && (await q1("select count(*)::int as n from pg_proc where proname = 'staff_set_order_status'")).n === 1);
{
  const v = await order("void");
  const r = await tap(SERVER, v, "new");
  ok("…and after the second run, void is still final and anon still shut out", moved(r) && r.detail === "void"
    && (await q1(`select has_function_privilege('anon', 'public.staff_set_order_status(uuid, text, text)', 'execute') as a`)).a === false, r);
}

// ── why the two-argument function had to go ───────────────────────────────────────────────────────
// Beside 0368's, 0023's fits a call that names p_order and p_status as well, and Postgres refuses to choose (PostgREST
// refuses the same call before it reaches Postgres). The migration drops it, so a database that still had it — or got
// it back — is put right by running 0368.
{
  await asRoot();
  await db.exec(fn23);
  const o = await order("new");
  const amb = await tap(SERVER, o, "preparing");
  ok("with 0023's function back beside it, the app's call fits both and is refused", /not unique/i.test(amb.error ?? ""), amb);
  await asRoot();
  await db.exec(sql);
  ok("…and running 0368 puts it right: the same call answers 'preparing'", (await tap(SERVER, o, "preparing")).status === "preparing");
}

// ── RECALL FROM THE TICKET (2026-10-11, the KDS program, wave 2 — components/pass) ─────────────────────────────────────
// The Pass's Recall is one tap on a picked-up ticket, and it is the ticket's own move, sent from the status the tray
// showed: done → ready with p_from 'done' (lib/passBoard; components/pass/ThePass recall → move → lib/orderStatus). 0368
// lets it through; these are the answers a busy pass gets back.
{
  const o = await order("done");
  const r = await tap(SERVER, o, "ready", "done");
  ok("Recall from the ticket: done → ready, sent from 'done' (what the tray showed)", r.status === "ready" && (await statusOf(o)) === "ready", r);
  const twice = await tap(SERVER, o, "ready", "done");
  ok("…the other phone recalled it first: no conflict — it answers 'ready'", twice.status === "ready" && (await statusOf(o)) === "ready", twice);
  const v = await order("void");
  const late = await tap(SERVER, v, "ready", "done");
  ok("…an order voided meanwhile stays void: the recall is refused, detail 'void'", moved(late) && late.detail === "void" && (await statusOf(v)) === "void", late);
  const on = await order("preparing");
  const behind = await tap(SERVER, on, "ready", "done");
  ok("…an order recalled and moved on meanwhile (the tray was behind): refused, and it says where the order is", moved(behind) && behind.detail === "preparing" && (await statusOf(on)) === "preparing", behind);
}

console.log(`0368 (a voided order stays voided): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
