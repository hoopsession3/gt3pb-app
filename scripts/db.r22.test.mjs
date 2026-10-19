// R22 — THE STUDIO'S ROOM IS ITS EDITORS', AND A PHONE NOBODY KEEPS IS LET GO (0428), in Postgres (2026-10-18 — the 10/10
// audit, security F12 and database F14; Ryan: "Keep working to improve to a 10").
//
// The whole schema to 0427 is loaded, then 0428 twice. (1) Realtime Authorization as Realtime runs it: joining the
// Studio's private room for a piece is a select on realtime.messages and speaking in it an insert, each as the caller,
// with the room's name in realtime.topic() — held for the piece's own leadership, a crew member who isn't, another
// business's owner, a stranger with no session, and names that are no room of the Studio's. (2) A device is seen when it
// is kept, the morning sweep lets go of the ones nobody keeps, and the two keep functions are 0418's and 0419's line for
// line but the stamp. Every row is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const M428 = MIG("0428_the_studio_room_is_its_editors_and_a_phone_nobody_keeps_is_let_go.sql");
const M429 = MIG("0429_a_text_is_sent_once_for_what_happened.sql");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001", T2 = "0c428000-0000-4000-8000-0000000000f2";
const OWNER = "0c428000-0000-4000-8000-0000000000a1", LEAD = "0c428000-0000-4000-8000-0000000000a2";
const CREW = "0c428000-0000-4000-8000-0000000000a3", OTHER = "0c428000-0000-4000-8000-0000000000a4", SAM = "0c428000-0000-4000-8000-0000000000a5";

const t0 = Date.now();
const db = await fullSchema({ before: "0428" });
console.log(`the schema to 0427 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const n = async (s, p) => Number((await q1(s, p)).n);
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false); select set_config('realtime.topic', '', false);`);
const as = async (who, sql, params, topic = "") => {
  const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
  await db.query(`select set_config('realtime.topic', $1, false)`, [topic]);   // the room's name as the client sent it — any text
  await db.exec(`select set_config('request.jwt.claim.sub', '${who ?? ""}', false); select set_config('request.jwt.claim.role', '${role}', false); set role ${role};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e).split("\n")[0], code: e.code ?? null }; }
  finally { await root(); }
};
// The service role as Supabase has it: past every row rule (the app's server; message_sent is its alone).
await db.exec(`grant usage on schema public to anon, authenticated, service_role; alter role service_role bypassrls;`);
// A second business, made on purpose (guard_second_tenant asks for the switch).
await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'made-up-other', 'Made-up Other Co'); commit;`);
for (const [id, role, tenant, name] of [[OWNER, "owner", T1, "Ola Ray"], [LEAD, "event_manager", T1, "Lee Park"], [CREW, "operator", T1, "Kim Lee"],
  [OTHER, "owner", T2, "Oz Vale"], [SAM, "member", T1, "Sam Ito"]]) {
  await q(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${name.split(" ")[0].toLowerCase()}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, tenant, name]);
}
const piece = (await q1(`insert into public.content_items (title, tenant_id) values ('Made-up Fall Post', $1) returning id`, [T1])).id;
const theirs = (await q1(`insert into public.content_items (title, tenant_id) values ('Their Made-up Post', $1) returning id`, [T2])).id;

// Devices kept before 0428 — the rows the paste finds.
await q(`insert into public.push_subscriptions (endpoint, p256dh, auth, user_id, wants_live) values
  ('https://fcm.googleapis.com/fcm/send/before-guest', 'p256dh-made-up-key-0001', 'auth-made-up-01', null, false),
  ('https://fcm.googleapis.com/fcm/send/before-sam', 'p256dh-made-up-key-0002', 'auth-made-up-02', $1, false)`, [SAM]);

await db.exec(M428);
await db.exec(M428);   // a second paste changes nothing
ok("0428: pasted twice, recorded once", (await n(`select count(*) n from public.schema_migrations where version like '0428%'`)) === 1);
ok("0428: two policies on Realtime's messages, both the Studio's", (await n(`select count(*) n from pg_policies where schemaname = 'realtime' and tablename = 'messages'`)) === 2
  && (await n(`select count(*) n from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname like 'studio:%'`)) === 2);
