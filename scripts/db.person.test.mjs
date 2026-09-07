// A PERSON IS NOT A ROW OF FIELDS — 0311, executed from its file.
//
// The claim worth proving is that onboarding is DERIVED. A stored "onboarded" flag drifts the first
// time somebody changes a record without going through the screen that sets it; a view cannot. So
// these tests change the underlying records directly — insert an offer, sign an agreement, log a
// sign-in — and assert the state moves on its own, with nothing told about it.
//
// The second claim is the one Ryan actually needs: WHICH SIDE owes the next step. "Waiting on you"
// and "waiting on them" are different situations and the screen has to be able to tell them apart.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OP = "00000000-0000-0000-0000-0000000000c1";   // the test operator, as it stands in production
const SRV = "00000000-0000-0000-0000-0000000000c2";  // a server, who needs no agreement
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s) => (await db.query(s)).rows[0];
const step = async (uid, key) => q1(`select done, owed_by, detail from public.v_crew_onboarding_steps where user_id='${uid}' and step='${key}'`);
const card = async (uid) => q1(`select * from public.v_crew_onboarding where user_id='${uid}'`);

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create role anon; create role authenticated;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create table public.tenants (id uuid primary key default gen_random_uuid());
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

  create table public.profiles (id uuid primary key, display_name text, role text not null default 'member',
    market text, leads_market text, referral_code text, is_admin boolean default false, is_driver boolean default false);
  create table public.offer_letters (id uuid primary key default gen_random_uuid(),
    candidate_user_id uuid, status text default 'draft', created_at timestamptz default now());
  create table public.operator_agreements (id uuid primary key default gen_random_uuid(),
    operator_user_id uuid, status text default 'draft', covers text[] default '{}',
    scope_basis text default 'standing', scope_until text, created_at timestamptz default now());
  create table public.academy_assignments (id uuid primary key default gen_random_uuid(), user_id uuid);
  create table public.academy_progress (id uuid primary key default gen_random_uuid(), user_id uuid);
  create table public.academy_acknowledgements (id uuid primary key default gen_random_uuid(), user_id uuid);
  create table public.user_activity (user_id uuid, seen_on date, last_seen_at timestamptz,
    logins int default 0, actions int default 0);
  create or replace view public.v_agreement_hours as
    select a.id as agreement_id, 0::numeric as hours_total, 0::numeric as hours_on_interim_work
      from public.operator_agreements a;

  -- exactly what production holds: promote_to_crew ran and nothing else did
  insert into public.profiles (id, display_name, role, market, leads_market) values
    ('${OP}',  'Ryan',  'operator', 'atlanta', 'atlanta'),
    ('${SRV}', 'Niño',  'server',   'atlanta', null);
