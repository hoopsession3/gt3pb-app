// R32 — A PASSWORD ALONE OPENS NO OWNER DOOR, AND A PAID ORDER KEEPS WHAT IT BOUGHT (0437), IN POSTGRES (2026-10-18 — the
// fresh 10/10 audit at R31: database DB11-01, DB11-03, DB11-05, DB11-06, DB11-07; security SEC11-01; API API11-05).
//
// The whole schema to 0436 is loaded, and what the audit found is shown first: an owner who set up an authenticator,
// signed in without its code, still writes the four doors that read the role straight from profiles. Then 0437 — twice —
// and each finding is asked again as the people it was about:
//   · the four doors ask is_admin(): an owner without the code is refused, with it let in; an admin with no
//     authenticator set up (two-step not required) and the server as before; the crew never. And the rule from here:
//     no policy in the schema grants owner-and-admin by the role alone (one made up to break it is caught).
//   · the money guard holds what the money bought: a server can't make a paid pack a twelve, a delivery's six bottles
//     twenty-four, an office order's gallons more or an invoice's due date later — and still picks up, returns bottles,
//     delivers and moves a date as before; an owner (with the code) and the server can change them.
//   · the anonymous doors: an IPv4 address written as IPv6 is the IPv4 it is; an IPv6 caller's /48 is counted between the
//     address and everyone (sixty an hour); a guest visit past sixty an hour from one address isn't counted; a funnel step
//     is stamped now and the three-hundred-and-first from one address in the hour is dropped, silently; the two doors
//     nothing uses refuse a page's insert and take the server's.
//   · an every-other-week program with no anchor counts its weeks from the Eastern day it was saved; one already running
//     on its UTC date keeps it.
// Every person, order and address is made up (203.0.113.0/24, 198.51.100.0/24 and 2001:db8::/32 are the documentation
// ranges).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M437 = readFileSync(join(ROOT, "supabase/migrations/0437_a_password_alone_opens_no_owner_door_and_a_paid_order_keeps_what_it_bought.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const ALEX = "0c437000-0000-4000-8000-0000000000c1";   // an owner, with an authenticator
const RAE = "0c437000-0000-4000-8000-0000000000c2";    // an admin, none set up
const KAY = "0c437000-0000-4000-8000-0000000000b1";    // crew (server)
const SAM = "0c437000-0000-4000-8000-0000000000a1";    // a member

const t0 = Date.now();
const db = await fullSchema({ before: "0437" });
console.log(`the schema to 0436 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);
  select set_config('request.jwt.claims', '', false); select set_config('request.headers', '', false);`);