ok("0428: the sweep is scheduled once", (await n(`select count(*) n from cron.job where jobname = 'push-device-sweep'`)) === 1);

// ── (1) the Studio's room ─────────────────────────────────────────────────────────────────────────────────────────────
// What Realtime asks on a join and a send: a read of the room's messages, and an insert of one — as the caller.
await q(`insert into realtime.messages (topic, extension, event, payload) values ($1, 'broadcast', 'patch', '{"field":"title"}'), ($1, 'presence', 'sync', '{}'),
  ($2, 'broadcast', 'patch', '{"field":"title"}')`, [`studio-${piece}`, `studio-${theirs}`]);
const hears = async (who, topic) => {
  const r = await as(who, `select count(*) n from realtime.messages where topic = $1`, [topic], topic);
  return r.error ? r.error : Number(r.rows[0]?.n ?? 0);
};
const speaks = async (who, topic, extension = "broadcast") => {
  const r = await as(who, `insert into realtime.messages (topic, extension, event, payload) values ($1, $2, 'patch', '{"field":"hook"}')`, [topic, extension], topic);
  return r.error === null ? true : r.error;
};
const room = `studio-${piece}`;
ok("studio: the business's owner joins the piece's room — hears its patches and who is in it", (await hears(OWNER, room)) === 2, await hears(OWNER, room));
ok("studio: …an events lead, who edits the piece, too", (await hears(LEAD, room)) === 2, await hears(LEAD, room));
ok("studio: …and both may speak in it (a field patch, their presence)",
  (await speaks(OWNER, room)) === true && (await speaks(LEAD, room, "presence")) === true, [await speaks(OWNER, room), await speaks(LEAD, room, "presence")]);
ok("studio: a crew member who can't open the piece hears nothing of its room", (await hears(CREW, room)) === 0, await hears(CREW, room));
ok("studio: …and can't speak in it", /row-level security/i.test(String(await speaks(CREW, room))), await speaks(CREW, room));
ok("studio: another business's owner hears nothing of this business's piece — nor speaks in it",
  (await hears(OTHER, room)) === 0 && /row-level security/i.test(String(await speaks(OTHER, room))), [await hears(OTHER, room), await speaks(OTHER, room)]);
ok("studio: …but is in their own piece's room — the rule is the piece's, not a role's",
  (await hears(OTHER, `studio-${theirs}`)) === 1 && (await speaks(OTHER, `studio-${theirs}`)) === true);
ok("studio: a member hears nothing", (await hears(SAM, room)) === 0);
ok("studio: no session, no room — a select of nothing and a refused send (the policies are for the signed in)",
  (await hears(null, room)) === 0 && /row-level security|permission denied/i.test(String(await speaks(null, room))), [await hears(null, room), await speaks(null, room)]);
ok("studio: a name that is no room of the Studio's is a closed door, not an error — another prefix, a piece's id cut short, junk",
  (await hears(OWNER, `post-${piece}`)) === 0 && (await hears(OWNER, `studio-${piece.slice(0, 30)}`)) === 0 && (await hears(OWNER, "studio-x'; drop table x;--")) === 0
    && (await hears(OWNER, `studio-${piece}-and-more`)) === 0,
  [await hears(OWNER, `post-${piece}`), await hears(OWNER, `studio-${piece.slice(0, 30)}`), await hears(OWNER, "studio-x")]);
ok("studio: only broadcast and presence — a message of any other kind on the room is not the Studio's to allow",
  /row-level security/i.test(String(await speaks(OWNER, room, "postgres_changes"))), await speaks(OWNER, room, "postgres_changes"));
{
  // A piece archived is still its editors' (the Studio opens it); a piece deleted is no room at all.
  const gone = (await q1(`insert into public.content_items (title, tenant_id) values ('Made-up Gone Post', $1) returning id`, [T1])).id;
  await q(`delete from public.content_items where id = $1`, [gone]);
  ok("studio: a piece that was deleted is no room", (await speaks(OWNER, `studio-${gone}`)) !== true);
}
{
  // The page asks for the private room — and only the Studio's channel speaks in broadcast or presence at all.
  const studio = readFileSync(join(ROOT, "components/Studio.tsx"), "utf8");
  ok("studio: the page joins the piece's room as a private channel, under the name the policies read",
    /sb\.channel\(`studio-\$\{id\}`, \{ config: \{ private: true, presence: \{ key: meRef\.current\.id \} \} \}\)/.test(studio));
}

