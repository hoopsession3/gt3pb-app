// R45 — THE COURSE IS BOUGHT, AND THE PILLARS ARE GIVEN (0441, 0442), IN POSTGRES (2026-10-20 — Ryan: "rookies
// shouldn't be free, only the pillars"; the lessons locked with a preview kept; one GT3 Nutrition purchase opens it).
//
// The whole schema to 0440 is loaded, with the course's three seeded Rookie lessons (0272) and a Pro lesson beside them,
// each with drinks in its stack. Then 0441, twice: the preview is anyone's — every live lesson, no body, no key points,
// this business only — and nothing anyone reads changes, except that a stack is named only for a lesson its caller may
// read. Then 0442, twice: a lesson is a buyer's (a live 'pro' program_access row) or the crew's; a stranger and a member
// who hasn't bought read none; the preview still answers them; the stack is the buyer's and no longer anon's to ask.
import { fullSchema } from "./fixtures/schema.full.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M441 = readFileSync(join(ROOT, "supabase/migrations/0441_a_lessons_preview_is_anyones.sql"), "utf8");
const M442 = readFileSync(join(ROOT, "supabase/migrations/0442_the_course_is_bought_and_the_pillars_are_given.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001", T2 = "0c445000-0000-4000-8000-0000000000f2";
const OWNER = "0c445000-0000-4000-8000-0000000000a1", BUYER = "0c445000-0000-4000-8000-0000000000a2",
  READER = "0c445000-0000-4000-8000-0000000000a3", LAPSED = "0c445000-0000-4000-8000-0000000000a4";

const t0 = Date.now();
const db = await fullSchema({ before: "0441" });
console.log(`the schema to 0440 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};
await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
`);
await db.exec(`begin; set local gt3.allow_second_tenant = 'on';
  insert into public.tenants (id, slug, name) values ('${T2}', 'other-bar', 'Another Bar'); commit;`);
for (const [id, role] of [[OWNER, "owner"], [BUYER, "member"], [READER, "member"], [LAPSED, "member"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
const cust = async (uid) => (await q(`select id from public.customers where user_id = $1`, [uid]))[0].id;
await q(`insert into public.program_access (customer_id, tier, source, tenant_id) values ($1, 'pro', 'purchase', $2)`, [await cust(BUYER), T1]);
await q(`insert into public.program_access (customer_id, tier, source, tenant_id, revoked_at) values ($1, 'pro', 'purchase', $2, now())`, [await cust(LAPSED), T1]);

const rookie = (await q(`select id, slug from public.primal_lessons where tier = 'rookie' and published_at is not null order by sort`));
const mod = (await q(`select module_id from public.primal_lessons where id = $1`, [rookie[0].id]))[0].module_id;
const pro = (await q(`insert into public.primal_lessons (module_id, slug, title, summary, body, key_points, tier, sort, published_at, tenant_id)
  values ($1, 'pro-test', 'The Pro one', 'What Pro covers.', 'The body.', '["A key point"]', 'pro', 99, now(), $2) returning id`, [mod, T1]))[0].id;
await q(`insert into public.primal_lessons (module_id, slug, title, tier, sort, tenant_id) values ($1, 'draft-test', 'A draft', 'rookie', 98, $2)`, [mod, T1]);
const drink = (await q(`select slug from public.products order by slug limit 1`))[0]?.slug
  ?? (await q(`insert into public.products (slug, name, price_cents, tenant_id) values ('rise-test', 'RISE', 600, $1) returning slug`, [T1]))[0].slug;
for (const l of [rookie[0].id, pro]) await q(`insert into public.primal_lesson_products (lesson_id, product_slug, sort, tenant_id) values ($1, $2, 1, $3) on conflict do nothing`, [l, drink, T1]);
const lessons = async (uid) => (await as(uid, `select slug from public.primal_lessons order by sort, slug`)).rows.map((r) => r.slug);
const stack = async (uid, id) => as(uid, `select product_slug from public.primal_menu_for_lesson($1)`, [id]);
ok(`the course as seeded: ${rookie.length} live Rookie lessons, a Pro one, a draft`, rookie.length === 3);

// ── before: 0272's rule ───────────────────────────────────────────────────────────────────────────────────────────────
ok("before 0441: a stranger reads the Rookie lessons and not the Pro one", JSON.stringify((await lessons(null)).sort()) === JSON.stringify(rookie.map((r) => r.slug).sort()), await lessons(null));
ok("…and the stack function names the Pro lesson's drinks to a stranger — past RLS, for any id", (await stack(null, pro)).rows.length === 1);

// ── 0441 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(M441);
await db.exec(M441);
ok("0441 twice: recorded (applied twice), one preview function", (await q(`select applied_count::int n from public.schema_migrations where version like '0441%'`))[0].n === 2
  && (await q(`select count(*)::int n from pg_proc where proname = 'primal_lesson_previews'`))[0].n === 1);
const prev = await as(null, `select * from public.primal_lesson_previews()`);
ok("the preview is anyone's: every live lesson, Rookie and Pro, no draft", !prev.error && prev.rows.length === 4 && prev.rows.some((r) => r.slug === "pro-test") && !prev.rows.some((r) => r.slug === "draft-test"), prev);
ok("…its title, subtitle, level, minutes and summary — never the body or key points",
  JSON.stringify(Object.keys(prev.rows[0] ?? {}).sort()) === JSON.stringify(["est_minutes", "id", "module_id", "slug", "sort", "subtitle", "summary", "tier", "title"])
    && prev.rows.find((r) => r.slug === "pro-test")?.summary === "What Pro covers.", prev.rows[0]);
await q(`update public.profiles set tenant_id = $2 where id = $1`, [READER, T2]);
ok("…of this business only: someone in another sees none of ours", (await as(READER, `select * from public.primal_lesson_previews()`)).rows.length === 0);
await q(`update public.profiles set tenant_id = $2 where id = $1`, [READER, T1]);
ok("nothing read changes: a stranger still reads the Rookie lessons", (await lessons(null)).length === 3);
ok("…but the stack function names a lesson's drinks only to whoever may read it: the Rookie one to a stranger, the Pro one not",
  (await stack(null, rookie[0].id)).rows.length > 0 && (await stack(null, pro)).rows.length === 0 && (await stack(BUYER, pro)).rows.length === 1 && (await stack(OWNER, pro)).rows.length === 1,
  [(await stack(null, rookie[0].id)).rows.length, (await stack(null, pro)).rows.length, (await stack(BUYER, pro)).rows.length, (await stack(OWNER, pro)).rows.length]);

// ── 0442 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(M442);
await db.exec(M442);
ok("0442 twice: recorded (applied twice), one read policy on the lessons", (await q(`select applied_count::int n from public.schema_migrations where version like '0442%'`))[0].n === 2
  && (await q(`select count(*)::int n from pg_policies where tablename = 'primal_lessons' and policyname = 'primal lessons read'`))[0].n === 1);
ok("a stranger reads no lesson now — Rookie included", (await lessons(null)).length === 0, await lessons(null));
ok("…nor a member who hasn't bought, nor one whose purchase was revoked", (await lessons(READER)).length === 0 && (await lessons(LAPSED)).length === 0);
const bought = await lessons(BUYER);
ok("a buyer reads every live lesson — Rookie and Pro, one purchase — and not the draft", bought.length === 4 && bought.includes("pro-test") && !bought.includes("draft-test"), bought);
ok("the crew read all of it, the draft too", (await lessons(OWNER)).length === 5);
ok("the preview still answers a stranger and a member who hasn't bought — the course is still shown",
  (await as(null, `select count(*)::int n from public.primal_lesson_previews()`)).rows[0]?.n === 4 && (await as(READER, `select count(*)::int n from public.primal_lesson_previews()`)).rows[0]?.n === 4);
const stackRows = async (uid) => (await as(uid, `select count(*)::int n from public.primal_lesson_products`)).rows[0]?.n;
const allStack = (await q(`select count(*)::int n from public.primal_lesson_products lp join public.primal_lessons l on l.id = lp.lesson_id where l.published_at is not null`))[0].n;
ok("a lesson's stack rows are the buyer's too", (await stackRows(null)) === 0 && (await stackRows(READER)) === 0 && (await stackRows(BUYER)) === allStack && allStack > 1,
  [await stackRows(null), await stackRows(READER), await stackRows(BUYER), allStack]);
const anonStack = await stack(null, rookie[0].id);
ok("the stack function is no longer a stranger's to run; a member who hasn't bought gets nothing; a buyer and the crew get the stack",
  !!anonStack.error && (await stack(READER, rookie[0].id)).rows.length === 0 && (await stack(BUYER, rookie[0].id)).rows.length > 0 && (await stack(OWNER, pro)).rows.length === 1,
  [anonStack.error, await stack(READER, rookie[0].id), (await stack(BUYER, rookie[0].id)).rows.length]);
ok("who may run what, as the verify lines read it",
  (await q(`select has_function_privilege('anon', 'public.primal_lesson_previews()', 'execute') a, has_function_privilege('anon', 'public.primal_menu_for_lesson(uuid)', 'execute') b`))
    .every((r) => r.a === true && r.b === false));
const cl = await q(`select count(*)::int n from public.changelog where title = 'GT3 Nutrition: the pillars are free, the course is yours when you buy it'`);
ok("its changelog line, once", cl[0].n === 1);

console.log(`R45 — THE COURSE IS BOUGHT, THE PILLARS GIVEN (0441, 0442, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
