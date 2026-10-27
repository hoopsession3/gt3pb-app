// 0458 — WHAT WAS APPROVED STAYS APPROVED, IN POSTGRES (2026-10-27 — the baseline challenge's F7 and F8: "Ensure investor
// links reference immutable approved snapshots… Never rewrite an earlier approved plan").
//
// The whole schema to 0457 is loaded with a plan already approved and a link already sent, then 0458 applied twice. What is
// read: the existing approval becomes version 1 and the existing link still shows it; a new approval is version 2 and the
// link sent before it does NOT change — its money, risks, case words and research stay as approved; only an owner moves
// the pin, and then the link shows version 2; versions are never updated or deleted, by anyone; an admin reads them, the
// crew and a member don't; an acknowledgement recorded with the baseline is a version too; revoked and expired links
// still show nothing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M458 = readFileSync(join(ROOT, "supabase/migrations/0458_what_was_approved_stays_approved.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c458000-0000-4000-8000-0000000000a1", ADMIN = "0c458000-0000-4000-8000-0000000000a2";
const CREW = "0c458000-0000-4000-8000-0000000000b2", MEMBER = "0c458000-0000-4000-8000-0000000000c3";

const db = await fullSchema({ before: "0458" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
for (const [id, role] of [[OWNER, "owner"], [ADMIN, "admin"], [CREW, "server"], [MEMBER, "member"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
const as = async (who, sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const door = async (token) => { await db.exec(`set role anon;`); try { return (await db.query(`select public.vision_shared($1) v`, [token])).rows[0].v; } catch (e) { return { error: e.message }; } finally { await db.exec(`reset role;`); } };
const tick = () => db.exec(`select pg_sleep(0.02);`);
const base = (orders) => JSON.stringify({ scenarios: { base: { ordersPerDay: orders, avgOrderCents: 850 } }, structure: { kind: "rev_share", amountCents: 4000000, sharePct: 6, capMultiple: 1.5 } });

// Before 0458: a plan with its case approved, a risk, an accepted finding, and a link sent showing all of it.
const plan = (await q(`select id from public.vision_plans order by phase limit 1`))[0];
await q(`update public.vision_plans set shareable = true, customer = 'Gym members after a session' where id = $1`, [plan.id]);
await q(`insert into public.vision_plan_risks (plan_id, kind, words) values ($1, 'risk', 'Members skip the bar')`, [plan.id]);
await q(`insert into public.vision_research (plan_id, topic, claim, source_url, status, bearing, retrieved_at) values ($1, 'demand', 'Members ask for a bar', 'https://example.test/a', 'accepted', 'for', now() - interval '1 day')`, [plan.id]);
const ap1 = await as(OWNER, `insert into public.vision_plan_money (plan_id, scenarios, baseline) values ($1, '{}'::jsonb, $2::jsonb) returning id`, [plan.id, base(90)]);
ok("before 0458: an owner approves the case", Array.isArray(ap1) && ap1.length === 1, ap1);
const sent = await q1(`insert into public.vision_shares (label, money_plans, research_plans) values ('Sent before 0458', array[$1::uuid], array[$1::uuid]) returning id, token`, [plan.id]);
const beforeView = await door(sent.token);
ok("before 0458: the link shows the approved case", beforeView.plans?.[0]?.money?.baseline?.scenarios?.base?.ordersPerDay === 90, beforeView.plans?.[0]?.money);

await db.exec(M458);
await db.exec(M458);
ok("0458 twice: recorded (applied twice)", (await q1(`select applied_count::int n from public.schema_migrations where version like '0458%'`)).n === 2);
const v1 = await q(`select version, baseline->'scenarios'->'base'->>'ordersPerDay' o, plan->>'customer' c, jsonb_array_length(research) r, jsonb_array_length(risks) k from public.vision_plan_versions where plan_id = $1 order by version`, [plan.id]);
ok("the existing approval is version 1 — once, however often 0458 runs — with its case, research and risks", v1.length === 1 && v1[0].version === 1 && v1[0].o === "90" && v1[0].c === "Gym members after a session" && v1[0].r === 1 && v1[0].k === 1, v1);
ok("the existing link is pinned and still shows exactly what it showed", (await door(sent.token)).plans?.[0]?.money?.baseline?.scenarios?.base?.ordersPerDay === 90);
ok("…and says which version it shows", (await door(sent.token)).plans?.[0]?.money?.version === 1);

// A new approval after the link was sent: the link does not move.
await tick();
await q(`update public.vision_plans set customer = 'Everyone in the building' where id = $1`, [plan.id]);
await q(`update public.vision_plan_risks set words = 'Rent doubles' where plan_id = $1`, [plan.id]);
await q(`insert into public.vision_research (plan_id, topic, claim, source_url, status, bearing, retrieved_at) values ($1, 'competition', 'A cafe opens next door', 'https://example.test/b', 'accepted', 'against', now())`, [plan.id]);
const ap2 = await as(OWNER, `update public.vision_plan_money set baseline = $2::jsonb where plan_id = $1 returning id`, [plan.id, base(140)]);
ok("an owner approves new numbers", Array.isArray(ap2) && ap2.length === 1, ap2);
const vs = await q(`select version, baseline->'scenarios'->'base'->>'ordersPerDay' o from public.vision_plan_versions where plan_id = $1 order by version`, [plan.id]);
ok("…which is version 2, and version 1 is still there to read", vs.length === 2 && vs[0].o === "90" && vs[1].o === "140", vs);
const pinned = (await door(sent.token)).plans?.[0];
ok("the link sent before it still shows version 1's numbers", pinned?.money?.baseline?.scenarios?.base?.ordersPerDay === 90 && pinned?.money?.version === 1, pinned?.money);
ok("…its risks as approved", pinned?.risks?.[0]?.words === "Members skip the bar", pinned?.risks);
ok("…its case words as approved", pinned?.customer === "Gym members after a session", pinned?.customer);
ok("…and the research accepted then, not the finding added after", pinned?.research?.length === 1 && pinned.research[0].claim === "Members ask for a bar", pinned?.research);

// Only an owner moves the pin.
const adminMove = await as(ADMIN, `update public.vision_shares set pinned_at = now() where id = $1 returning id`, [sent.id]);
ok("an admin can't move a link to the newer approval", !!adminMove.error && /Only an owner/.test(adminMove.error), adminMove);
const ownerMove = await as(OWNER, `update public.vision_shares set pinned_at = now() where id = $1 returning id`, [sent.id]);
ok("an owner can", Array.isArray(ownerMove) && ownerMove.length === 1, ownerMove);
const moved = (await door(sent.token)).plans?.[0];
ok("…and then the link shows version 2, with today's case words, risks and research", moved?.money?.version === 2 && moved?.money?.baseline?.scenarios?.base?.ordersPerDay === 140
  && moved?.customer === "Everyone in the building" && moved?.risks?.[0]?.words === "Rent doubles" && moved?.research?.length === 2, moved);
const future = await as(OWNER, `update public.vision_shares set pinned_at = now() + interval '30 days' where id = $1 returning pinned_at <= now() + interval '1 second' ok`, [sent.id]);
ok("a pin can't be set in the future (it would show approvals not yet made)", future?.[0]?.ok === true, future);

// A link made after version 2 shows version 2; an admin making a link can't back-date it.
await tick();
const late = await as(ADMIN, `insert into public.vision_shares (label, pinned_at) values ('Made by an admin', now() - interval '10 years') returning id, token, pinned_at > now() - interval '1 minute' fresh`);
ok("an admin's new link is pinned to the moment it's made, whatever it asks for", late?.[0]?.fresh === true, late);

// Never rewritten.
const upd = await as(OWNER, `update public.vision_plan_versions set baseline = '{"scenarios":{},"structure":{}}'::jsonb where plan_id = $1`, [plan.id]);
ok("an owner can't change an approved version", !!upd.error || (Array.isArray(upd) && upd.length === 0), upd);
let svcUpd; try { await q(`update public.vision_plan_versions set approved_by = null where plan_id = $1`, [plan.id]); svcUpd = "allowed"; } catch (e) { svcUpd = e.message; }
ok("…nor can the service role", /never changed or removed/.test(svcUpd), svcUpd);
let svcDel; try { await q(`delete from public.vision_plan_versions where plan_id = $1`, [plan.id]); svcDel = "allowed"; } catch (e) { svcDel = e.message; }
ok("…and nobody can delete one", /never changed or removed/.test(svcDel), svcDel);
const forged = await as(OWNER, `insert into public.vision_plan_versions (plan_id, version, baseline) values ($1, 9, '{"scenarios":{},"structure":{}}'::jsonb)`, [plan.id]);
ok("a version can't be written by hand — only an approval writes one", !!forged.error, forged);

// Who reads them.
ok("an admin reads the versions", (await as(ADMIN, `select count(*)::int n from public.vision_plan_versions`))[0]?.n === 2);
ok("the crew don't", (await as(CREW, `select count(*)::int n from public.vision_plan_versions`))[0]?.n === 0);
ok("a member doesn't", (await as(MEMBER, `select count(*)::int n from public.vision_plan_versions`))[0]?.n === 0);
await db.exec(`set role anon;`);
let anon; try { anon = (await db.query(`select count(*)::int n from public.vision_plan_versions`)).rows; } catch (e) { anon = { error: e.message }; } finally { await db.exec(`reset role;`); }
ok("signed out, nothing", !Array.isArray(anon) || anon[0]?.n === 0, anon);

// An acknowledgement recorded with the baseline (IP1.3) is a new version; saving working numbers is not.
await tick();
await as(OWNER, `update public.vision_plan_money set baseline = baseline || '{"acknowledged":[{"key":"no_downside","note":"Run next week"}]}'::jsonb where plan_id = $1`, [plan.id]);
await as(OWNER, `update public.vision_plan_money set scenarios = '{"base":{"ordersPerDay":999}}'::jsonb where plan_id = $1`, [plan.id]);
const after = await q(`select version, baseline->'acknowledged'->0->>'key' k from public.vision_plan_versions where plan_id = $1 order by version`, [plan.id]);
ok("an acknowledgement is version 3; saving the working numbers writes nothing", after.length === 3 && after[2].k === "no_downside", after);

// The doors still close.
await q(`update public.vision_shares set revoked_at = now() where id = $1`, [sent.id]);
ok("a revoked link shows nothing at all", !!(await door(sent.token)).error);
await q(`update public.vision_shares set expires_at = now() - interval '1 minute' where id = $1`, [late[0].id]);
ok("an expired link shows nothing at all", !!(await door(late[0].token)).error);

console.log(`0458 — WHAT WAS APPROVED STAYS APPROVED: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