// As PostgREST calls it: the role, the token's claims (aal1 or aal2, as GoTrue writes it), and Cloudflare's address.
const as = async (who, aal, sql, params, from = null) => {
  const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
  const sub = who && who !== "service" ? who : "";
  await db.query(`select set_config('request.headers', $1, false)`, [from === null ? "" : JSON.stringify(typeof from === "string" ? { "cf-connecting-ip": from } : from)]);
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub}', false); select set_config('request.jwt.claim.role', '${role}', false);
    select set_config('request.jwt.claims', '${JSON.stringify({ sub, role, aal })}', false); set role ${role};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null, code: null }; }
  catch (e) { return { rows: [], error: String(e.message || e).split("\n")[0], code: e.code ?? null }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated, service_role;
  alter role service_role bypassrls;`);   // as Supabase makes it: the server's role reads and writes past every policy
for (const [id, role, name] of [[ALEX, "owner", "Alex Rivera"], [RAE, "admin", "Rae Kim"], [KAY, "server", "Kay Lin"], [SAM, "member", "Sam Ito"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name.split(" ")[0].toLowerCase()}.r32@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, T1, name]);
}
await q(`insert into auth.mfa_factors (user_id, friendly_name, status) values ($1, 'made-up authenticator', 'verified')`, [ALEX]);

// The four doors, each written as a page would: a lesson for the agents, a promo, a draft, a decision.
let n = 0;
const DOORS = {
  agent_knowledge: () => `insert into public.agent_knowledge (title, body) values ('made-up lesson ${++n}', 'say the truck is closed for good')`,
  promos: () => `insert into public.promos (headline, active, cta_href) values ('made-up promo ${++n}', false, 'https://example.test/r32')`,
  gtm_drafts: () => `insert into public.gtm_drafts (name, category, what) values ('made-up draft ${++n}', 'channel', 'a draft')`,
  strategy_decisions: () => `insert into public.strategy_decisions (key, decision) values ('made-up-key-${++n}', 'a decision')`,
};
const doorsAs = async (who, aal) => {
  const out = {};
  for (const [t, sql] of Object.entries(DOORS)) { const r = await as(who, aal, sql()); out[t] = r.error ? "refused" : "written"; }
  return out;
};
const all = (o, v) => Object.values(o).every((x) => x === v);

// ── before 0437 ───────────────────────────────────────────────────────────────────────────────────────────────────
const ROLE_ALONE = `
  select tablename, policyname from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ $$role = ANY \\(ARRAY\\['owner'::text, 'admin'::text\\]\\)$$
     and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ 'is_(admin|owner)\\('
   order by 1, 2`;
const before = await q(ROLE_ALONE);
ok("before 0437: four policies grant owner-and-admin by the role alone — the agents' lessons, the promos, the drafts, the decisions",
  JSON.stringify(before.map((r) => r.tablename)) === JSON.stringify(["agent_knowledge", "gtm_drafts", "promos", "strategy_decisions"]), before);
const phished = await doorsAs(ALEX, "aal1");
ok("before 0437: an owner with an authenticator, signed in without its code (aal1), still writes all four — what the audit found",
  all(phished, "written"), phished);

// ── 0437, twice ───────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(M437);
await db.exec(M437);
ok("0437 twice: recorded (applied twice), each changelog line once, one funnel trigger",
  (await q1(`select applied_count::int n from public.schema_migrations where version like '0437%'`)).n === 2
  && (await q1(`select count(*)::int n from public.changelog where title in ('A password alone opens no owner door', 'A paid order keeps what it bought')`)).n === 2
  && (await q1(`select count(*)::int n from pg_trigger where tgname = 'funnel_step_counted_tg'`)).n === 1);

// ── 1 · the four doors ask the gates ─────────────────────────────────────────────────────────────────────────────
ok("0437: no policy grants owner-and-admin by the role alone", (await q(ROLE_ALONE)).length === 0, await q(ROLE_ALONE));
const noCode = await doorsAs(ALEX, "aal1"), withCode = await doorsAs(ALEX, "aal2");
ok("the owner without the code (aal1) is refused at all four; with it (aal2), let in at all four",
  all(noCode, "refused") && all(withCode, "written"), { noCode, withCode });
const admin = await doorsAs(RAE, "aal1"), crew = await doorsAs(KAY, "aal2"), member = await doorsAs(SAM, "aal2");
ok("an admin with no authenticator set up (two-step not required) writes as before; the crew and a member never did and still don't",
  all(admin, "written") && all(crew, "refused") && all(member, "refused"), { admin, crew, member });
ok("the server writes as before (its own role, past every policy)", all(await doorsAs("service", null), "written"));
// The rule holds every policy from here: a made-up one written the old way is caught by the same query.
await db.exec(`create policy "made-up owner door" on public.promos for update using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner','admin')))`);
const caught = await q(ROLE_ALONE);
await db.exec(`drop policy "made-up owner door" on public.promos`);
ok("the rule: a policy written with the role alone is caught by name (and the made-up one is gone again)",
  caught.length === 1 && caught[0].policyname === "made-up owner door" && (await q(ROLE_ALONE)).length === 0, caught);
ok("a policy that also lets an event manager in is left as 0433 draws it (an owner without the code acts as one)",
  (await q1(`select count(*)::int n from pg_policies where schemaname = 'public'
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ $$'event_manager'::text$$`)).n > 0);

// ── 2 · what a paid order bought keeps its door ──────────────────────────────────────────────────────────────────
const PACK = "0c437000-0000-4000-8000-00000000d001", DELIV = "0c437000-0000-4000-8000-00000000d002";
const OFFICE = "0c437000-0000-4000-8000-00000000d003", INV = "0c437000-0000-4000-8000-00000000d004";
await q(`insert into public.drop_orders (id, tenant_id, user_id, name, size, glass, total_cents, paid, drop_date, payment_status)
         values ($1, $2, $3, 'Sam Ito', 3, 'new', 1800, true, current_date + 3, 'paid')`, [PACK, T1, SAM]);
await q(`insert into public.delivery_orders (id, tenant_id, user_id, delivery_date, name, address_street, address_city, address_zip,
           pack_size, rise_count, bottle_subtotal_cents, delivery_fee_cents, total_cents, payment_status)
         values ($1, $2, $3, current_date + 4, 'Sam Ito', '1 Made-up St', 'Greenville', '29601', 6, 6, 3000, 500, 3500, 'paid')`, [DELIV, T1, SAM]);
await q(`insert into public.business_orders (id, tenant_id, company, address_street, address_city, address_zip, delivery_date, gallons, subtotal_cents, total_cents)
         values ($1, $2, 'Made-up Co', '2 Made-up St', 'Greenville', '29601', current_date + 5, 5, 10000, 10000)`, [OFFICE, T1]);
await q(`insert into public.invoices (id, tenant_id, amount_cents, business_order_id, due_at) values ($1, $2, 10000, $3, now() + interval '14 days')`, [INV, T1, OFFICE]);
const edit = (who, aal, sql, id) => as(who, aal, sql, [id]);
const refused = (r) => r.code === "42501" && /its own door/.test(r.error ?? "");
const grow = {
  pack: await edit(KAY, "aal2", `update public.drop_orders set size = 12 where id = $1`, PACK),
  glass: await edit(KAY, "aal2", `update public.drop_orders set glass = 'return' where id = $1`, PACK),
  bottles: await edit(KAY, "aal2", `update public.delivery_orders set pack_size = 24, rise_count = 24 where id = $1`, DELIV),
  gallons: await edit(KAY, "aal2", `update public.business_orders set gallons = 50 where id = $1`, OFFICE),
  due: await edit(KAY, "aal2", `update public.invoices set due_at = now() + interval '400 days' where id = $1`, INV),
};
ok("a server can't make a paid pack a twelve, change its glass, make a delivery twenty-four bottles, an office order fifty gallons or an invoice due next year",
  Object.values(grow).every(refused), grow);
const still = await q(`select (select size from public.drop_orders where id = $1) s, (select pack_size from public.delivery_orders where id = $2) p,
  (select gallons from public.business_orders where id = $3) g`, [PACK, DELIV, OFFICE]);
ok("…and each order is as it was bought", still[0].s === 3 && still[0].p === 6 && Number(still[0].g) === 5, still);
const daily = {
  pickedUp: await edit(KAY, "aal2", `update public.drop_orders set picked_up = true, bottles_returned = true where id = $1`, PACK),
  moved: await edit(KAY, "aal2", `update public.drop_orders set drop_date = drop_date + 1 where id = $1`, PACK),
  delivered: await edit(KAY, "aal2", `update public.delivery_orders set status = 'delivered', empties_collected = 2 where id = $1`, DELIV),
};
ok("the crew's own work goes on: a pack picked up and its bottles back, a pack moved a day, a delivery delivered with its empties",
  Object.values(daily).every((r) => !r.error), daily);
const ownerFix = await edit(ALEX, "aal2", `update public.drop_orders set size = 6 where id = $1`, PACK);
const ownerNoCode = await edit(ALEX, "aal1", `update public.drop_orders set size = 9 where id = $1`, PACK);
const server = await edit("service", null, `update public.business_orders set gallons = 6 where id = $1`, OFFICE);
ok("an owner with the code can change a pack's size; without it, can't; the server can change gallons",
  !ownerFix.error && refused(ownerNoCode) && !server.error && (await q1(`select size from public.drop_orders where id = $1`, [PACK])).size === 6, { ownerFix, ownerNoCode, server });

// ── 3 · the anonymous doors count who is calling ─────────────────────────────────────────────────────────────────
const addr = async (ip) => { await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ "cf-connecting-ip": ip })]);
  const v = await q1(`select public.caller_address() a, public.caller_block() b`); await root(); return v; };
