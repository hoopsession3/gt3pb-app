// WAVE 2, THE TIDY-UP — 0378 and 0379, executed from their files against the whole schema (every migration before them,
// in order: scripts/fixtures/schema.full.mjs), acting as each kind of person the way PostgREST does (2026-10-11).
//
//   0378  only "Got it" is a crew member's to write on an alert: ack_at and ack_by, nothing else, and nothing for anon
//   0379  the Pass's picked-up read (status = 'done', newest change first) has a partial index to stand on
//
// The defect is shown first on the schema as production has it, then closed. MODELED from production as measured:
// Supabase's default grants — every table in public to anon and authenticated, RLS the only guard (0366/0367).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const F378 = "0378_only_got_it_is_a_crew_members_to_write_on_an_alert.sql";
const F379 = "0379_the_pass_finds_its_picked_up_orders_by_index.sql";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0b2e7700-0000-4000-8000-0000000000a1", SERVER = "0b2e7700-0000-4000-8000-0000000000a4",
  MEMBER = "0b2e7700-0000-4000-8000-0000000000a5";
const SUBJECT = "0b2e7700-0000-4000-8000-00000000c0a1";

const t0 = Date.now();
const db = await fullSchema({ before: "0378" });
console.log(`the schema before 0378 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
// As a person, through PostgREST's roles: { rows, error }.
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { return { rows: (await db.query(sql, params)).rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};

await db.exec(`
  grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  -- The door every push goes through (0157), recorded instead of called: PGlite has no pg_net.
  create or replace function supabase_functions.http_request() returns trigger language plpgsql security definer as $$
  begin return new; end $$;
`);
for (const [id, role] of [[OWNER, "owner"], [SERVER, "server"], [MEMBER, "member"]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
  await db.query(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, T1, `Made-up ${role}`]);
}
const raise = async (title) => (await q(`insert into public.alerts (severity, category, kind, subject_id, title, body, link, tenant_id)
  values ('critical', 'order', 'refund_needed', $1, $2, 'made-up body', '/crew', $3) returning id`, [SUBJECT, title, T1]))[0]?.id ?? null;  // a repeat folded by 0372 inserts nothing
const row = async (id) => (await q(`select title, body, ack_at, ack_by, escalated_at, occurrences from public.alerts where id = $1`, [id]))[0];

// ── BEFORE 0378: a crew member can rewrite any column of an alert they can see ─────────────────────────────────────
{
  const id = await raise("Voided a PAID order — refund needed");
  const rewrite = await as(SERVER, `update public.alerts set title = 'nothing to see here' where id = $1 returning id`, [id]);
  ok("before 0378: a server can rewrite an alert's title through PostgREST", !rewrite.error && rewrite.rows.length === 1, rewrite);
  const esc = await as(SERVER, `update public.alerts set escalated_at = now() where id = $1 returning id`, [id]);
  ok("before 0378: …and set escalated_at, which 0373 answers with a push to every owner", !esc.error && esc.rows.length === 1, esc);
  await db.query(`update public.alerts set ack_at = now() where id = $1`, [id]);  // out of the way of what follows
}

// ── 0378 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(MIG(F378));
ok("0378 loads, and a second run changes nothing", await db.exec(MIG(F378)).then(() => true, () => false));
{
  const id = await raise("Voided a PAID order — refund needed");
  const got = await as(SERVER, `update public.alerts set ack_at = now(), ack_by = $2 where id = $1 returning id`, [id, SERVER]);
  ok("after 0378: \"Got it\" still works — ack_at and ack_by, as lib/useMyAlerts writes them", !got.error && got.rows.length === 1, got);
  ok("after 0378: …and it landed", (await row(id)).ack_by === SERVER);
  const undo = await as(SERVER, `update public.alerts set ack_at = null, ack_by = null where id = $1 returning id`, [id]);
  ok("after 0378: its undo still works", !undo.error && undo.rows.length === 1 && (await row(id)).ack_at === null, undo);
  for (const [col, val] of [["title", "'nothing to see here'"], ["body", "'rewritten'"], ["escalated_at", "now()"], ["target_user_id", `'${MEMBER}'`], ["severity", "'fyi'"]]) {
    const r = await as(SERVER, `update public.alerts set ${col} = ${val} where id = $1 returning id`, [id]);
    ok(`after 0378: a server can't write ${col}`, /permission denied/i.test(r.error ?? ""), r);
  }
  const ownerTitle = await as(OWNER, `update public.alerts set title = 'x' where id = $1 returning id`, [id]);
  ok("after 0378: nor can an owner from a phone — the server's raises use the service role", /permission denied/i.test(ownerTitle.error ?? ""), ownerTitle);
  const anon = await as(null, `update public.alerts set ack_at = now() where id = $1 returning id`, [id]);
  ok("after 0378: anon can write nothing on an alert", /permission denied/i.test(anon.error ?? ""), anon);
  ok("after 0378: the alert is as it was raised", (await row(id)).title === "Voided a PAID order — refund needed" && (await row(id)).escalated_at === null);
  const read = await as(SERVER, `select id from public.alerts where id = $1`, [id]);
  ok("after 0378: reading is untouched", !read.error && read.rows.length === 1, read);
}
{
  // 0372's fold runs as the table's owner (security definer): a repeat raise is still counted on the open line.
  await db.query(`update public.alerts set ack_at = now() where subject_id = $1 and ack_at is null`, [SUBJECT]);
  const id = await raise("Voided a PAID order — refund needed");
  await raise("Voided a PAID order — refund needed");
  const open = await q(`select id, occurrences from public.alerts where kind = 'refund_needed' and subject_id = $1 and ack_at is null`, [SUBJECT]);
  ok("after 0378: 0372's fold still counts a repeat on the open line (definer functions are not held by column grants)",
    open.length === 1 && open[0].id === id && Number(open[0].occurrences) >= 2, open);
}
ok("after 0378: the column privileges read as the header says",
  (await q(`select has_column_privilege('authenticated', 'public.alerts', 'ack_at', 'UPDATE') a,
                   has_column_privilege('authenticated', 'public.alerts', 'ack_by', 'UPDATE') b,
                   has_column_privilege('authenticated', 'public.alerts', 'title', 'UPDATE') c,
                   has_column_privilege('anon', 'public.alerts', 'ack_at', 'UPDATE') d`)).map((r) => [r.a, r.b, r.c, r.d]).join() === "true,true,false,false");