// ── (2) a device is seen when it is kept, and one nobody keeps is let go ────────────────────────────────────────────────
{
  const seen = await q(`select endpoint, seen_at is not null as has, seen_at > now() - interval '1 minute' as fresh from public.push_subscriptions order by endpoint`);
  ok("0428: every device kept before the paste is seen as of it — thirty days' grace each", seen.length === 2 && seen.every((r) => r.has && r.fresh), seen);
}
const WEB = "https://fcm.googleapis.com/fcm/send/made-up-device";
const TOKEN = "ab".repeat(32);
{
  await q(`update public.push_subscriptions set seen_at = now() - interval '40 days'`);
  const r = await as(null, `select public.keep_push_device($1, 'p256dh-made-up-key-0003', 'auth-made-up-03', null, null)`, [WEB]);
  const app = await as(null, `select public.keep_app_push_token($1)`, [TOKEN]);
  ok("keep: a browser and a phone kept by nobody signed in are stamped seen", !r.error && !app.error
    && (await n(`select count(*) n from public.push_subscriptions where endpoint in ($1, $2) and seen_at > now() - interval '1 minute'`, [WEB, `apns:${TOKEN}`])) === 2, [r.error, app.error]);
  await q(`update public.push_subscriptions set seen_at = now() - interval '40 days' where endpoint in ($1, $2)`, [WEB, `apns:${TOKEN}`]);
  await as(null, `select public.keep_push_device($1, 'p256dh-made-up-key-0003', 'auth-made-up-03', null, null)`, [WEB]);
  await as(SAM, `select public.keep_app_push_token($1)`, [TOKEN]);
  ok("keep: kept again is seen again — the browser by nobody, the phone by the member now signed in on it",
    (await n(`select count(*) n from public.push_subscriptions where endpoint in ($1, $2) and seen_at > now() - interval '1 minute'`, [WEB, `apns:${TOKEN}`])) === 2
      && (await q1(`select user_id from public.push_subscriptions where endpoint = $1`, [`apns:${TOKEN}`])).user_id === SAM);
}
{
  // The morning's sweep, as pg_cron holds it.
  const cmd = (await q1(`select command from cron.job where jobname = 'push-device-sweep'`)).command;
  await q(`delete from public.push_subscriptions`);
  await q(`insert into public.push_subscriptions (endpoint, p256dh, auth, user_id, wants_live, seen_at) values
    ('https://fcm.googleapis.com/fcm/send/quiet-guest', 'p256dh-made-up-key-0011', 'auth-made-up-11', null, false, now() - interval '31 days'),
    ('https://fcm.googleapis.com/fcm/send/recent-guest', 'p256dh-made-up-key-0012', 'auth-made-up-12', null, false, now() - interval '29 days'),
    ('https://fcm.googleapis.com/fcm/send/live-guest', 'p256dh-made-up-key-0013', 'auth-made-up-13', null, true, now() - interval '90 days'),
    ('https://fcm.googleapis.com/fcm/send/quiet-member', 'p256dh-made-up-key-0014', 'auth-made-up-14', $1, false, now() - interval '200 days')`, [SAM]);
  await q(`insert into public.push_subscriptions (endpoint, platform, user_id, seen_at) values ($1, 'apns', null, now() - interval '45 days')`, [`apns:${"cd".repeat(32)}`]);
  await db.exec(cmd);
  const left = (await q(`select endpoint from public.push_subscriptions order by endpoint`)).map((r) => r.endpoint.replace(/^.*\//, "").replace(/^apns:.*/, "apns"));
  ok("sweep: a device nobody is signed in on, that asked for no news and unseen for thirty days, is let go — a browser and a phone alike",
    !left.includes("quiet-guest") && !left.includes("apns"), left);
  ok("sweep: …one seen within the thirty days stays", left.includes("recent-guest"), left);
  ok("sweep: …one waiting to hear the truck is live stays, however quiet (a gone one goes when the push service says so)", left.includes("live-guest"), left);
  ok("sweep: …and a member's device is theirs until they sign out, however quiet", left.includes("quiet-member"), left);
}
{
  // The keep functions are 0418's and 0419's, line for line, but the stamp.
  const fnOf = (sql, name) => { const i = sql.lastIndexOf(`create or replace function public.${name}(`); return sql.slice(i, sql.indexOf("end $$;", i) + 7); };
  const unstamp = (s) => s.replace(/,\s*seen_at\)/, ")").replace(/,\s*now\(\)\)/, ")").replace(/,\n\s*seen_at = now\(\);[^\n]*/, ";");
  const web418 = fnOf(MIG("0418_every_public_door_that_rings_is_counted.sql"), "keep_push_device");
  const app419 = fnOf(MIG("0419_a_push_is_sent_once_for_what_happened_and_a_limit_counts_what_it_lets_in.sql"), "keep_app_push_token");
  ok("keep: the browser's is 0418's but the stamp", unstamp(fnOf(M428, "keep_push_device")) === web418);
  ok("keep: the phone's is 0419's but the stamp", unstamp(fnOf(M428, "keep_app_push_token")) === app419);
  ok("keep: both still open to the app, with or without a session — and to nobody else by PUBLIC",
    (await n(`select count(*) n from pg_proc p where p.proname in ('keep_push_device', 'keep_app_push_token')
      and has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')
      and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')`)) === 2);
}

