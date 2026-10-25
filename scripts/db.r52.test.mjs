// R52 — THE PLAN PEOPLE CAN SEE (0447), IN POSTGRES (2026-10-25 — Ryan: "Allow me a place to interactively build my
// roadmap… design a brick-and-mortar 3D design place… show people in real time what we're doing and what we're
// planning… where investors may be needed").
//
// The whole schema to 0446 is loaded; then 0447, twice. What is read: five tables, each with its tenant stamp, RLS, the
// history trigger and no grant to anon; the first draft lands once — 7 programs, 19 things in the room, 3 asks at $0 —
// with no espresso anywhere; the crew read the plan but can't change it or see the links; an owner changes it; a member
// sees nothing; a link opens for someone signed out through vision_shared alone — counted, the money hidden when the
// link says so, nothing of who wrote it — and a wrong or turned-off link is PT404.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M447 = readFileSync(join(ROOT, "supabase/migrations/0447_the_plan_people_can_see.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c452000-0000-4000-8000-0000000000a1";
const CREW = "0c452000-0000-4000-8000-0000000000b2";
const MEMBER = "0c452000-0000-4000-8000-0000000000c3";
const TABLES = ["store_layouts", "vision_programs", "vision_asks", "store_items", "vision_shares"];

const db = await fullSchema({ before: "0447" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
for (const [id, role] of [[OWNER, "owner"], [CREW, "server"], [MEMBER, "member"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}

await db.exec(M447);
await db.exec(M447);
ok("0447 twice: recorded (applied twice)", (await q1(`select applied_count::int n from public.schema_migrations where version like '0447%'`)).n === 2);

// ── the tables ─────────────────────────────────────────────────────────────────────────────────────────────────────
for (const t of TABLES) {
  const rls = (await q1(`select relrowsecurity r from pg_class where oid = ('public.' || $1)::regclass`, [t])).r;
  const trig = (await q(`select tgname from pg_trigger where tgrelid = ('public.' || $1)::regclass and not tgisinternal order by 1`, [t])).map((r) => r.tgname);
  const anon = (await q1(`select has_table_privilege('anon', 'public.' || $1, 'select') a`, [t])).a;
  const iso = (await q1(`select count(*)::int n from pg_policies where tablename = $1 and policyname = 'tenant isolation' and permissive = 'RESTRICTIVE'`, [t])).n;
  ok(`${t}: RLS on, tenant isolated, stamped, in the history — and nothing for anon`, rls && iso === 1 && trig.includes("stamp_tenant_tg") && trig.includes(`admin_audit_${t}`) && !anon, { rls, iso, trig, anon });
}

// ── the first draft ────────────────────────────────────────────────────────────────────────────────────────────────
const n = async (t) => (await q1(`select count(*)::int n from public.${t}`)).n;
ok("the first draft, once (0447 ran twice): 1 room, 19 things, 7 programs, 3 asks",
  (await n("store_layouts")) === 1 && (await n("store_items")) === 19 && (await n("vision_programs")) === 7 && (await n("vision_asks")) === 3,
  { l: await n("store_layouts"), i: await n("store_items"), p: await n("vision_programs"), a: await n("vision_asks") });
ok("the asks start at $0 — the amounts are Ryan's to set, never invented", (await q1(`select coalesce(sum(amount_cents), 0)::int s from public.vision_asks`)).s === 0);
ok("no espresso anywhere in the draft — kinds, names, reasons", (await q1(`select count(*)::int n from public.store_items where kind ~* 'espresso' or label ~* 'espresso' and label !~* 'no espresso'`)).n === 0);
ok("every thing in the room says why it's there", (await q1(`select count(*)::int n from public.store_items where why is null`)).n === 0);
const noPillar = (await q(`select kind from public.store_items where cardinality(pillars) = 0 order by kind`)).map((r) => r.kind);
ok("…and serves a pillar, but for what the code requires (sinks, the restroom) — no pillar claimed for those",
  JSON.stringify(noPillar) === JSON.stringify(["hand_sink", "restroom", "three_sink"]), noPillar);
ok("the first store links to its room", (await q1(`select count(*)::int n from public.vision_programs where layout_id is not null and horizon = 'next'`)).n === 1);
let bad = null;
try { await q(`insert into public.vision_programs (title, pillars) values ('x', '{caffeine}')`); } catch (e) { bad = e.message; }
ok("a pillar outside the four is refused", !!bad, bad);
bad = null;
try { await q(`insert into public.store_items (layout_id, kind, x_in, y_in, rot, w_in, d_in, h_in) select id, 'bench', 10, 10, 45, 10, 10, 10 from public.store_layouts limit 1`); } catch (e) { bad = e.message; }
ok("a thing turned 45° is refused (0, 90, 180 or 270)", !!bad, bad);

// ── who sees what ──────────────────────────────────────────────────────────────────────────────────────────────────
const as = async (who, sql, p) => {
  await db.exec(who ? `select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;` : `set role anon;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const share = await q1(`insert into public.vision_shares (label, show_asks, created_by) values ('For the bank', false, $1) returning id, token`, [OWNER]);
const open = await q1(`insert into public.vision_shares (label, created_by) values ('For a partner', $1) returning id, token`, [OWNER]);
ok("a link's token: 64 characters, nobody's to guess", share.token.length === 64 && share.token !== open.token);

const crewRead = await as(CREW, `select count(*)::int n from public.vision_programs`);
ok("the crew read the plan", crewRead[0]?.n === 7, crewRead);
const crewWrite = await as(CREW, `update public.vision_programs set title = title || '!' returning id`);
ok("…but don't change it", Array.isArray(crewWrite) && crewWrite.length === 0, crewWrite);
const crewLinks = await as(CREW, `select count(*)::int n from public.vision_shares`);
ok("…and don't see the links (an owner's to hand out)", crewLinks[0]?.n === 0, crewLinks);
const memberRead = await as(MEMBER, `select (select count(*) from public.vision_programs)::int p, (select count(*) from public.store_items)::int i`);
ok("a member sees none of it", memberRead[0]?.p === 0 && memberRead[0]?.i === 0, memberRead);
const anonRead = await as(null, `select count(*) from public.vision_programs`);
ok("signed out, the tables are closed", !!anonRead.error, anonRead);
const ownerWrite = await as(OWNER, `update public.vision_programs set summary = 'Ready by spring.' where horizon = 'next' returning id`);
ok("an owner changes it", Array.isArray(ownerWrite) && ownerWrite.length === 1, ownerWrite);
ok("…and the change is in the history", (await q1(`select count(*)::int n from public.admin_audit where table_name = 'vision_programs' and action = 'UPDATE' and actor = $1`, [OWNER])).n >= 1);
const ownerLinks = await as(OWNER, `select count(*)::int n from public.vision_shares`);
ok("an owner sees the links", ownerLinks[0]?.n === 2, ownerLinks);

// ── a link, opened by someone signed out ───────────────────────────────────────────────────────────────────────────
const viaLink = await as(null, `select public.vision_shared($1) v`, [open.token]);
const v = viaLink[0]?.v;
ok("a live link opens for someone signed out: the plan, the room and the asks", v && v.programs.length === 7 && v.layouts[0]?.items.length === 19 && v.asks.length === 3 && v.label === "For a partner", viaLink);
ok("…and says nothing of who wrote it or the link's own id", v && !JSON.stringify(v).includes(OWNER) && !JSON.stringify(v).includes(open.id) && !JSON.stringify(v).includes("created_by"));
const hidden = (await as(null, `select public.vision_shared($1) v`, [share.token]))[0]?.v;
ok("a link without the money shows no asks", hidden && hidden.show_asks === false && hidden.asks.length === 0 && hidden.programs.length === 7, hidden && { show_asks: hidden.show_asks, asks: hidden.asks.length });
await as(null, `select public.vision_shared($1) v`, [open.token]);
const counted = await q1(`select opens, last_opened_at is not null seen from public.vision_shares where id = $1`, [open.id]);
ok("every open is counted, with when", counted.opens === 2 && counted.seen, counted);
const wrong = await as(null, `select public.vision_shared($1) v`, ["f".repeat(64)]);
ok("a wrong link: PT404, \"This link isn't live.\"", wrong.code === "PT404" && /isn't live/.test(wrong.error), wrong);
const short = await as(null, `select public.vision_shared($1) v`, ["abc"]);
ok("a too-short token: PT404 before any read", short.code === "PT404", short);
await q(`update public.vision_shares set revoked_at = now() where id = $1`, [open.id]);
const off = await as(null, `select public.vision_shared($1) v`, [open.token]);
ok("a link turned off: PT404, the same as a wrong one", off.code === "PT404", off);

console.log(`R52 — THE PLAN PEOPLE CAN SEE (0447, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
