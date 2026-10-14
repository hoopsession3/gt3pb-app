// 0398 — A TEXT NEEDS A YES. Executed from its file against the whole schema (every migration before it, in order:
// scripts/fixtures/schema.full.mjs), acting as the server, a member and a guest the way PostgREST does.
//
// The finding, as a sentence (R5 of the customer audit): lib/notify texted any phone an order carried the moment Twilio's
// keys were set, and nothing asked, recorded a yes, or listened for STOP.
//
// What it proves: a number is texted only while its yes is later than its stop; a yes and a stop each keep their own time
// and place; a number lib/notify could not send to is refused; only the server writes or asks (a member reads their own
// row, never another's; a guest reads nothing); the database reads a number exactly as lib/texts does; an erased account
// takes its numbers' rows with it, whether the yes came with the account or by text; and a second run changes nothing.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL398 = readFileSync(join(ROOT, "supabase/migrations/0398_a_text_needs_a_yes.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const SAM = "0c398000-0000-4000-8000-0000000000a1", ALEX = "0c398000-0000-4000-8000-0000000000a2";
const ERIN = "0c398000-0000-4000-8000-0000000000a3", FINN = "0c398000-0000-4000-8000-0000000000a4";
const T1 = "00000000-0000-0000-0000-000000000001";
const t0 = Date.now();
const db = await fullSchema({ before: "0398" });
console.log(`the schema before 0398 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
const as = async (who, sql, params) => {
  const role = who === "server" ? "service_role" : who ? "authenticated" : "anon";
  await db.exec(`select set_config('request.jwt.claim.sub', '${who && who !== "server" ? who : ""}', false); set role ${role};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
for (const [id, who] of [[SAM, "sam"], [ALEX, "alex"], [ERIN, "erin"], [FINN, "finn"]]) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${who}@example.test`]);

ok("before 0398: no consent is kept anywhere", (await q(`select 1 from information_schema.tables where table_name = 'text_consents'`)).length === 0);
await db.exec(SQL398);

const SAMS = "+18645550100", ALEXS = "+18645550199";
const say = (phone, yes, source, user) => as("server", `select public.say_text_consent($1, $2, $3, $4) s`, [phone, yes, source, user ?? null]);
const standing = async (phone) => (await as("server", `select public.text_consent_standing($1) s`, [phone])).rows[0]?.s;
const row = async (phone) => q1(`select * from public.text_consents where phone = $1`, [phone]);
const tick = () => db.exec(`select pg_sleep(0.002)`);

ok("a number nobody said yes for is not texted", (await standing(SAMS)) === false);
const y1 = await say(SAMS, true, "pack_checkout", SAM);
ok("a yes at the pack checkout stands, with when and where", y1.error === null && y1.rows[0]?.s === true && (await row(SAMS)).yes_source === "pack_checkout" && (await row(SAMS)).user_id === SAM, y1);
await tick();
const s1 = await say(SAMS, false, "stop_text", null);
ok("STOP by text: no longer texted — and the member the yes came with is kept", s1.rows[0]?.s === false && (await standing(SAMS)) === false && (await row(SAMS)).user_id === SAM && (await row(SAMS)).stop_source === "stop_text", s1);
ok("…the yes is still on file, with its own time and place", (await row(SAMS)).yes_at !== null && (await row(SAMS)).yes_source === "pack_checkout");
await tick();
const y2 = await say(SAMS, true, "start_text", null);
ok("START by text after a stop: texted again (the later wins)", y2.rows[0]?.s === true && (await standing(SAMS)) === true);
await tick();
await say(SAMS, false, "account", SAM);
ok("a stop from the account screen wins over an older yes", (await standing(SAMS)) === false && (await row(SAMS)).stop_source === "account");

ok("a number lib/notify could not text is refused in words", /isn't a phone number we can text/.test((await say("864-555-0100", true, "account", SAM)).error || ""));
ok("a source that isn't one of the five is refused", (await say(ALEXS, true, "a_flyer", ALEX)).error !== null && (await row(ALEXS)) === undefined);

await say(ALEXS, true, "delivery_checkout", ALEX);
ok("a member may not write a yes (the server's alone)", /permission denied/.test((await as(SAM, `select public.say_text_consent($1, true, 'account', $2)`, [ALEXS, SAM])).error || ""));
ok("…nor ask whether a number may be texted", /permission denied/.test((await as(SAM, `select public.text_consent_standing($1)`, [ALEXS])).error || ""));
ok("a guest may do neither", /permission denied/.test((await as(null, `select public.text_consent_standing($1)`, [SAMS])).error || ""));
const mine = await as(SAM, `select phone from public.text_consents`);
ok("a member reads their own row and not another's", mine.error === null && mine.rows.length === 1 && mine.rows[0].phone === SAMS, mine);
ok("a guest reads none", (await as(null, `select phone from public.text_consents`)).error !== null || (await as(null, `select phone from public.text_consents`)).rows.length === 0);
ok("a member may not write the table directly", /permission denied/.test((await as(SAM, `update public.text_consents set yes_at = now() where phone = $1`, [SAMS])).error || ""));

// ── one way to read a number: the database's text_number is lib/texts e164 ─────────────────────────────────────────
{
  const mod = { exports: {} };
  new Function("module", "exports", "require", ts.transpileModule(readFileSync(join(ROOT, "lib/texts.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(mod, mod.exports, () => ({}));
  const cases = [null, "", "(864) 555-0100", "864.555.0100", "8645550100", "1-864-555-0100", "+1 864 555 0100", " 864 555 0100 ", "+44 20 7946 0958",
    "555-0100", "0864555010", "123-456-7890", "21864555010", "+0123456789", "+1234567", "call me", "10-864-555-0100", "+8645550100", "1 (064) 555-0100",
    "+123456789012345", "+1234567890123456", "864-555-0100 ext 2"];
  const sql = await q(`select c.ord, public.text_number(c.v) n from unnest($1::text[]) with ordinality c(v, ord) order by c.ord`, [cases]);
  const differ = cases.map((c, i) => [c, mod.exports.e164(c), sql[i]?.n ?? null]).filter(([, js, db]) => js !== db);
  ok(`the database reads a number exactly as lib/texts does (${cases.length} ways of writing one)`, differ.length === 0 && sql.length === cases.length, differ);
}

// ── an erased account takes its numbers' rows with it (0353) ────────────────────────────────────────────────────────
// Erin said yes at a checkout (the row carries her account); Finn's number said START by text (no account on the row) and is
// on his past pack. Deleting each account — what auth.admin.deleteUser() runs — leaves neither number anywhere here.
const ERINS = "+18645550123", FINNS = "+18645550177";
await q(`update public.customers set phone = '(864) 555-0123' where user_id = $1`, [ERIN]);
await say(ERINS, true, "pack_checkout", ERIN);
// …and since then her record carries a new number: the old one's row is found only through her account
await q(`update public.customers set phone = '(864) 555-0124' where user_id = $1`, [ERIN]);
const finnCust = (await q1(`select id from public.customers where user_id = $1`, [FINN])).id;
await q(`insert into public.drop_orders (user_id, customer_id, name, phone, size, glass, total_cents, drop_date, tenant_id) values ($1, $2, 'Finn Example', '864-555-0177', 6, 'new', 6000, current_date - 7, $3)`, [FINN, finnCust, T1]);
await say(FINNS, true, "start_text", null);
ok("before: Erin's row carries her account, Finn's carries none", (await row(ERINS))?.user_id === ERIN && (await row(FINNS))?.user_id === null && (await standing(FINNS)) === true);
const others = await q(`select phone, user_id, yes_at, stop_at from public.text_consents where phone not in ($1, $2) order by phone`, [ERINS, FINNS]);
const gone = async (id) => { try { await q(`delete from auth.users where id = $1`, [id]); return null; } catch (e) { return String(e.message || e); } };
const e1 = await gone(ERIN);
ok("an erased account's yes, given with it, goes with it — even for a number no longer on her record (on delete cascade: 0353's erasure deletes it)", e1 === null && (await row(ERINS)) === undefined, e1);
const e2 = await gone(FINN);
ok("a yes that came by text, with no account on it, goes when the erased account's pack lets go of the number",
  e2 === null && (await row(FINNS)) === undefined && (await standing(FINNS)) === false && (await q1(`select count(*)::int n from public.drop_orders where phone = '864-555-0177'`)).n === 0, e2);
ok("…and nobody else's yes or stop moved", JSON.stringify(others) === JSON.stringify(await q(`select phone, user_id, yes_at, stop_at from public.text_consents where phone not in ($1, $2) order by phone`, [ERINS, FINNS])));
await q(`update public.customers set phone = '864-555-0100' where user_id = $1`, [SAM]);
const samRow = await row(SAMS);
await q(`update public.customers set phone = null where user_id = $1`, [SAM]);
ok("a member clearing the phone on their own record (their account still on it) keeps the row — only letting go of both takes it",
  JSON.stringify(samRow) === JSON.stringify(await row(SAMS)) && samRow !== undefined);
ok("text_number and the trigger are the server's: a member may not call either", /permission denied/.test((await as(SAM, `select public.text_number('8645550100')`)).error || ""));

// ── a second run ───────────────────────────────────────────────────────────────────────────────────────────────────
const before = await q(`select * from public.text_consents order by phone`);
await db.exec(SQL398);
ok("a second run changes nothing: the rows stay, one changelog entry, one ledger row",
  JSON.stringify(before) === JSON.stringify(await q(`select * from public.text_consents order by phone`))
  && (await q1(`select count(*)::int n from public.changelog where title = 'A text needs a yes'`)).n === 1
  && (await q1(`select count(*)::int n from public.schema_migrations where version = '0398_a_text_needs_a_yes'`)).n === 1);

console.log(`A TEXT NEEDS A YES (0398): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