`);

await db.exec(readFileSync(join(ROOT, "supabase/migrations/0311_a_person_is_not_a_row_of_fields.sql"), "utf8"));
console.log("0311 executed against a real Postgres.\n");

// ── the state of the real test hire ────────────────────────────────────────────────────────────
let c = await card(OP);
ok("the test operator reads as 1 of 7 — the market promote_to_crew set, and nothing else",
  Number(c.steps_done) === 1 && Number(c.steps_total) === 7, `${c.steps_done}/${c.steps_total}`);
ok("and the next step is the offer letter", c.next_step === "Offer letter drafted and sent", c.next_step);
// THE COLUMN THAT MAKES IT USEFUL.
ok("which is owed by YOU, not by them", c.next_step_owed_by === "you", c.next_step_owed_by);
ok("three of the remaining steps are yours", Number(c.waiting_on_you) === 3, c.waiting_on_you);
ok("three are theirs", Number(c.waiting_on_them) === 3, c.waiting_on_them);
ok("not fully onboarded", c.fully_onboarded === false);
ok("the market step is done and says which market", (await step(OP, "market")).done === true);
ok("and names it", (await step(OP, "market")).detail === "atlanta");
ok("the sign-in step says plainly that they never have",
  (await step(OP, "signed_in")).detail === "never signed in");

// ── a server needs no operator agreement ───────────────────────────────────────────────────────
const sAgr = await step(SRV, "agreement");
ok("a server's agreement step is done by not applying", sAgr.done === true);
ok("and says so rather than looking mysteriously complete", sAgr.detail === "not needed for this role");

// ── DERIVED, not stored: change the records and the state moves by itself ──────────────────────
await db.exec(`insert into public.offer_letters (candidate_user_id, status) values ('${OP}','draft')`);
ok("a DRAFT offer does not count as sent", (await step(OP, "offer")).done === false);
ok("and the detail says where it actually is", (await step(OP, "offer")).detail === "draft");
await db.exec(`update public.offer_letters set status='sent' where candidate_user_id='${OP}'`);
ok("sending it ticks the step with nothing told about it", (await step(OP, "offer")).done === true);
c = await card(OP);
ok("the card moves to 2 of 7 on its own", Number(c.steps_done) === 2, c.steps_done);
ok("and the next step becomes the agreement", c.next_step === "Operator agreement signed", c.next_step);

await db.exec(`insert into public.operator_agreements (operator_user_id, status) values ('${OP}','accepted')`);
ok("an ACCEPTED agreement is not a signed one — 0309 made those different facts",
  (await step(OP, "agreement")).done === false, (await step(OP, "agreement")).detail);
await db.exec(`update public.operator_agreements set status='signed' where operator_user_id='${OP}'`);
ok("signing it ticks", (await step(OP, "agreement")).done === true);

await db.exec(`insert into public.academy_assignments (user_id) values ('${OP}'), ('${OP}')`);
ok("assigning the academy ticks and counts", (await step(OP, "academy")).done === true);
ok("with the number", (await step(OP, "academy")).detail === "2 assigned");
c = await card(OP);
ok("now 4 of 7, and nothing is left on your side", Number(c.steps_done) === 4 && Number(c.waiting_on_you) === 0,
  `${c.steps_done}/7 you=${c.waiting_on_you}`);
// THE HANDOVER. This is the moment the answer to "where do I resume" changes hands.
ok("and the next step is owed by THEM", c.next_step_owed_by === "them", c.next_step_owed_by);
ok("named as the sign-in", c.next_step === "They have signed in at least once", c.next_step);

await db.exec(`insert into public.user_activity (user_id, seen_on, last_seen_at, logins, actions)
  values ('${OP}', current_date, now(), 1, 3)`);
await db.exec(`insert into public.academy_progress (user_id) values ('${OP}')`);
await db.exec(`insert into public.academy_acknowledgements (user_id) values ('${OP}')`);
c = await card(OP);
ok("all seven done", Number(c.steps_done) === 7, c.steps_done);
ok("fully onboarded flips true", c.fully_onboarded === true);
ok("and there is no next step left to name", c.next_step === null, c.next_step);

// ── one row per person, instead of seven screens ───────────────────────────────────────────────
const p = await q1(`select * from public.v_crew_person where user_id='${OP}'`);
ok("the person row carries their identity", p.display_name === "Ryan" && p.role === "operator");
ok("their market and what they lead", p.market === "atlanta" && p.leads_market === "atlanta");
ok("their onboarding position", Number(p.steps_done) === 7);
ok("their agreement, from a different screen entirely", p.agreement_status === "signed");
ok("and when they were last seen", p.last_seen_at !== null);
ok("plus active days in the last 30", Number(p.active_days_30) === 1, p.active_days_30);
const ps = await q1(`select * from public.v_crew_person where user_id='${SRV}'`);
ok("a person with no agreement still gets a row rather than vanishing from the join",
  ps !== undefined && ps.display_name === "Niño" && ps.agreement_id === null);

// ── AN OWNER IS NOT WAITING ON AN OFFER LETTER FROM THEMSELVES ────────────────────────────────
// Caught by reading the view against the real crew rather than the fixture: it was asking both
// owners for an offer letter and an Academy assignment. A step nobody can complete holds the card
// permanently short of done and teaches people to ignore the number.
await db.exec(`insert into public.profiles (id, display_name, role, market) values
  ('00000000-0000-0000-0000-0000000000c5','Kayla','owner','greenville')`);
const OWN = "00000000-0000-0000-0000-0000000000c5";
ok("an owner is not asked for an offer letter", (await step(OWN, "offer")).done === true);
ok("and it says why rather than looking mysteriously complete",
  (await step(OWN, "offer")).detail === "not needed — they are the company");
ok("nor for an Academy assignment", (await step(OWN, "academy")).done === true);
ok("an owner needs no operator agreement either", (await step(OWN, "agreement")).done === true);
// but the one that really does apply to them still does
ok("food safety DOES still apply to an owner — they touch the product too",
  (await step(OWN, "food_safety")).done === false);
const oc = await card(OWN);
ok("so an owner with a market starts at 4 of 7, not 1",
  Number(oc.steps_done) === 4, oc.steps_done);
ok("with nothing left on the company's side", Number(oc.waiting_on_you) === 0, oc.waiting_on_you);
ok("and the next step is theirs", oc.next_step_owed_by === "them", oc.next_step_owed_by);

// a customer is not crew and must not appear
await db.exec(`insert into public.profiles (id, display_name, role) values ('00000000-0000-0000-0000-0000000000c9','A Customer','member')`);
ok("customers are not on the crew list",
  Number((await q1(`select count(*) as n from public.v_crew_person`)).n) === 3);
// ...unless they carry the legacy is_admin boolean, which really does grant admin (0035)
await db.exec(`update public.profiles set is_admin = true where display_name = 'A Customer'`);
ok("but a member carrying the legacy is_admin flag DOES appear — because that flag really grants it",
  Number((await q1(`select count(*) as n from public.v_crew_person`)).n) === 4);

// ── ledger + changelog ─────────────────────────────────────────────────────────────────────────
ok("0311 recorded itself", Number((await q1(`select count(*) as n from public.schema_migrations where version='0311_a_person_is_not_a_row_of_fields'`)).n) === 1);
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0311_a_person_is_not_a_row_of_fields.sql"), "utf8"));
ok("re-running is safe", Number((await q1(`select count(*) as n from public.changelog`)).n) === 1);

console.log(`\nA PERSON IS NOT A ROW OF FIELDS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