// ── 0379 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
ok("before 0379: no index answers the Pass's picked-up read",
  (await q(`select 1 from pg_indexes where schemaname = 'public' and indexname = 'orders_done_by_change'`)).length === 0);
await db.exec(MIG(F379));
ok("0379 loads, and a second run changes nothing", await db.exec(MIG(F379)).then(() => true, () => false));
{
  const def = (await q(`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'orders_done_by_change'`))[0]?.indexdef ?? "";
  ok("after 0379: a partial index on the done orders' change time, newest first",
    /\(status_changed_at DESC\)/.test(def) && /WHERE \(status = 'done'::text\)/.test(def), def);
  const src = readFileSync(join(ROOT, "lib/passBoard.ts"), "utf8");
  ok("after 0379: …which is exactly the read lib/passBoard sends",
    /\.eq\("status", "done"\)\.gte\("status_changed_at", recentISO\)\.order\("status_changed_at", \{ ascending: false \}\)/.test(src));
}

// ── the ledger ───────────────────────────────────────────────────────────────────────────────────────────────────
const led = await q(`select version from public.schema_migrations where version in ('0378_only_got_it_is_a_crew_members_to_write_on_an_alert', '0379_the_pass_finds_its_picked_up_orders_by_index') order by 1`);
ok("both record themselves by their own names", led.length === 2, led);

console.log(`0378 + 0379 (wave 2, the tidy-up): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
