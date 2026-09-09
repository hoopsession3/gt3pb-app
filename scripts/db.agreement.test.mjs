// AGREEMENT SCOPE, HOURS AND SIGNATURE — 0309, executed from its file.
//
// The claim worth proving is the digest one, because it is the only thing separating this from a
// name typed into a box. A signature that does not bind to what was signed is worse than no
// signature: it looks like proof. So the tests below sign an agreement, change a term behind its
// back, and check that the record says ALTERED rather than passing for intact — and that a
// countersignature over altered terms is refused outright.
//
// Second claim: an interim scope with no stated end is the failure this whole feature exists to
// prevent, so the database has to refuse it rather than accept an empty string as an answer.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const U1 = "00000000-0000-0000-0000-0000000000a1";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s) => (await db.query(s)).rows[0];
const raises = async (s) => { try { await db.exec(s); return null; } catch (e) { return String(e.message || e); } };

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  insert into auth.users (id) values ('${U1}');
  create role anon; create role authenticated;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('test.uid', true), ''), '')::uuid $$;
  create or replace function public.is_staff()  returns boolean language sql stable as $$
    select coalesce(current_setting('test.staff', true), 'on') = 'on' $$;
  create or replace function public.is_admin()  returns boolean language sql stable as $$
    select coalesce(current_setting('test.admin', true), 'on') = 'on' $$;
  create or replace function public.is_owner()  returns boolean language sql stable as $$
    select coalesce(current_setting('test.owner', true), 'on') = 'on' $$;

  create table public.tenants (id uuid primary key default gen_random_uuid());
  insert into public.tenants (id) values ('00000000-0000-0000-0000-000000000001');
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
  create table public.option_sets (id uuid primary key default gen_random_uuid(),
    set_key text not null, value text not null, label text, sort int not null default 100,
    active boolean not null default true, note text, unique (set_key, value));

  -- the 0277/0287/0289 shape, as far as 0309 touches it
  create table public.operator_agreements (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
    market text not null default 'greenville',
    operator_user_id uuid references auth.users(id),
    operator_name text not null, operator_email text, title text,
    status text not null default 'draft'
      constraint operator_agreements_status_check
      check (status in ('draft','sent','changes_requested','countered','accepted','active','ended')),
    tier text not null default 'associate', stage text not null default 'ramp',
    supply_funding numeric not null default 50,
    operator_pct numeric not null default 50, royalty_pct numeric not null default 30,
    market_pct numeric not null default 20,
    package jsonb not null default '[]'::jsonb, notes text,
    version integer not null default 1, starts_on date, ends_on date,
    sent_at timestamptz, accepted_at timestamptz, created_by uuid references auth.users(id),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    supply_sourcing text not null default 'undecided', supply_price_basis text,
    supply_markup_pct numeric, spec_items text[] not null default '{}', supply_notes text,
    equity_eligible boolean not null default false, equity_scope text not null default 'undecided',
    equity_note text);

  create table public.business_accounts (id uuid primary key default gen_random_uuid(), jug_balance int default 0,
    updated_at timestamptz default now());
  create table public.jug_ledger (id uuid primary key default gen_random_uuid(),
    business_id uuid references public.business_accounts(id), jugs_out int, jugs_in int, balance_after int, note text);
  create table public.loop_txns (id uuid primary key default gen_random_uuid(),
    on_date date default current_date, returns int, credit_cents int);