const mapped = await addr("::ffff:203.0.113.9"), v4 = await addr("203.0.113.9"), v6 = await addr("2001:db8:aa:bb:cc::1");
ok("caller_address: an IPv4 address written as IPv6 (::ffff:a.b.c.d) is that IPv4 — not one '::/64' shared with every other",
  mapped.a === "203.0.113.9" && mapped.b === null && v4.a === "203.0.113.9" && v4.b === null, { mapped, v4 });
ok("caller_block: an IPv6 caller's /48, beside its /64", v6.a === "2001:db8:aa:bb::/64" && v6.b === "2001:db8:aa::/48", v6);

const P256 = "p256dh-made-up-key-0437", AUTH = "auth-made-up-37";
const web = (i, from) => as(null, null, `select public.keep_push_device($1, '${P256}', '${AUTH}', null, null)`, [`https://fcm.googleapis.com/fcm/send/r32-guest-${i}`], from);
const bucket = async (b) => (await q1(`select coalesce(sum(count), 0)::int n from public.rate_limit_hits where bucket = $1`, [b])).n;
const kept = [];
for (let i = 0; i < 60; i++) kept.push(await web(i, `2001:db8:77:${(i % 6).toString(16)}::${i + 1}`));   // six /64s of one /48, ten each
ok("one household's /48: sixty new devices across its /64s are kept (each /64 under its own thirty)",
  kept.every((r) => !r.error) && (await bucket("push:new-guest:2001:db8:77::/48")) === 60, kept.filter((r) => r.error).slice(0, 2));