// ── 0429: a text is sent once for what happened ────────────────────────────────────────────────────────────────────
{
  await db.exec(M429);
  await db.exec(M429);
  ok("0429: pasted twice, recorded once", (await n(`select count(*) n from public.schema_migrations where version like '0429%'`)) === 1);
  ok("0429: its sweep is scheduled once, at ninety days of a claim", (await n(`select count(*) n from cron.job where jobname = 'message-sent-sweep' and command like '%claimed_at < now() - interval ''90 days''%'`)) === 1);
  const first = await as("service", `insert into public.message_sent (event_key) values ('text:order-ready:0c428000-0000-4000-8000-000000000001') returning event_key`);
  const again = await as("service", `insert into public.message_sent (event_key) values ('text:order-ready:0c428000-0000-4000-8000-000000000001')`);
  ok("0429: a text's key is claimed once — the second claim is refused as a duplicate (23505, which lib/notify reads as 'told already')",
    !first.error && again.code === "23505", { first: first.error, again });
  const peek = await as(null, `select count(*) from public.message_sent`), member = await as(SAM, `insert into public.message_sent (event_key) values ('text:made-up')`);
  const crew = await as(OWNER, `select count(*) from public.message_sent`);
  ok("0429: the ledger is the server's alone — no session, a member and an owner can neither read it nor write it",
    /permission denied/i.test(peek.error ?? "") && /permission denied/i.test(member.error ?? "") && /permission denied/i.test(crew.error ?? ""), { peek, member, crew });
  const fresh = await q1(`select claimed_at > now() - interval '1 minute' as claimed, sent_at is null as going from public.message_sent where event_key = 'text:order-ready:0c428000-0000-4000-8000-000000000001'`);
  ok("0429: a claim is stamped when made, and is not sent until marked", fresh?.claimed === true && fresh?.going === true, fresh);
  const marked = await as("service", `update public.message_sent set sent_at = now() where event_key = 'text:order-ready:0c428000-0000-4000-8000-000000000001' returning event_key`);
  ok("0429: the server marks its text sent (update is the service role's too)", !marked.error && marked.rows.length === 1, marked);
  const released = await as("service", `delete from public.message_sent where event_key = 'text:order-ready:0c428000-0000-4000-8000-000000000001' returning event_key`);
  ok("0429: and lets a claim go (the server deletes its own key)", !released.error && released.rows.length === 1, released);
}

console.log(`R22 (0428, 0429): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
