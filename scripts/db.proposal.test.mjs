// A PROPOSAL CAN BE SENT, AND WON, AGAIN — 0345, against a real Postgres.
//
// The bug is proved from 0180's own file: over opportunities with 0265's check, "Mark sent" and
// "Mark won" roll back. Then 0345: each decision moves the account forward on 0265's enum and never
// backward, lost carries its note to the card, and who may decide is unchanged.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s, p) => (await db.query(s, p)).rows[0];
const raises = async (s, p) => { try { await db.query(s, p); return null; } catch (e) { return String(e.message || e); } };
const OWNER = "00000000-0000-0000-0000-0000000000a1", REP = "00000000-0000-0000-0000-0000000000a2";
const as = (uid, admin) => db.exec(`select set_config('test.uid', '${uid}', false), set_config('test.admin', '${admin ? "on" : "off"}', false);`);

await db.exec(`
  create schema if not exists auth;
  create role anon; create role authenticated;
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create or replace function public.is_staff() returns boolean language sql stable as $$ select true $$;
  create or replace function public.is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin', true), 'off') = 'on' $$;
  create table public.profiles (id uuid primary key);
  insert into public.profiles values ('${OWNER}'), ('${REP}');
  create table public.changelog (id uuid primary key default gen_random_uuid(), title text, category text, area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null, applied_at timestamptz, recorded_at timestamptz not null default now(), applied_by uuid, applied_count int not null default 1, evidence text not null default 'stamped', note text);
  create or replace function public.record_migration(p_version text, p_note text default null) returns public.schema_migrations language plpgsql as $$
  declare r public.schema_migrations; begin
    insert into public.schema_migrations (version, seq, applied_at, note) values (p_version, substring(p_version from '^[0-9]+')::int, now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1 returning * into r; return r; end $$;
  -- opportunities with 0265's law
  create table public.opportunities (id uuid primary key default gen_random_uuid(), stage text not null default 'lead',
    won_at timestamptz, lost_at timestamptz, lost_reason text, updated_at timestamptz);
  alter table public.opportunities add constraint opportunities_stage_check check (stage in ('lead','warm','sampled','pilot','live','expand','lost'));
  -- 0180's proposals + trail (tenant, RLS and realtime left out — not what is under test)
  create table public.proposals (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null unique references public.opportunities(id) on delete cascade,
    strategy text, status text not null default 'draft' check (status in ('draft','in_review','sent','negotiating','won','lost')),
    decision_note text, decided_by uuid references public.profiles(id), decided_at timestamptz, created_by uuid references public.profiles(id),
    updated_by uuid references public.profiles(id), updated_at timestamptz not null default now(), created_at timestamptz not null default now());
  create table public.proposal_events (id uuid primary key default gen_random_uuid(), proposal_id uuid not null references public.proposals(id) on delete cascade,
    from_status text, to_status text not null, note text, actor_id uuid references public.profiles(id), at timestamptz not null default now());
`);
const src180 = readFileSync(join(ROOT, "supabase/migrations/0180_deal_proposals.sql"), "utf8");
await db.exec(src180.slice(src180.indexOf("create or replace function public.advance_proposal"), src180.indexOf("revoke all on function public.advance_proposal(uuid, text, text) from public, anon;")));
const opp = async (stage) => (await q1(`insert into public.opportunities (stage) values ($1) returning id`, [stage])).id;
const advance = (id, to, note = null) => raises(`select public.advance_proposal($1, $2, $3)`, [id, to, note]);
const row = (id) => q1(`select stage, won_at, lost_at, lost_reason from public.opportunities where id = $1`, [id]);

// ── 1 · THE BUG ────────────────────────────────────────────────────────────────────────────────
await as(OWNER, true);
const a = await opp("warm");
const sentErr = await advance(a, "sent");
ok("0180 over 0265's check: Mark sent rolls back", /opportunities_stage_check/.test(sentErr ?? ""), sentErr);
const wonErr = await advance(a, "won");
ok("0180 over 0265's check: Mark won rolls back", /opportunities_stage_check/.test(wonErr ?? ""), wonErr);
ok("…and nothing of either call survived — not even the proposal it began by creating", (await q1(`select count(*)::int as n from public.proposals where opportunity_id = $1`, [a])).n === 0);

// ── 2 · 0345 ───────────────────────────────────────────────────────────────────────────────────
const SQL = readFileSync(join(ROOT, "supabase/migrations/0345_a_proposal_can_be_sent_and_won_again.sql"), "utf8");
await db.exec(SQL);
await as(REP, false);
ok("sent moves a warm account to sampled (0265: proposal → sampled)", (await advance(a, "sent")) === null && (await row(a)).stage === "sampled");
const lead = await opp("lead");
ok("…and a lead", (await advance(lead, "sent")) === null && (await row(lead)).stage === "sampled");
const pilot = await opp("pilot");
ok("a proposal never moves an account backward: piloting stays piloting", (await advance(pilot, "sent")) === null && (await row(pilot)).stage === "pilot");
ok("the decision is still the owner's: a rep cannot mark it won", /only the owner records the decision/.test((await advance(a, "won")) ?? ""));
await as(OWNER, true);
ok("won makes it live, and stamps won_at (0265: won_at is when it goes live)", (await advance(a, "won")) === null && (await row(a)).stage === "live" && (await row(a)).won_at !== null);
const expand = await opp("expand");
ok("won on an account already expanding leaves it expanding, won_at untouched", (await advance(expand, "won")) === null && (await row(expand)).stage === "expand" && (await row(expand)).won_at === null);
const lost = await opp("sampled");
ok("lost is lost, with the decision's words as the card's reason", (await advance(lost, "lost", "Went with a vendor in-house")) === null
  && (await row(lost)).stage === "lost" && (await row(lost)).lost_reason === "Went with a vendor in-house" && (await row(lost)).lost_at !== null);
await db.query(`update public.opportunities set lost_reason = 'Budget' where id = $1`, [pilot]);
ok("an empty lost note keeps the reason already there", (await advance(pilot, "lost", "  ")) === null && (await row(pilot)).lost_reason === "Budget");
ok("the trail still records every move", Number((await q1(`select count(*)::int as n from public.proposal_events e join public.proposals p on p.id = e.proposal_id where p.opportunity_id = $1`, [a])).n) === 2);

// ── 3 · TWICE ──────────────────────────────────────────────────────────────────────────────────
await db.exec(SQL);
ok("0345 twice: one changelog row", (await q1(`select count(*)::int as n from public.changelog where area = 'Pipeline'`)).n === 1);
ok("0345 twice: the ledger counts the re-run", (await q1(`select applied_count from public.schema_migrations where version = '0345_a_proposal_can_be_sent_and_won_again'`)).applied_count === 2);

console.log(`\nPROPOSALS (0345): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