const sixtyFirst = await web(60, "2001:db8:77:9::1");
ok("…the sixty-first, from a /64 it hadn't used, is refused — and spends nothing of everyone's three hundred",
  /Too many devices just now/.test(sixtyFirst.error ?? "") && (await bucket("push:new-guest")) === 60, { sixtyFirst, all: await bucket("push:new-guest") });
ok("…while another /48 and an IPv4 address go on", !(await web(70, "2001:db8:88::1")).error && !(await web(71, "198.51.100.71")).error && (await bucket("push:new-guest")) === 62);

const visit = (from) => as(null, null, `select public.track_guest()`, [], from);
const hits = async () => (await q1(`select coalesce(sum(hits), 0)::int n from public.guest_daily`)).n;
const h0 = await hits();
for (let i = 0; i < 61; i++) await visit("198.51.100.5");
ok("track_guest: one address is counted sixty times in the hour, not the sixty-first", (await hits()) - h0 === 60, (await hits()) - h0);
await visit("198.51.100.6"); await visit(null);
ok("…another address, and a call with no address, are counted", (await hits()) - h0 === 62);

const stepFrom = (from, at = null) => as(null, null, `insert into public.funnel_events (funnel, step, session${at ? ", at" : ""}) values ('order', 'cart', 'made-up-session'${at ? `, '${at}'` : ""})`, [], from);
const backdated = await stepFrom("198.51.100.20", "2020-01-01T00:00:00Z");
const stamped = await q1(`select at > now() - interval '1 minute' as fresh from public.funnel_events order by id desc limit 1`);
ok("funnel_events: a step a page says happened in 2020 is stamped now", !backdated.error && stamped.fresh === true, { backdated, stamped });
for (let i = 0; i < 300; i++) await stepFrom("198.51.100.21");
const f0 = (await q1(`select count(*)::int n from public.funnel_events`)).n;
const dropped = await stepFrom("198.51.100.21");
ok("…the three-hundred-and-first step from one address in the hour is dropped, silently (no error to the page, no row)",
  !dropped.error && (await q1(`select count(*)::int n from public.funnel_events`)).n === f0, dropped);
ok("…another address's step is kept", !(await stepFrom("198.51.100.22")).error && (await q1(`select count(*)::int n from public.funnel_events`)).n === f0 + 1);

const interest = await as(null, null, `insert into public.subscription_interest (email) values ('made-up@example.test')`);
const booking = await as(null, null, `insert into public.booking_requests (name, email) values ('Made-up Lead', 'lead@example.test')`);
const bookingMember = await as(SAM, "aal1", `insert into public.booking_requests (name, email) values ('Made-up Lead', 'lead@example.test')`);
const byServer = await as("service", null, `insert into public.booking_requests (name, email) values ('Made-up Lead', 'lead@example.test') returning id`);
ok("the two doors nothing uses: a page can't add launch interest or a booking straight to the table; the server (/api/book) still books",
  !!interest.error && !!booking.error && !!bookingMember.error && !byServer.error, { interest: interest.error, booking: booking.error, bookingMember: bookingMember.error, byServer: byServer.error });

// ── 4 · an every-other-week program counts its weeks on the business's day ───────────────────────────────────────
const matches = async (program, d) => (await q1(`select public.office_rule_matches(jsonb_populate_record(null::public.company_programs, $1::jsonb), $2::date) m`,
  [JSON.stringify(program), d])).m;
// Saved Sunday 2026-10-04 at 9 pm Eastern — Monday 01:00 UTC: Eastern's week is the one starting Monday 2026-09-28.
const sundayNight = { weekdays: [1], every_n_weeks: 2, created_at: "2026-10-05T01:00:00Z" };
ok("a program every other Monday, saved Sunday night Eastern with no anchor, runs on the weeks counted from that Sunday's week",
  (await matches(sundayNight, "2026-10-12")) === true && (await matches(sundayNight, "2026-10-05")) === false && (await matches(sundayNight, "2026-09-28")) === true);
ok("…and an anchor or a start, when it has one, still decides", (await matches({ ...sundayNight, anchor_date: "2026-10-05" }, "2026-10-05")) === true
  && (await matches({ ...sundayNight, anchor_date: "2026-10-05" }, "2026-10-12")) === false);

