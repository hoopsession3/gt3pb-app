// R9 OF THE CUSTOMER AUDIT — THE PUBLIC DOORS, COUNTED, RUN IN POSTGRES (2026-10-16; Ryan: "Keep working to improve to a 10").
//
//   0418  a booking written from a browser is counted; a texts yes is for a US number and never over the phone's own
//         STOP; a web device is kept only at a browser's push service, a new guest device counted, and only through its
//         function
//
// The findings, as sentences: anyone could loop booking_requests and ring the crew and email every admin each time; a
// yes could be recorded for any number in any country, and a yes from a page outweighed a STOP the phone had texted;
// any page could write push_subscriptions directly, at any address, and a guest could add devices without end. What is
// run here is the whole schema up to 0417, then 0418 — twice — as the roles that call it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fullSchema } from "./fixtures/schema.full.mjs";
const nodeRequire = createRequire(import.meta.url);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL = readFileSync(join(ROOT, "supabase/migrations/0418_every_public_door_that_rings_is_counted.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const SAM = "0c418000-0000-4000-8000-0000000000a1";     // a member

const t0 = Date.now();
const db = await fullSchema({ before: "0418" });
console.log(`the schema to 0417 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);`);
// As PostgREST calls it: the role, and the request's claims (the trigger tells a browser's write from the server's by them).
const as = async (who, sql, params) => {
  const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
  await db.exec(`select set_config('request.jwt.claim.sub', '${who && who !== "service" ? who : ""}', false);
    select set_config('request.jwt.claim.role', '${role}', false); set role ${role};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e) }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated, service_role;
  do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
  grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;`);
await q(`insert into auth.users (id, email) values ($1, 'sam@example.test')`, [SAM]);
await q(`update public.profiles set role = 'member', tenant_id = $2, display_name = 'Sam Ito' where id = $1`, [SAM, T1]);

// ── before 0418: the doors, as they were ─────────────────────────────────────────────────────────────────────────────
{
  const many = [];
  for (let i = 0; i < 8; i++) many.push(await as(null, `insert into public.booking_requests (name, email) values ('Bot ${i}', 'bot${i}@example.test')`));
  ok("before 0418: a browser wrote eight booking requests in a row — each one a ring and an email to every admin", many.every((r) => !r.error), many.map((r) => r.error));
  const pumped = await as("service", `select public.say_text_consent('+442079460958', true, 'account', null) s`);
  ok("before 0418: a yes was recorded for a number in another country", pumped.rows[0]?.s === true, pumped);
  const anyHost = await as(null, `select public.keep_push_device('https://collector.example.test/p/1', '${"k".repeat(20)}', '${"a".repeat(10)}', null, true)`);
  ok("before 0418: a guest kept a 'device' at any web address", !anyHost.error, anyHost.error);
  const direct = await as(null, `insert into public.push_subscriptions (endpoint, p256dh, auth, wants_live) values ('https://collector.example.test/p/2', 'x', 'y', true)`);
  ok("before 0418: …or wrote one straight into the table, around the function", !direct.error, direct.error);
  await q(`delete from public.push_subscriptions where endpoint like 'https://collector.example.test/%'`);
  await q(`delete from public.text_consents`);
  await q(`delete from public.rate_limit_hits`);
}

await db.exec(SQL);
await db.exec(SQL);   // a second run changes nothing

// ── a booking from a browser, counted ──────────────────────────────────────────────────────────────────────────────
{
  const tries = [];
  for (let i = 0; i < 7; i++) tries.push(await as(null, `insert into public.booking_requests (name, email) values ('Bot ${i}', 'bot${i}@example.test')`));
  ok("a browser's booking requests: six an hour, for everyone together — the seventh is refused, and says where to write",
    tries.slice(0, 6).every((r) => !r.error) && /a lot of booking requests just now — try again in an hour, or email hello@gt3pb\.com/.test(tries[6].error ?? ""), tries.map((r) => r.error));
  const member = await as(SAM, `insert into public.booking_requests (name, email) values ('Sam', 'sam@example.test')`);
  ok("…a signed-in browser too", /a lot of booking requests/.test(member.error ?? ""), member);
  const server = await as("service", `insert into public.booking_requests (name, email) values ('Ana', 'ana@example.test')`);
  const editor = await q(`insert into public.booking_requests (name, email) values ('Ryan', 'ryan@example.test') returning id`);
  ok("…never the server's own door (/api/book counts its own) or a person at the SQL editor", !server.error && editor.length === 1, server.error);
}

// ── a texts yes ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const say = (phone, yes, source) => as("service", `select public.say_text_consent($1, $2, $3, null) s`, [phone, yes, source]);
  // The database's list is lib/texts's: every area code, both ways.
  const tsTexts = (() => {
    const ts = nodeRequire("typescript"), mod = { exports: {} };
    new Function("module", "exports", "require", ts.transpileModule(readFileSync(join(ROOT, "lib/texts.ts"), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(mod, mod.exports, () => ({}));
    return mod.exports;
  })();
  const codes = Array.from({ length: 800 }, (_, i) => `+1${200 + i}5550100`);
  const dbSays = await q(`select c.v, public.us_textable(c.v) ok from unnest($1::text[]) c(v)`, [codes]);
  const differ = dbSays.filter((r) => r.ok !== tsTexts.usTextable(r.v)).map((r) => r.v);
  ok("a US phone is the same list in the database as in lib/texts — every area code", differ.length === 0 && dbSays.length === 800, differ.slice(0, 5));
  const abroad = await say("+442079460958", true, "account");
  ok("a yes is for a US number — another country's is refused", /We can only text US numbers/.test(abroad.error ?? ""), abroad);
  const odd = await say("+18641550100", true, "pack_checkout");
  ok("…and a US number's exchange starts 2–9 (lib/texts usTextable)", /We can only text US numbers/.test(odd.error ?? ""), odd);
  const insideOne = await Promise.all(["+14165550100", "+18765550100", "+18095550100", "+19005550100"].map((n) => say(n, true, "account")));
  ok("…and inside +1, Canada, Jamaica, the Dominican Republic and a 900 number are not US phones", insideOne.every((r) => /We can only text US numbers/.test(r.error ?? "")), insideOne.map((r) => r.error));
  const stopAbroad = await say("+442079460958", false, "stop_text");
  ok("a STOP is kept for any number", !stopAbroad.error && stopAbroad.rows[0]?.s === false, stopAbroad);
  const NUM = "+18645550100";
  ok("a yes from the account for a US number stands", (await say(NUM, true, "account")).rows[0]?.s === true);
  ok("the phone texts STOP: no yes stands", (await say(NUM, false, "stop_text")).rows[0]?.s === false);
  const page = await say(NUM, true, "account");
  const kept = await q1(`select yes_source, stop_source, stop_at > yes_at as stop_later from public.text_consents where phone = $1`, [NUM]);
  ok("a yes from a page after the phone's own STOP is not kept — the STOP holds (it used to win by being later)",
    page.rows[0]?.s === false && kept.stop_source === "stop_text" && kept.stop_later === true, { page, kept });
  ok("…nor a yes from a checkout", (await say(NUM, true, "pack_checkout")).rows[0]?.s === false);
  ok("…nor a stop from the account and then a yes from it — the phone's STOP stays the phone's",
    (await say(NUM, false, "account")).rows[0]?.s === false && (await say(NUM, true, "account")).rows[0]?.s === false
      && (await q1(`select stop_source from public.text_consents where phone = $1`, [NUM])).stop_source === "stop_text");
  ok("START from the phone undoes it", (await say(NUM, true, "start_text")).rows[0]?.s === true);
  ok("a stop from the account, then a yes from the account: the member's own switch, both ways",
    (await say(NUM, false, "account")).rows[0]?.s === false && (await say(NUM, true, "account")).rows[0]?.s === true);
  const member = await as(SAM, `select public.say_text_consent('+18645550111', true, 'account', null) s`);
  ok("…and the writer is still the server's alone", /permission denied/.test(member.error ?? ""), member);
}

// ── a web device ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  const hosts = await q1(`select public.push_host_ok('https://fcm.googleapis.com/fcm/send/a') g, public.push_host_ok('https://updates.push.services.mozilla.com/wpush/v2/b') m,
    public.push_host_ok('https://web.push.apple.com/c') a, public.push_host_ok('https://wns2-by3p.notify.windows.com/w/?token=d') w,
    public.push_host_ok('https://collector.example.test/e') x, public.push_host_ok('https://fcm.googleapis.com.evil.test/f') y, public.push_host_ok('http://fcm.googleapis.com/g') z`);
  ok("a push service is Google's, Mozilla's, Apple's or Microsoft's — nothing that only looks like one", hosts.g && hosts.m && hosts.a && hosts.w && !hosts.x && !hosts.y && !hosts.z, hosts);
  const K = `'${"k".repeat(20)}', '${"a".repeat(10)}'`;
  const stranger = await as(null, `select public.keep_push_device('https://collector.example.test/p/9', ${K}, null, true)`);
  ok("a device at any other address is not kept", /That isn't a push subscription/.test(stranger.error ?? ""), stranger);
  const real = await as(null, `select public.keep_push_device('https://fcm.googleapis.com/fcm/send/guest-1', ${K}, null, true)`);
  ok("a guest's device at a push service is kept, wanting the go-live ping", !real.error
    && (await q1(`select wants_live from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/guest-1'`))?.wants_live === true, real.error);
  const direct = await as(null, `insert into public.push_subscriptions (endpoint, p256dh, auth, wants_live) values ('https://fcm.googleapis.com/fcm/send/direct', 'x', 'y', true)`);
  const update = await as(null, `update public.push_subscriptions set wants_live = false where endpoint = 'https://fcm.googleapis.com/fcm/send/guest-1' returning endpoint`);
  ok("a page writes the table only through its function now — no direct insert, no direct update",
    !!direct.error && (update.error || update.rows.length === 0) && (await q1(`select wants_live from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/guest-1'`))?.wants_live === true, { direct: direct.error, update });
  // A new guest device is counted: three hundred an hour for everyone together.
  await q(`insert into public.rate_limit_hits (bucket, window_start, count)
    values ('push:new-guest', to_timestamp(floor(extract(epoch from now()) * 1000 / 3600000) * 3600000 / 1000.0), 300)
    on conflict (bucket, window_start) do update set count = 300`);
  const flood = await as(null, `select public.keep_push_device('https://fcm.googleapis.com/fcm/send/guest-301', ${K}, null, true)`);
  const again = await as(null, `select public.keep_push_device('https://fcm.googleapis.com/fcm/send/guest-1', ${K}, null, false)`);
  const mine = await as(SAM, `select public.keep_push_device('https://fcm.googleapis.com/fcm/send/sam-1', ${K}, null, null)`);
  ok("past three hundred new guest devices in the hour: refused — a device already kept, and a member's own, still go through",
    /Too many devices just now/.test(flood.error ?? "") && !again.error && !mine.error, { flood: flood.error, again: again.error, mine: mine.error });
  const app = await as(null, `select public.keep_app_push_token('${"a1b2".repeat(16)}')`);
  ok("the iPhone app keeps its device through its own function, as before", !app.error, app.error);
}

ok("0418 says so in the changelog, once, and records itself",
  Number((await q1(`select count(*) n from public.changelog where title = 'Public forms and switches are counted'`)).n) === 1
    && (await q1(`select applied_count from public.schema_migrations where version = '0418_every_public_door_that_rings_is_counted'`))?.applied_count === 2);

console.log(`R9 ABUSE (0418, in Postgres): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