`);

await db.exec(readFileSync(join(ROOT, "supabase/migrations/0309_what_you_actually_agreed_to.sql"), "utf8"));
// the 0289 guard 0309 rewrites is created by 0289, not by 0309 — attach it here so the freeze is testable
await db.exec(`create trigger guard_terms_operator_agreements before update on public.operator_agreements
  for each row execute function public.guard_agreement_terms();`);
console.log("0309 executed against a real Postgres.\n");

await db.exec(`select set_config('test.uid', '${U1}', false)`);

// ── the vocabulary ─────────────────────────────────────────────────────────────────────────────
ok("the activity list is seeded into option_sets, so it is editable without a deploy",
  Number((await q1(`select count(*) as n from public.option_sets where set_key='agreement_activity'`)).n) === 8);
ok("brewing and delivering are both on it — the two Ryan named",
  Number((await q1(`select count(*) as n from public.option_sets
    where set_key='agreement_activity' and value in ('brew','deliver')`)).n) === 2);

// ── interim scope must state its end ───────────────────────────────────────────────────────────
const noEnd = await raises(`insert into public.operator_agreements (operator_name, scope_basis)
  values ('Nobody', 'interim')`);
ok("an interim scope with no end condition is refused",
  /interim_needs_end/i.test(noEnd || ""), noEnd);
const blankEnd = await raises(`insert into public.operator_agreements (operator_name, scope_basis, scope_until)
  values ('Nobody', 'interim', '   ')`);
ok("and a blank one is not an answer either", /interim_needs_end/i.test(blankEnd || ""));
ok("a standing scope needs no end condition",
  null === await raises(`insert into public.operator_agreements (operator_name, scope_basis) values ('Standing Sam','standing')`));

// ── the real case: an operator who also brews and delivers ─────────────────────────────────────
const id = (await db.query(`insert into public.operator_agreements
  (operator_name, operator_user_id, market, covers, scope_basis, scope_until, hours_basis, status)
  values ('Niño', '${U1}', 'atlanta', array['serve','brew','deliver'], 'interim',
          'until Atlanta clears its own costs and funds a dedicated brewer and driver',
          'logged_toward_equity', 'accepted') returning id`)).rows[0].id;

ok("the agreement records what they actually do, not just what they earn",
  (await q1(`select array_to_string(covers, ',') as c from public.operator_agreements where id='${id}'`)).c
    === "serve,brew,deliver");
ok("and the condition that retires the interim work",
  /dedicated brewer and driver/.test((await q1(`select scope_until from public.operator_agreements where id='${id}'`)).scope_until));

// ── hours ──────────────────────────────────────────────────────────────────────────────────────
await db.exec(`insert into public.agreement_hours (agreement_id, on_date, activity, hours, logged_by) values
  ('${id}','2026-09-01','serve',6,'${U1}'), ('${id}','2026-09-01','brew',4,'${U1}'),
  ('${id}','2026-09-02','deliver',5,'${U1}'), ('${id}','2026-09-02','brew',3,'${U1}')`);
const h = await q1(`select * from public.v_agreement_hours where agreement_id='${id}'`);
ok("hours total", Number(h.hours_total) === 18, h.hours_total);
ok("hours in scope — all four activities are covered", Number(h.hours_in_scope) === 18);
// THE NUMBER THE CONVERSATION IS ACTUALLY ABOUT: brewing + driving, on an interim scope.
ok("hours on the interim work are split out: 4 + 3 brewing, 5 driving",
  Number(h.hours_on_interim_work) === 12, h.hours_on_interim_work);
ok("days worked", Number(h.days_worked) === 2);
ok("a second entry for the same activity on the same day is refused as a duplicate",
  /duplicate|unique/i.test(await raises(`insert into public.agreement_hours (agreement_id, on_date, activity, hours)
    values ('${id}','2026-09-01','brew',2)`) || ""));
ok("more than 24 hours in a day is refused",
  /violates check/i.test(await raises(`insert into public.agreement_hours (agreement_id, on_date, activity, hours)
    values ('${id}','2026-09-03','serve',25)`) || ""));
ok("zero hours is not an entry",
  /violates check/i.test(await raises(`insert into public.agreement_hours (agreement_id, on_date, activity, hours)
    values ('${id}','2026-09-04','serve',0)`) || ""));

// ── signing ────────────────────────────────────────────────────────────────────────────────────
ok("an unsigned name is refused", /Type your full name/i.test(await raises(`select public.sign_agreement('${id}','  ')`) || ""));
const signed = await q1(`select public.sign_agreement('${id}', 'Niño Leyva') as r`);
ok("signing works from accepted", signed.r !== null);
const a1 = await q1(`select status, signed_name, signed_at is not null as at, signed_digest from public.operator_agreements where id='${id}'`);
ok("status moves to signed", a1.status === "signed", a1.status);
ok("the typed name is stored", a1.signed_name === "Niño Leyva");
ok("a digest of the terms is stored", typeof a1.signed_digest === "string" && a1.signed_digest.length === 64);
ok("and it matches the terms as they stand",
  (await q1(`select integrity from public.v_agreement_integrity where id='${id}'`)).integrity === "intact — matches what was signed");
ok("signing twice is refused", /signed after it is accepted/i.test(await raises(`select public.sign_agreement('${id}','Niño Leyva')`) || ""));

// ── countersigning ─────────────────────────────────────────────────────────────────────────────
await db.exec(`select set_config('test.owner','off',false)`);
ok("a non-owner cannot countersign for GT3",
  /Only an owner can countersign/i.test(await raises(`select public.countersign_agreement('${id}','Ryan Thompkins')`) || ""));
await db.exec(`select set_config('test.owner','on',false)`);
await db.exec(`select public.countersign_agreement('${id}', 'Ryan Thompkins')`);
const a2 = await q1(`select status, countersigned_name, countersigned_at is not null as at from public.operator_agreements where id='${id}'`);
ok("countersigning activates it", a2.status === "active", a2.status);
// THE COMPANY SIDE, WHICH NOTHING RECORDED BEFORE 0309.
ok("and records WHO executed it for GT3", a2.countersigned_name === "Ryan Thompkins");
ok("with a time", a2.at === true);

// ── the whole point: a term changed after signing ──────────────────────────────────────────────
// Freed past the guard on purpose — this simulates a direct SQL correction, which is exactly the
// case a stored digest exists to catch. The guard blocks the honest path; nothing blocks psql.
await db.exec(`select set_config('gt3.allow_hard_delete','on',false);
               update public.operator_agreements set operator_pct = 60, royalty_pct = 20 where id='${id}';
               select set_config('gt3.allow_hard_delete','off',false);`);
ok("changing a term after signing is DETECTED, not passed off as intact",
  (await q1(`select integrity from public.v_agreement_integrity where id='${id}'`)).integrity === "ALTERED SINCE SIGNING",
  (await q1(`select integrity from public.v_agreement_integrity where id='${id}'`)).integrity);

// and a countersignature over altered terms is refused outright
const id2 = (await db.query(`insert into public.operator_agreements
  (operator_name, operator_user_id, covers, scope_basis, status)
  values ('Second', '${U1}', array['serve'], 'standing', 'accepted') returning id`)).rows[0].id;
await db.exec(`select public.sign_agreement('${id2}', 'Second Person')`);
await db.exec(`select set_config('gt3.allow_hard_delete','on',false);
               update public.operator_agreements set tier = 'partner' where id='${id2}';
               select set_config('gt3.allow_hard_delete','off',false);`);
const cs = await raises(`select public.countersign_agreement('${id2}','Ryan Thompkins')`);
ok("GT3 cannot countersign terms the operator did not agree to",
  /changed since Second Person signed/i.test(cs || ""), cs);
ok("the refusal points at the right remedy", /superseding version/i.test(cs || ""));

// ── the terms freeze now covers scope ──────────────────────────────────────────────────────────
const froze = await raises(`update public.operator_agreements set covers = array['serve'] where id='${id}'`);
ok("what the agreement says they cover is frozen once accepted, like the money",
  /terms are final, including what it says the operator covers/i.test(froze || ""), froze);
ok("and the message names the way out", /supersede_agreement/.test(froze || ""));
ok("notes are still editable — a frozen agreement is not an unannotatable one",
  null === await raises(`update public.operator_agreements set notes = 'called about this' where id='${id}'`));

// ── superseding ────────────────────────────────────────────────────────────────────────────────
const v2 = await q1(`select (public.supersede_agreement('${id}', 'Atlanta funded a driver')).id as id`);
const v2row = await q1(`select version, status, supersedes_id, array_to_string(covers,',') as c from public.operator_agreements where id='${v2.id}'`);
ok("v2 is a draft", v2row.status === "draft");
ok("v2 is numbered", Number(v2row.version) === 2, v2row.version);
ok("v2 knows what it replaced — v1 is not left an orphan", v2row.supersedes_id === id);
ok("v2 carries the scope forward to be edited", v2row.c === "serve,brew,deliver");
const v1row = await q1(`select status, notes from public.operator_agreements where id='${id}'`);
ok("v1 is ended, not deleted", v1row.status === "ended");
ok("and says why, in the record", /Superseded by v2 — Atlanta funded a driver/.test(v1row.notes));
ok("superseding an ended agreement is refused",
  /already ended/i.test(await raises(`select public.supersede_agreement('${id}')`) || ""));

// ── the reversals ──────────────────────────────────────────────────────────────────────────────
const biz = (await db.query(`insert into public.business_accounts (jug_balance) values (10) returning id`)).rows[0].id;
const jug = (await db.query(`insert into public.jug_ledger (business_id, jugs_out, jugs_in) values ('${biz}', 6, 1) returning id`)).rows[0].id;
await db.exec(`update public.business_accounts set jug_balance = 15 where id='${biz}'`);   // what bumpJugs would have written
ok("a jug void needs a reason",
  /Say why/i.test(await raises(`select public.void_jug_entry('${jug}','')`) || ""));
await db.exec(`select public.void_jug_entry('${jug}', 'counted the wrong crate')`);
// THE SECOND HALF, which a plain soft-delete would have missed: the balance moved too.
ok("voiding a jug entry puts the account balance back",
  Number((await q1(`select jug_balance as b from public.business_accounts where id='${biz}'`)).b) === 10,
  (await q1(`select jug_balance as b from public.business_accounts where id='${biz}'`)).b);
ok("the row survives as the record",
  Number((await q1(`select count(*) as n from public.jug_ledger where id='${jug}'`)).n) === 1);
ok("and drops out of the open view",
  Number((await q1(`select count(*) as n from public.v_jug_open where id='${jug}'`)).n) === 0);
ok("voiding twice is refused", /already voided/i.test(await raises(`select public.void_jug_entry('${jug}','again')`) || ""));

const lt = (await db.query(`insert into public.loop_txns (returns, credit_cents) values (7, 1400) returning id`)).rows[0].id;
ok("a loop void needs a reason too", /Say why/i.test(await raises(`select public.void_loop_txn('${lt}','  ')`) || ""));
await db.exec(`select public.void_loop_txn('${lt}', 'typed 7 instead of 1')`);
ok("the reason is kept",
  (await q1(`select void_reason as r from public.loop_txns where id='${lt}'`)).r === "typed 7 instead of 1");
ok("and it leaves the open view",
  Number((await q1(`select count(*) as n from public.v_loop_open where id='${lt}'`)).n) === 0);

// ── ledger + changelog ─────────────────────────────────────────────────────────────────────────
ok("0309 recorded itself by filename",
  Number((await q1(`select count(*) as n from public.schema_migrations where version='0309_what_you_actually_agreed_to'`)).n) === 1);
ok("three changelog entries", Number((await q1(`select count(*) as n from public.changelog`)).n) === 3);
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0309_what_you_actually_agreed_to.sql"), "utf8"));
ok("re-running is safe — no duplicate changelog rows",
  Number((await q1(`select count(*) as n from public.changelog`)).n) === 3);
ok("and no duplicate activity options",
  Number((await q1(`select count(*) as n from public.option_sets where set_key='agreement_activity'`)).n) === 8);


// ═══ 0319 — A SIGNATURE IS NOT AN EDIT ═════════════════════════════════════════════════════════
// The trail table and its logger belong to 0277, not 0309, so the fixture never had them. They are
// SLICED OUT OF 0277 rather than retyped here: a fixture that answers differently from production
// is a test that lies, and this one exists specifically to reproduce a production bug before
// fixing it.
{
  const m0277 = readFileSync(join(ROOT, "supabase/migrations/0277_operator_agreements.sql"), "utf8");
  const cut = (from, to) => {
    const a = m0277.indexOf(from);
    const b = m0277.indexOf(to, a);
    if (a < 0 || b < 0) throw new Error(`could not slice 0277 at ${from}`);
    return m0277.slice(a, b);
  };
  await db.exec(cut("create table if not exists public.operator_agreement_events",
                    "create index if not exists operator_agreement_events_idx"));
  await db.exec(cut("create or replace function public.log_agreement_event()",
                    "drop trigger if exists trg_log_agreement_event"));
  await db.exec(`create trigger trg_log_agreement_event after insert or update on public.operator_agreements
    for each row execute function public.log_agreement_event();`);
}

// `at` defaults to now(), which is the STATEMENT timestamp — every event written in the same
// transaction ties, and ordering by a random uuid after that returns them in no order at all. The
// first run of this test read "drafted, edited, accepted" for a sequence that was actually
// "drafted, accepted, edited". ctid is physical insert order, which for an append-only table in a
// test is exactly the order they happened.
const evs = async (id) => (await db.query(
  `select kind, from_status, to_status, terms from public.operator_agreement_events
    where agreement_id='${id}' order by at, ctid`)).rows;
const newAgreement = async (name) => (await db.query(
  `insert into public.operator_agreements (operator_name, operator_user_id, market)
   values ('${name}', '${U1}', 'greenville') returning id`)).rows[0].id;

// ── the bug, reproduced against 0277's own logger ──────────────────────────────────────────────
const A = await newAgreement("Before");
ok("0319 (before): a new agreement logs 'drafted'",
  (await evs(A)).map((e) => e.kind).join() === "drafted", (await evs(A)).map((e) => e.kind));

await db.exec(`update public.operator_agreements set covers = array['brew'] where id='${A}'`);
ok("0319 (before): changing what the agreement COVERS writes NOTHING — the trail watched four columns while fourteen more were added around it",
  (await evs(A)).length === 1, await evs(A));

await db.exec(`update public.operator_agreements set equity_scope='company' where id='${A}'`);
ok("0319 (before): changing where equity would sit writes nothing either",
  (await evs(A)).length === 1, await evs(A));

await db.exec(`update public.operator_agreements set status='accepted' where id='${A}';
               select public.sign_agreement('${A}', 'A Name');`);
ok("0319 (before): SIGNING is recorded as 'edited' — the single most consequential transition in the lifecycle",
  (await evs(A)).map((e) => e.kind).join() === "drafted,accepted,edited", (await evs(A)).map((e) => e.kind));

// ── the fix ────────────────────────────────────────────────────────────────────────────────────
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0319_a_signature_is_not_an_edit.sql"), "utf8"));

const B = await newAgreement("After");
ok("0319: a new agreement still logs 'drafted'", (await evs(B)).map((e) => e.kind).join() === "drafted");

await db.exec(`update public.operator_agreements set covers = array['brew','deliver'] where id='${B}'`);
{
  const e = (await evs(B)).at(-1);
  ok("0319: changing COVERS now writes an event", (await evs(B)).length === 2, await evs(B));
  ok("0319: and it names which term moved", JSON.stringify(e.terms.changed) === '["covers"]', e.terms.changed);
}

// interim scope requires the condition that ends it (operator_agreements_interim_needs_end), so
// this moves three columns at once — which is a better assertion anyway.
await db.exec(`update public.operator_agreements
                  set equity_scope='company', scope_basis='interim', scope_until='until Atlanta hires a brewer'
                where id='${B}'`);
{
  const e = (await evs(B)).at(-1);
  ok("0319: several 0289/0309 columns moving in one save produce ONE event naming all of them",
    (await evs(B)).length === 3 &&
    JSON.stringify(e.terms.changed) === '["equity_scope","scope_basis","scope_until"]', e.terms.changed);
}

await db.exec(`update public.operator_agreements set notes='a note is not a term' where id='${B}'`);
ok("0319: a note still writes nothing — the watch list is contractual columns, not every column",
  (await evs(B)).length === 3, (await evs(B)).map((e) => e.kind));

await db.exec(`update public.operator_agreements set status='accepted' where id='${B}';
               select public.sign_agreement('${B}', 'B Name');`);
{
  const e = (await evs(B)).at(-1);
  ok("0319: signing is now recorded as 'signed'", e.kind === "signed", (await evs(B)).map((x) => x.kind));
  ok("0319: and the trail row carries the digest of what was signed",
    typeof e.terms.digest === "string" && e.terms.digest.length === 64, e.terms.digest);
  ok("0319: from_status and to_status still bracket the move",
    e.from_status === "accepted" && e.to_status === "signed", [e.from_status, e.to_status]);
}

// The list the logger watches must BE the list the guard freezes. Two lists is how they drifted for
// three migrations, so this asserts the pairing rather than the contents.
{
  const src = readFileSync(join(ROOT, "supabase/migrations/0319_a_signature_is_not_an_edit.sql"), "utf8");
  const g309 = readFileSync(join(ROOT, "supabase/migrations/0309_what_you_actually_agreed_to.sql"), "utf8");
  // `package` is compared as new.package::text — the cast has to be allowed for or the count is 17.
  const guarded = [...g309.slice(g309.indexOf("create or replace function public.guard_agreement_terms"))
    .slice(0, 2000).matchAll(/new\.([a-z_]+)(?:::text)? is distinct from old\.\1/g)].map((m) => m[1]);
  const watched = [...src.matchAll(/then '([a-z_]+)' end/g)].map((m) => m[1]);
  ok(`0319: the logger watches all ${guarded.length} columns the guard freezes`,
    guarded.length === 18 && guarded.every((c) => watched.includes(c)),
    guarded.filter((c) => !watched.includes(c)));
}

ok("0319 recorded itself by filename",
  Number((await q1(`select count(*) as n from public.schema_migrations where version='0319_a_signature_is_not_an_edit'`)).n) === 1);
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0319_a_signature_is_not_an_edit.sql"), "utf8"));
ok("0319 re-running is safe — no duplicate changelog row",
  Number((await q1(`select count(*) as n from public.changelog`)).n) === 4);

console.log(`\nAGREEMENT SCOPE, HOURS & SIGNATURE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