const db2 = await fullSchema({ before: "0437" });
const COMPANY = "0c437000-0000-4000-8000-00000000e001", LOCATION = "0c437000-0000-4000-8000-00000000e002", PROGRAM = "0c437000-0000-4000-8000-00000000e003";
await db2.query(`insert into public.companies (id, tenant_id, name) values ($1, $2, 'Made-up Co')`, [COMPANY, T1]);
await db2.query(`insert into public.company_locations (id, tenant_id, company_id) values ($1, $2, $3)`, [LOCATION, T1, COMPANY]);
await db2.query(`insert into public.company_programs (id, tenant_id, company_id, location_id, weekdays, every_n_weeks, created_at)
                 values ($1, $2, $3, $4, '{1}', 2, '2026-10-05T01:00:00Z')`, [PROGRAM, T1, COMPANY, LOCATION]);
const was = (await db2.query(`select public.office_rule_matches(p, '2026-10-12') a, public.office_rule_matches(p, '2026-10-19') b from public.company_programs p where id = $1`, [PROGRAM])).rows[0];
await db2.exec(M437);
const now = (await db2.query(`select anchor_date::text, public.office_rule_matches(p, '2026-10-12') a, public.office_rule_matches(p, '2026-10-19') b from public.company_programs p where id = $1`, [PROGRAM])).rows[0];
await db2.close();
ok("a program already running on its UTC date keeps its weeks: that date is written as its anchor, and every Monday answers as before",
  now.anchor_date === "2026-10-05" && now.a === was.a && now.b === was.b && was.a !== was.b, { was, now });

// ── 5 · the paste file: each migration its own transaction (DB11-04, OPS11-03) ──────────────────────────────────────
// What Ryan pastes is supabase/APPLY_ALL_PENDING.sql, as one query. Applied whole to the schema before 0430, every
// pending migration lands; with one broken in the middle, the ones above it stay applied and nothing below it runs; the
// same file pasted again then finishes the rest.
const PASTE = readFileSync(join(ROOT, "supabase/APPLY_ALL_PENDING.sql"), "utf8");
const pendingSeqs = [...PASTE.matchAll(/^--\s*={10,}\s*\n--\s*(\d{4})_\S*\.sql\s*$/gm)].map((m) => Number(m[1]));
// The schema the paste lands on is production's: every migration before the first one pending (R47 — 0443 was applied
// by itself, so "before 0430" no longer is), the held ones included as they sit beside it.
const BASE = String(pendingSeqs[0] ?? 430).padStart(4, "0");
const ledger = async (d) => (await d.query(`select seq::int from public.schema_migrations where seq >= $1 order by seq`, [Number(BASE)])).rows.map((r) => r.seq);
ok("the paste file wraps each of its migrations in its own begin … commit", pendingSeqs.length > 0
  && (PASTE.match(/^begin;/gm) || []).length === pendingSeqs.length && (PASTE.match(/^commit;/gm) || []).length === pendingSeqs.length, pendingSeqs);
{
  const d = await fullSchema({ before: BASE });
  await d.exec(PASTE);
  ok("the paste file, as one query: every pending migration lands, in order", JSON.stringify(await ledger(d)) === JSON.stringify(pendingSeqs), await ledger(d));
  await d.close();
}
{
  const d = await fullSchema({ before: BASE });
  const mid = pendingSeqs[Math.floor(pendingSeqs.length / 2)];
  const broken = PASTE.replace(new RegExp(`^(begin;   -- ${String(mid).padStart(4, "0")},[^\n]*)$`, "m"), "$1\nselect 1 / 0;   -- made up: this migration stops");
  let stopped = null;
  try { await d.exec(broken); } catch (e) { stopped = String(e.message || e).split("\n")[0]; }
  try { await d.exec("rollback"); } catch { /* nothing open */ }
  const after = await ledger(d);
  ok(`one migration that stops (${mid}): the ones above it stay applied, it and those below it don't run`,
    /division by zero/.test(stopped ?? "") && broken !== PASTE
    && JSON.stringify(after) === JSON.stringify(pendingSeqs.filter((x) => x < mid)), { stopped, after });
  await d.exec(PASTE);
  ok("…and the same file pasted again finishes the rest (what was applied changes nothing)", JSON.stringify(await ledger(d)) === JSON.stringify(pendingSeqs), await ledger(d));
  await d.close();
}

await db.close();
console.log(`\nR32 — A PASSWORD ALONE OPENS NO OWNER DOOR, AND A PAID ORDER KEEPS WHAT IT BOUGHT (0437): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
