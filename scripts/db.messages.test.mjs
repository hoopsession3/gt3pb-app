// WHAT WE TOLD THE CUSTOMER — 0326, executed from its file against a real Postgres.
//
// The claim being tested: after this migration, a paid order can answer three questions it could
// not answer on 2026-09-29, when the first flagship cap was charged, printed, and never emailed —
// did we email them, what exactly did we say, and can I send it again. And one more that matters
// as much: can anybody quietly change the answer afterwards.
//
// A record of what a customer was told is the row that gets read out in a chargeback. If the app
// can rewrite it, or claim a send that never happened, it is not a record.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s) => (await db.query(s)).rows[0];
const refused = async (sql) => { try { await db.exec(sql); return false; } catch { return true; } };

// Just enough of the world for 0326 to land on: the things it references, nothing more.
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid());
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create or replace function public.is_admin() returns boolean language sql stable as $$ select true $$;
  create table public.tenants (id uuid primary key default '00000000-0000-0000-0000-000000000001');
  insert into public.tenants (id) values ('00000000-0000-0000-0000-000000000001');
  create table public.shop_orders (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
    email text, total_cents int
  );
  create table public.changelog (
    id uuid primary key default gen_random_uuid(), title text, category text, area text,
    summary text, shipped_on date, highlight boolean default false
  );
  -- See the note in db.alertnoise: this stub called the ledger's key column "name". Production
  -- (0304) calls it "version". Corrected to match, and gated in scripts/smoke.cjs.
  create table public.schema_migrations (version text primary key, seq int not null,
    applied_at timestamptz default now(), note text, applied_count int default 1, evidence text);
  create or replace function public.record_migration(p_version text, p_note text default null)
    returns void language sql as $$
    insert into public.schema_migrations (version, seq, applied_at, note)
    values (p_version, coalesce(nullif(substring(p_version from '^[0-9]{4}'), '')::int, 0), now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1 $$;
`);

// ── the migration itself, from its file ────────────────────────────────────────────────────────
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0326_what_we_told_the_customer.sql"), "utf8"));
ok("0326 applies against a real Postgres", true);
ok("0326 records itself in the ledger",
  (await q1(`select count(*)::int n from public.schema_migrations where version = '0326_what_we_told_the_customer'`)).n === 1);
ok("0326 says what changed, once — re-running must not duplicate the changelog line",
  (await q1(`select count(*)::int n from public.changelog where title = 'Every email we send a customer is now on the order'`)).n === 1);

await db.exec(readFileSync(join(ROOT, "supabase/migrations/0326_what_we_told_the_customer.sql"), "utf8"));
ok("0326 is idempotent — applying it twice is not an error and adds nothing",
  (await q1(`select count(*)::int n from public.changelog where title = 'Every email we send a customer is now on the order'`)).n === 1);

const order = (await q1(`insert into public.shop_orders (email, total_cents) values ('ryan@example.com', 3200) returning id`)).id;

// ── the three questions ────────────────────────────────────────────────────────────────────────
await db.exec(`insert into public.customer_messages (order_id, channel, kind, to_address, subject, body, status)
  values ('${order}', 'email', 'receipt', 'ryan@example.com', 'Your GT3 order is in', '1× GT3 6-Panel Cap', 'sent')`);
ok("did we email them — yes, and it is attached to the order",
  (await q1(`select count(*)::int n from public.customer_messages where order_id = '${order}' and status = 'sent'`)).n === 1);
ok("what did we say — the exact body, not a summary of it",
  (await q1(`select body from public.customer_messages where order_id = '${order}'`)).body === "1× GT3 6-Panel Cap");

// A failure keeps the provider's own words. This is the column that would have explained the whole
// evening: Resend answered 403 and said why, and sendEmail discarded it.
await db.exec(`insert into public.customer_messages (order_id, channel, kind, to_address, body, status, detail)
  values ('${order}', 'email', 'receipt', 'ryan@example.com', 'x', 'failed', 'Resend 403: the from address is not on a verified domain')`);
ok("a failure carries the provider's reason, not just the fact of failing",
  /Resend 403/.test((await q1(`select detail from public.customer_messages where status = 'failed' and order_id = '${order}'`)).detail));

// By hand vs by the app — the first thing anyone asks when a customer reports two receipts.
const person = (await q1(`insert into auth.users default values returning id`)).id;
await db.exec(`insert into public.customer_messages (order_id, channel, kind, to_address, body, status, sent_by)
  values ('${order}', 'email', 'receipt_resend', 'ryan@example.com', 'x', 'sent', '${person}')`);
ok("a resend records WHO pressed the button; an automatic send records nobody",
  (await q1(`select count(*)::int n from public.customer_messages where order_id = '${order}' and sent_by is not null`)).n === 1 &&
  (await q1(`select count(*)::int n from public.customer_messages where order_id = '${order}' and sent_by is null`)).n === 2);

// ── what it refuses ────────────────────────────────────────────────────────────────────────────
ok("a channel it does not know is refused, not stored as a typo",
  await refused(`insert into public.customer_messages (order_id, channel, kind, to_address, body, status)
    values ('${order}', 'carrier pigeon', 'receipt', 'a@b.co', 'x', 'sent')`));
// There is deliberately no 'skipped' status: a message nobody tried to send is not something the
// customer was told, and letting it in here turns the log into a list of intentions.
ok("and a status it does not know is refused — there is no 'skipped', by design",
  await refused(`insert into public.customer_messages (order_id, channel, kind, to_address, body, status)
    values ('${order}', 'email', 'receipt', 'a@b.co', 'x', 'skipped')`));
ok("a message with no body is refused — an empty record of what we said is not a record",
  await refused(`insert into public.customer_messages (order_id, channel, kind, to_address, status)
    values ('${order}', 'email', 'receipt', 'a@b.co', 'sent')`));

// ── it is a log, not a draft ───────────────────────────────────────────────────────────────────
// THE ONE THAT MATTERS MOST. `authenticated` gets select and nothing else, and there is no insert
// policy at all — every write comes from a server route holding the service role, immediately after
// a send actually happened. A client that can write here can claim we emailed somebody we did not.
const pols = (await db.query(`select polcmd from pg_policy where polrelid = 'public.customer_messages'::regclass`)).rows.map((r) => r.polcmd);
ok("exactly one policy, and it is SELECT — no client can insert, edit or delete what we told a customer",
  pols.length === 1 && pols[0] === "r", pols);
const grants = (await db.query(`select privilege_type from information_schema.role_table_grants
  where table_name = 'customer_messages' and grantee = 'authenticated'`)).rows.map((r) => r.privilege_type).sort();
ok("and the grant matches the policy — select only, so the two cannot drift apart",
  grants.join(",") === "SELECT", grants);
ok("row level security is actually on, not merely declared",
  (await q1(`select relrowsecurity from pg_class where oid = 'public.customer_messages'::regclass`)).relrowsecurity === true);

// The log follows the order it is about. An orphaned record of what somebody was told about an
// order that no longer exists answers nothing.
await db.exec(`delete from public.shop_orders where id = '${order}'`);
ok("deleting the order takes its messages with it — no orphaned account of a vanished order",
  (await q1(`select count(*)::int n from public.customer_messages`)).n === 0);

// ── 0332: "SENT" MEANT THE PROVIDER TOOK IT ────────────────────────────────────────────────────
// 0326 answered "what were they told". It could not answer "did it arrive", while using a word that
// sounds like it does. The claims worth proving are the precedence — a complaint outranks a
// delivery, a refused send outranks everything — and the two silences that are NOT the same:
// nothing heard back yet, versus nothing heard back for an hour.
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0332_sent_meant_the_provider_took_it.sql"), "utf8"));

const mk = async (o) => (await q1(`
  insert into public.customer_messages
    (order_id, channel, kind, to_address, subject, body, status, provider_id,
     delivered_at, bounced_at, complained_at, created_at)
  values (null, '${o.channel ?? "email"}', '${o.kind ?? "receipt"}', 'a@b.com', 's', 'b',
          '${o.status ?? "sent"}', ${o.pid ? `'${o.pid}'` : "null"},
          ${o.delivered ? "now()" : "null"}, ${o.bounced ? "now()" : "null"},
          ${o.complained ? "now()" : "null"}, now() - interval '${o.ageMin ?? 0} minutes')
  returning id`)).id;
const outcomeOf = async (id) => (await q1(`select outcome from public.v_customer_message_outcome where id = '${id}'`))?.outcome;

{
  ok("a send the provider refused is 'never sent'",
    (await outcomeOf(await mk({ status: "failed", pid: "p_failed" }))) === "never sent");
  ok("delivered is 'delivered'",
    (await outcomeOf(await mk({ pid: "p_ok", delivered: true }))) === "delivered");
  ok("bounced is 'bounced'",
    (await outcomeOf(await mk({ pid: "p_bounce", bounced: true }))) === "bounced");

  // THE PRECEDENCE. A message can be delivered and later complained about; the complaint is the
  // more important fact, and a screen deciding that for itself is how two panels disagree.
  ok("a complaint outranks the delivery that came before it",
    (await outcomeOf(await mk({ pid: "p_both", delivered: true, complained: true }))) === "marked as spam");
  ok("and a bounce outranks a delivery too",
    (await outcomeOf(await mk({ pid: "p_db", delivered: true, bounced: true }))) === "bounced");
  ok("but a refused send outranks everything — it never left",
    (await outcomeOf(await mk({ status: "failed", pid: "p_f2", delivered: true }))) === "never sent");

  // THE TWO SILENCES. Calling either of them "delivered" would be the entire bug again.
  ok("just sent, nothing heard back yet, is 'in flight'",
    (await outcomeOf(await mk({ pid: "p_new", ageMin: 2 }))) === "in flight");
  ok("an hour of silence is 'no delivery confirmation', not 'delivered'",
    (await outcomeOf(await mk({ pid: "p_old", ageMin: 120 }))) === "no delivery confirmation");
  ok("an SMS is not left waiting on an email delivery receipt",
    (await outcomeOf(await mk({ channel: "sms", pid: "p_sms", ageMin: 120 }))) === "sent");
}

// The join has to be unambiguous: "which message bounced" cannot be answered with "one of these".
{
  let dupe = null;
  try {
    await db.exec(`insert into public.customer_messages
      (channel, kind, to_address, subject, body, status, provider_id)
      values ('email','receipt','a@b.com','s','b','sent','p_ok')`);
  } catch (e) { dupe = String(e?.message ?? e); }
  ok("two messages cannot claim one provider id", dupe !== null, dupe);

  // ...but the index is PARTIAL, so every message sent before 0332 — all of which have no id —
  // still coexists. A plain unique index would have made the migration fail on real data.
  let many = null;
  try {
    await db.exec(`insert into public.customer_messages (channel, kind, to_address, subject, body, status)
                   values ('email','receipt','a@b.com','s','b','sent'),
                          ('email','receipt','c@d.com','s','b','sent')`);
  } catch (e) { many = String(e?.message ?? e); }
  ok("messages with no provider id are not in each other's way", many === null, many);
}

ok("0332 recorded itself",
  Number((await q1(`select count(*) n from public.schema_migrations
                     where version = '0332_sent_meant_the_provider_took_it'`))?.n) === 1);

console.log(`WHAT WE TOLD THE CUSTOMER: ${pass} passed, ${fail} failed`);
console.log(`0326 + 0332 executed against a real Postgres.\n`);
process.exit(fail ? 1 : 0);
