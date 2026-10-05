// A MILESTONE NAMES ITS WORKSTREAM — 0350, against a real Postgres.
//
// The tables are made by their own migrations — 0201 (initiatives and milestones, with the Aug-1
// launch's seed and its six words), 0202 (the ties), 0264 (the portfolio, seeded with the ten
// workstreams of the 8/2 audit) — then the two columns 0275 and 0307 added to the portfolio, and the
// result is held to production's column list (supabase/schema.columns.json, less the column 0350
// adds — production has run it since) before 0350 runs here. Then:
// the link, the words that follow it, what the backfill links and what it leaves, and the rule the
// backfill and lib/portfolio.matchStream share, run over one list of cases
// (scripts/fixtures/workstream-words.json) from the backfill's own text.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const rows = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await rows(s, p))[0];
const raises = async (s, p) => { try { await db.query(s, p); return null; } catch (e) { return String(e.message || e); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const mig = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");

await db.exec(`
  create schema if not exists auth;
  create role anon; create role authenticated;
  -- As Supabase sets it up: every function made in public is executable by anon and authenticated by
  -- an explicit grant, so "revoke ... from public" alone takes nothing away from either.
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create or replace function public.is_staff() returns boolean language sql stable as $$ select true $$;
  create or replace function public.is_admin() returns boolean language sql stable as $$ select true $$;
  create or replace function public.effective_tenant() returns uuid language sql stable as $$ select '${T1}'::uuid $$;
  create or replace function public.stamp_tenant() returns trigger language plpgsql as $$
    begin if new.tenant_id is null then new.tenant_id := public.effective_tenant(); end if; return new; end $$;
  create table public.changelog (id uuid primary key default gen_random_uuid(), title text, category text, area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null, applied_at timestamptz, recorded_at timestamptz not null default now(), applied_by uuid, applied_count int not null default 1, evidence text not null default 'stamped', note text);
  create or replace function public.record_migration(p_version text, p_note text default null) returns public.schema_migrations language plpgsql as $$
  declare r public.schema_migrations; begin
    insert into public.schema_migrations (version, seq, applied_at, note) values (p_version, substring(p_version from '^[0-9]+')::int, now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1 returning * into r; return r; end $$;
  create table public.tenants (id uuid primary key);
  insert into public.tenants values ('${T1}');
  create table public.profiles (id uuid primary key default gen_random_uuid(), display_name text);
  create table public.todos (id uuid primary key default gen_random_uuid());
  create table public.event_tasks (id uuid primary key default gen_random_uuid());
`);

// ── 0 · the tables, made the way production made them ──────────────────────────────────────────
await db.exec(mig("0201_initiatives.sql"));
await db.exec(mig("0202_initiative_flex.sql"));
await db.exec(mig("0264_gt3_command_registry.sql"));
// 0275 stamped a market on both; 0307 gave a workstream its owner as a person.
await db.exec(`
  alter table public.initiatives add column if not exists market text not null default 'greenville';
  alter table public.os_workstreams add column if not exists market text not null default 'greenville';
  alter table public.os_workstreams add column if not exists owner_user_id uuid references public.profiles(id) on delete set null;
`);
const snap = JSON.parse(readFileSync(join(ROOT, "supabase/schema.columns.json"), "utf8"));
// Production's columns as they stood before 0350: the snapshot's, less the one column 0350 adds. The
// snapshot was pulled again once 0350 was applied in production (2026-10-05), so it carries the link.
const ADDS = { initiative_milestones: ["workstream_id"] };
const before350 = (t) => (snap[t] ?? []).filter((c) => !(ADDS[t] ?? []).includes(c));
const colsOf = async (t) => (await rows(`select attname from pg_attribute where attrelid = ('public.' || $1)::regclass and attnum > 0 and not attisdropped order by attnum`, [t])).map((r) => r.attname);
for (const t of ["initiatives", "initiative_milestones", "initiative_milestone_links", "os_workstreams"]) {
  const have = await colsOf(t);
  ok(`before 0350: ${t} has production's columns, in production's order`, JSON.stringify(have) === JSON.stringify(before350(t)), { have, prod: before350(t) });
}

// Production's board as Ryan's screen shows it: the seed's words, plus two milestones with none.
const AUG = (await q1(`select id from public.initiatives where title = 'Aug 1 Launch'`)).id;
await db.query(`insert into public.initiative_milestones (initiative_id, title, sort) values ($1, 'SCDA Permit', 9), ($1, 'Website copy edits', 10)`, [AUG]);
const stream = async (name) => (await q1(`select id from public.os_workstreams where name = $1`, [name]))?.id;
const EVENTS = await stream("Events"), PRINT = await stream("Print & Brand Assets"), D2C = await stream("D2C Delivery Ops");
ok("before 0350: the portfolio is the ten workstreams of the 8/2 audit", (await q1(`select count(*)::int as n from public.os_workstreams`)).n === 10 && !!EVENTS && !!PRINT && !!D2C);
const wordsBefore = (await rows(`select workstream from public.initiative_milestones where workstream is not null`)).map((r) => r.workstream).sort();
ok("before 0350: the milestones carry the launch's words, and only 'events' spells a workstream",
  JSON.stringify([...new Set(wordsBefore)]) === JSON.stringify(["branding", "content", "delivery", "events", "logistics", "vip"]), wordsBefore);
const eventsBefore = (await q1(`select count(*)::int as n from public.initiative_milestones where workstream = 'events'`)).n;

// ── 1 · 0350 ───────────────────────────────────────────────────────────────────────────────────
const SQL = mig("0350_a_milestone_names_its_workstream.sql");
const first = await (async () => { try { await db.exec(SQL); return null; } catch (e) { return String(e.message || e); } })();
ok("0350 runs", first === null, first);

const col = await q1(`select data_type from information_schema.columns where table_name = 'initiative_milestones' and column_name = 'workstream_id'`);
ok("the link: initiative_milestones.workstream_id is a uuid", col?.data_type === "uuid", col);
ok("the link: it is the last column — production's order plus one", JSON.stringify(await colsOf("initiative_milestones")) === JSON.stringify([...before350("initiative_milestones"), "workstream_id"]));
ok("the link: production has it where 0350 put it — the snapshot pulled after 0350 was applied",
  JSON.stringify(snap.initiative_milestones) === JSON.stringify([...before350("initiative_milestones"), "workstream_id"]), snap.initiative_milestones);
const fk = await q1(`select confdeltype, confrelid::regclass::text as ref from pg_constraint where conrelid = 'public.initiative_milestones'::regclass and contype = 'f'
  and conkey = array[(select attnum from pg_attribute where attrelid = 'public.initiative_milestones'::regclass and attname = 'workstream_id')]`);
ok("the link: it points at the portfolio, and a workstream that goes leaves the milestone standing (on delete set null)", fk?.ref === "os_workstreams" && fk?.confdeltype === "n", fk);
ok("the link: indexed", !!(await q1(`select 1 as x from pg_indexes where indexname = 'initiative_milestones_workstream_idx'`)));
ok("the link: not to the lanes — 0159's work_streams is a different animal", fk?.ref !== "work_streams");

// ── 2 · the backfill: what spells a workstream is linked, nothing else ─────────────────────────
const linked = await rows(`select m.title, m.workstream, s.name from public.initiative_milestones m join public.os_workstreams s on s.id = m.workstream_id order by m.sort`);
ok(`backfill: every 'events' milestone (${eventsBefore}) is linked to Events`, linked.length === eventsBefore && linked.every((r) => r.name === "Events"), linked);
ok("backfill: and its words are the workstream's name now", linked.every((r) => r.workstream === "Events"), linked);
const loose = await rows(`select workstream from public.initiative_milestones where workstream_id is null and workstream is not null order by workstream`);
ok("backfill: branding, content, delivery, logistics and vip are left as they were — nothing guessed",
  JSON.stringify(loose.map((r) => r.workstream)) === JSON.stringify(["branding", "content", "delivery", "logistics", "vip"]), loose);
ok("backfill: a milestone with no words has no workstream", (await q1(`select count(*)::int as n from public.initiative_milestones where title in ('SCDA Permit', 'Website copy edits') and workstream_id is null and workstream is null`)).n === 2);

// ── 3 · the words follow the link ──────────────────────────────────────────────────────────────
const mid = async (title) => (await q1(`select id from public.initiative_milestones where title = $1`, [title])).id;
const LOGO = await mid("Finalize logo designs — shirts, car magnets, digital");
const one = async (id) => q1(`select workstream, workstream_id from public.initiative_milestones where id = $1`, [id]);
await db.query(`update public.initiative_milestones set workstream_id = $1 where id = $2`, [PRINT, LOGO]);
ok("words: linking writes the workstream's name over the old word", JSON.stringify(await one(LOGO)) === JSON.stringify({ workstream: "Print & Brand Assets", workstream_id: PRINT }), await one(LOGO));
await db.query(`update public.initiative_milestones set workstream = 'branding' where id = $1`, [LOGO]);
ok("words: a write of other words to a linked milestone gets the name back — the words cannot say another stream", (await one(LOGO)).workstream === "Print & Brand Assets", await one(LOGO));
await db.query(`update public.initiative_milestones set workstream_id = $1, workstream = 'Print & Brand Assets' where id = $2`, [D2C, LOGO]);
ok("words: a link and stale words sent together — the link wins, the words follow it", JSON.stringify(await one(LOGO)) === JSON.stringify({ workstream: "D2C Delivery Ops", workstream_id: D2C }), await one(LOGO));
await db.query(`update public.initiative_milestones set title = 'Finalize logo designs' where id = $1`, [LOGO]);
ok("words: a save that leaves the workstream alone leaves it alone", JSON.stringify(await one(LOGO)) === JSON.stringify({ workstream: "D2C Delivery Ops", workstream_id: D2C }));
await db.query(`update public.initiative_milestones set workstream_id = null, workstream = null where id = $1`, [LOGO]);
ok("words: 'No workstream' clears both", JSON.stringify(await one(LOGO)) === JSON.stringify({ workstream: null, workstream_id: null }), await one(LOGO));
const NEWM = (await q1(`insert into public.initiative_milestones (initiative_id, title, workstream_id, workstream) values ($1, 'New one', $2, 'whatever') returning id`, [AUG, EVENTS])).id;
ok("words: a milestone made with a link gets the name, whatever words came with it", (await one(NEWM)).workstream === "Events", await one(NEWM));
const PLAIN = (await q1(`insert into public.initiative_milestones (initiative_id, title, workstream) values ($1, 'Typed', 'someday') returning id`, [AUG])).id;
ok("words: words with no link are kept as written — they link to nothing, and say so on the board", JSON.stringify(await one(PLAIN)) === JSON.stringify({ workstream: "someday", workstream_id: null }));
const bad = await raises(`update public.initiative_milestones set workstream_id = gen_random_uuid() where id = $1`, [PLAIN]);
ok("words: a workstream that is not in the portfolio is refused", /foreign key/i.test(bad ?? ""), bad);
ok("words: and the refusal left the milestone as it was", JSON.stringify(await one(PLAIN)) === JSON.stringify({ workstream: "someday", workstream_id: null }));
await db.query(`update public.initiative_milestones set workstream_id = null where id = $1`, [NEWM]);
ok("words: unlinked alone, the milestone keeps the name it was filed under", JSON.stringify(await one(NEWM)) === JSON.stringify({ workstream: "Events", workstream_id: null }), await one(NEWM));

// A workstream renamed: the board reads the name through the link, so the words are not rewritten.
const PHOTO = await mid("Atlanta content photoshoot (Jul 17-19)");
await db.query(`update public.initiative_milestones set workstream_id = $1 where id = $2`, [PRINT, PHOTO]);
await db.query(`update public.os_workstreams set name = 'Print, Brand & Content' where id = $1`, [PRINT]);
ok("rename: the link holds through a rename (the board shows the new name by it)", (await one(PHOTO)).workstream_id === PRINT);
// A workstream taken out of the portfolio: the milestone stands, with the words it was filed under.
await db.query(`delete from public.os_workstreams where id = $1`, [PRINT]);
const gone = await one(PHOTO);
ok("gone: removing a workstream un-links its milestones and keeps what they said", gone.workstream_id === null && gone.workstream === "Print & Brand Assets", gone);

// ── 4 · the function is the trigger's alone ────────────────────────────────────────────────────
for (const role of ["anon", "authenticated"]) {
  const can = (await q1(`select has_function_privilege($1, 'public.milestone_workstream_words()', 'execute') as c`, [role])).c;
  ok(`grants: ${role} cannot call milestone_workstream_words — it runs as its owner, for the trigger`, can === false, can);
}
const def = await q1(`select prosecdef, proconfig from pg_proc where proname = 'milestone_workstream_words'`);
ok("grants: it runs as its owner with its search_path pinned", def?.prosecdef === true && (def?.proconfig ?? []).some((c) => /^search_path=public/.test(c)), def);

// ── 5 · one rule in two languages: the backfill's own text over the shared cases ───────────────
const s3 = SQL.indexOf("-- ── 3)"), s4 = SQL.indexOf("-- ── what changed");
const backfill = SQL.slice(s3, s4);
ok("rule: the backfill was cut out of 0350's own text", /update public\.initiative_milestones m\s+set workstream_id = s\.id/.test(backfill) && /= 1;\s*$/.test(backfill.trim() + "\n"), backfill.length);
const fx = JSON.parse(readFileSync(join(ROOT, "scripts/fixtures/workstream-words.json"), "utf8"));
ok("rule: the shared list is there (at least 20 cases)", fx.groups.reduce((n, g) => n + g.cases.length, 0) >= 20);
for (const [gi, g] of fx.groups.entries()) {
  await db.exec(`delete from public.initiative_milestones; delete from public.os_workstreams;`);
  for (const [i, name] of g.streams.entries()) await db.query(`insert into public.os_workstreams (name, owner, sort) values ($1, '', $2)`, [name, i]);
  for (const [i, [words]] of g.cases.entries()) await db.query(`insert into public.initiative_milestones (initiative_id, title, workstream, sort) values ($1, $2, $3, $4)`, [AUG, `case ${i}`, words, i]);
  await db.exec(backfill);
  for (const [i, [words, want]] of g.cases.entries()) {
    const r = await q1(`select s.name from public.initiative_milestones m left join public.os_workstreams s on s.id = m.workstream_id where m.title = $1`, [`case ${i}`]);
    ok(`rule (group ${gi + 1}): ${JSON.stringify(words)} → ${JSON.stringify(want)}`, (r?.name ?? null) === want, r?.name ?? null);
  }
}

// ── 6 · the file again ─────────────────────────────────────────────────────────────────────────
const again = await (async () => { try { await db.exec(SQL); return null; } catch (e) { return String(e.message || e); } })();
ok("twice: the whole file runs again", again === null, again);
ok("twice: one trigger", (await rows(`select 1 from pg_trigger where tgrelid = 'public.initiative_milestones'::regclass and tgname = 'milestone_workstream_words'`)).length === 1);
ok("twice: one changelog row", (await q1(`select count(*)::int as n from public.changelog where title = 'A milestone is filed to a workstream from the portfolio'`)).n === 1);
ok("twice: the ledger says it ran, twice", (await q1(`select applied_count from public.schema_migrations where version = '0350_a_milestone_names_its_workstream'`))?.applied_count === 2);

console.log(`A MILESTONE NAMES ITS WORKSTREAM (0350): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
