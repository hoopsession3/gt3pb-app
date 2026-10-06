// DELETE MY ACCOUNT — 0353, run against the whole schema (every migration, applied in order:
// scripts/fixtures/schema.full.mjs), because the question it answers is about every table at once:
// once a person has deleted their account, does anything still name them, or say what they said?
//
// A customer, a crew member, an operator and an owner, each with a life in the data — orders of
// every kind and the messages sent about them, a review, an RSVP, a VIP photo, points, a check-in, a
// reserve hold, a referral, a membership; a crew member's goals and notes; an operator's signed
// agreement; an owner's approval of an offer — then each deletes their account the way Supabase's
// admin API does it: `delete from auth.users`. The claims:
//
//   0. Before 0353 no account could be deleted at all (0141's guard on profiles fired in the cascade).
//   1. Nobody runs the erasure by hand — not a signed-in person, not the service role. Deleting the
//      account runs it, in the same transaction.
//   2. It refuses what would break something, with words a person can act on: the business's only
//      owner, a membership that can still bill, an order on its way — and not a stale status.
//   3. Afterwards NOTHING in the schema points at the account — every foreign key, from the catalog —
//      and the person's name, email, phone, address and words are in no column of any table,
//      the audit trail included.
//   4. What the business must keep is kept: every order and its money, the customer record they point
//      at (emptied), the crew member's work (unsigned), contracts (as signed), the history of an order.
//   5. It leaves a record that an account was erased, with nothing in it about who.
//   6. Every table that points at an account and holds words about people has a decided fate here,
//      so the next one cannot slip past.
import { fullSchema } from "./fixtures/schema.full.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

// ── 0 · as production had it ──
{
  const before = await fullSchema({ before: "0353" });
  await before.query(`insert into auth.users (id, email) values ('5a10e000-0000-4000-8000-0000000000f1', 'fresh@example.test')`);
  let err = null;
  try { await before.query(`delete from auth.users where id = '5a10e000-0000-4000-8000-0000000000f1'`); } catch (e) { err = String(e.message); }
  ok("0 · before 0353, even a brand-new account could not be deleted (the profile guard fired in the cascade)", /Hard deletes are blocked on profiles/.test(err || ""), err);
  await before.close();
}

const db = await fullSchema();
const q = (sql, params) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const count = async (sql, params) => Number((await one(sql, params)).n);
const raises = async (sql, params) => { try { await q(sql, params); return null; } catch (e) { return String(e.message || e); } };

const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "5a10e000-0000-4000-8000-0000000000a1";
const OWNER2 = "5a10e000-0000-4000-8000-0000000000a2";
const CUST = "5a10e000-0000-4000-8000-0000000000c1";
const CREW = "5a10e000-0000-4000-8000-0000000000e1";
const PAT = "5a10e000-0000-4000-8000-0000000000e2";
const CASEY = { name: "Casey Quillfeather", email: "casey.quillfeather@example.test", phone: "864-555-0142", street: "12 Larkspur Lane" };
const SAM = { name: "Sam Thistlewood" };
const erase = (id) => raises(`delete from auth.users where id = $1`, [id]);   // what auth.admin.deleteUser() runs

// ── the people (signing up makes the profile and the customer record: handle_new_user, 0246) ──
for (const [id, email] of [[OWNER, "owner@example.test"], [OWNER2, "second.owner@example.test"], [CUST, CASEY.email], [CREW, "sam@example.test"], [PAT, "pat@example.test"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
}
const profile = (id, name, role) => q(`update public.profiles set display_name = $2, role = $3, tenant_id = $4 where id = $1`, [id, name, role, T1]);
await profile(OWNER, "Olive Owner", "owner");
await profile(CUST, CASEY.name, "member");
await profile(CREW, SAM.name, "server");
await profile(PAT, "Pat Underhill", "operator");
await q(`update public.profiles set referred_by = $1 where id = $2`, [OWNER, CUST]);
await q(`update public.profiles set referred_by = $1 where id = $2`, [CUST, CREW]);

// ── the customer's life in the data ──
await q(`update public.customers set name = $2, phone = $3 where user_id = $1`, [CUST, CASEY.name, CASEY.phone]);
const custRec = (await one(`select id from public.customers where user_id = $1`, [CUST])).id;
// a pickup from last week whose status nobody closed — a stale status, not an order on its way
await q(`insert into public.drop_orders (user_id, customer_id, name, phone, size, glass, total_cents, drop_date, tenant_id) values ($1, $2, $3, $4, 6, 'new', 6000, current_date - 7, $5)`, [CUST, custRec, CASEY.name, CASEY.phone, T1]);
await q(`insert into public.delivery_orders (user_id, customer_id, delivery_date, name, phone, address_street, address_city, address_zip, access_instructions, driver_note, pack_size, rise_count, bottle_subtotal_cents, delivery_fee_cents, total_cents, fulfillment_status, tenant_id)
  values ($1, $2, current_date - 3, $3, $4, $5, 'Greenville', '29601', 'Gate code 4411', 'Leave by the blue door', 6, 6, 6000, 500, 6500, 'fulfilled', $6)`, [CUST, custRec, CASEY.name, CASEY.phone, CASEY.street, T1]);
await q(`insert into public.shop_orders (customer_id, user_id, email, ship_name, ship_address, note, status, total_cents, tenant_id) values ($1, $2, $3, $4, $5::jsonb, 'Gift for my sister', 'delivered', 3200, $6)`,
  [custRec, CUST, CASEY.email, CASEY.name, JSON.stringify({ line1: CASEY.street, city: "Greenville", state: "SC", zip: "29601" }), T1]);
const shopOrder = (await one(`select id from public.shop_orders where user_id = $1`, [CUST])).id;
await q(`insert into public.customer_messages (tenant_id, order_id, channel, kind, to_address, subject, body, status) values ($1, $2, 'email', 'receipt', $3, 'Your GT3 order', $4, 'sent')`,
  [T1, shopOrder, CASEY.email, `Thanks ${CASEY.name}, your tee ships to ${CASEY.street}.`]);
await q(`insert into public.reviews (user_id, name, rating, body, tenant_id) values ($1, $2, 5, 'The Rise is the best thing in Greenville', $3)`, [CUST, CASEY.name, T1]);
const reviewId = (await one(`select id from public.reviews where user_id = $1`, [CUST])).id;
await q(`insert into public.events (title, tenant_id) values ('Harvest Pour', $1)`, [T1]);
const ev = (await one(`select id from public.events where title = 'Harvest Pour'`)).id;
await q(`insert into public.rsvps (event_id, user_id, contact_email, tenant_id) values ($1, $2, $3, $4)`, [ev, CUST, CASEY.email, T1]);
await q(`insert into public.vip_verifications (user_id, photo_url, note, tenant_id) values ($1, $2, 'Firefighter, Station 3', $3)`, [CUST, `https://x.supabase.co/storage/v1/object/public/vip/${CUST}/badge.jpg`, T1]);
await q(`insert into public.subscription_interest (user_id, email, pack_size, tenant_id) values ($1, $2, '6', $3)`, [CUST, CASEY.email, T1]);
await q(`insert into public.loyalty_ledger (user_id, kind, points, note, tenant_id) values ($1, 'award', 10, 'First pour', $2)`, [CUST, T1]);
await q(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, tenant_id) values ($1, 'https://push.example/1', 'k', 'a', $2)`, [CUST, T1]);
await q(`insert into public.check_ins (user_id, day, note, tenant_id) values ($1, current_date, 'Slept badly before the 5k', $2)`, [CUST, T1]);
await q(`insert into public.referral_events (referrer, referee, referrer_credit_cents, referee_credit_cents, tenant_id) values ($1, $2, 500, 500, $3)`, [OWNER, CUST, T1]);
await q(`insert into public.subscriptions (user_id, customer_id, square_subscription_id, plan, status, tenant_id) values ($1, $2, 'sq-sub-1', 'six', 'active', $3)`, [CUST, custRec, T1]);
// a hold on two bottles of a live reserve (stock already taken off: 10 → 8), and a paid claim on another
await q(`insert into public.reserves (name, price_cents, stock_total, stock_remaining, per_member_limit, status, tenant_id) values ('Barrel Rise', 4000, 10, 8, 2, 'live', $1), ('Founders Cask', 6000, 5, 4, 1, 'live', $1)`, [T1]);
const barrel = (await one(`select id from public.reserves where name = 'Barrel Rise'`)).id;
const cask = (await one(`select id from public.reserves where name = 'Founders Cask'`)).id;
await q(`insert into public.reserve_claims (reserve_id, user_id, qty, state, hold_expires_at, tenant_id) values ($1, $2, 2, 'held', now() + interval '1 day', $3)`, [barrel, CUST, T1]);
await q(`insert into public.reserve_claims (reserve_id, user_id, qty, state, tenant_id) values ($1, $2, 1, 'paid', $3)`, [cask, CUST, T1]);

// ── the crew member's work, the operator's agreement, the owner's approval ──
await q(`insert into public.goals (title, target_value, created_by, author_name, tenant_id) values ('100 cups at Harvest Pour', 100, $1, $2, $3)`, [CREW, SAM.name, T1]);
await q(`insert into public.agent_knowledge (agent, title, body, created_by, author_name) values ('brew', 'Bloom for 45s', 'Pour slow.', $1, $2)`, [CREW, SAM.name]);
await q(`insert into public.strategy_decisions (key, decision, author_id, author_name) values ('pricing', 'Hold at $10', $1, $2)`, [CREW, SAM.name]);
await q(`insert into public.gtm_drafts (name, category, what, author_id, author_name) values ('Run club', 'community', 'Saturday 7am', $1, $2)`, [CREW, SAM.name]);
await q(`insert into public.meeting_notes (title, body, created_by, tenant_id) values ('Saturday debrief', 'Ice ran out at 11.', $1, $2)`, [CREW, T1]);
await q(`insert into public.operator_agreements (operator_name, operator_email, operator_user_id, signed_by, signed_name, status, tenant_id) values ('Pat Underhill', 'pat@example.test', $1, $1, 'Pat Underhill', 'signed', $2)`, [PAT, T1]);
await q(`insert into public.offer_letters (candidate_name, candidate_email, title, commission_pct, status, author_id, tenant_id) values ('Jordan Vale', 'jordan@example.test', 'Barista', 10, 'in_review', $1, $2)`, [OWNER, T1]);
const offer = (await one(`select id from public.offer_letters where candidate_name = 'Jordan Vale'`)).id;
await q(`insert into public.offer_approvals (offer_id, approver_id, decision) values ($1, $2, 'approved')`, [offer, OWNER]);

// ── 1 · nobody runs it by hand ──
const asRole = async (role, sql, params) => { await q(`set role ${role}`); try { return await raises(sql, params); } finally { await q(`reset role`); } };
ok("1 · a signed-in person cannot run the erasure", /permission denied/i.test((await asRole("authenticated", `select public.erase_account_data($1)`, [CUST])) || ""));
ok("1 · nor can the service role — deleting the account is what runs it", /permission denied/i.test((await asRole("service_role", `select public.erase_account_data($1)`, [CUST])) || ""));
ok("1 · a signed-in person cannot ask what stands in the way of someone's", /permission denied/i.test((await asRole("authenticated", `select public.account_erasure_blockers($1)`, [OWNER])) || ""));
ok("1 · the route can (as the service role), so it can answer before anything changes", (await asRole("service_role", `select public.account_erasure_blockers($1)`, [CREW])) === null);
ok("1 · deleting the account runs it: the trigger is on auth.users", (await count(`select count(*) n from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_deleted'`)) === 1);

// ── 2 · what it refuses ──
const blockers = async (id) => (await one(`select public.account_erasure_blockers($1) as b`, [id])).b.map((x) => `${x.code}: ${x.message}`);
ok("2 · the business's only owner is asked to name another owner first", (await blockers(OWNER)).some((b) => /^only_owner: .*only owner/.test(b)), await blockers(OWNER));
ok("2 · and deleting their account is refused, whole", /only owner/.test((await erase(OWNER)) || "") && (await count(`select count(*) n from public.profiles where id = $1`, [OWNER])) === 1);
ok("2 · a membership that can still bill is cancelled first — coded, so the route can cancel it itself", (await blockers(CUST)).some((b) => /^membership: .*can still bill/.test(b)), await blockers(CUST));
await q(`update public.subscriptions set status = 'canceled' where user_id = $1`, [CUST]);
ok("2 · a reserve they paid for, from a drop still running, holds it", (await blockers(CUST)).some((b) => /order on its way/.test(b)), await blockers(CUST));
await q(`update public.reserves set status = 'archived' where id = $1`, [cask]);
ok("2 · a pickup from last week still marked placed does NOT hold it (a stale status, not an order)", (await blockers(CUST)).length === 0, await blockers(CUST));
await q(`insert into public.drop_orders (user_id, customer_id, name, phone, size, glass, total_cents, drop_date, tenant_id) values ($1, $2, $3, $4, 6, 'new', 6000, current_date + 2, $5)`, [CUST, custRec, CASEY.name, CASEY.phone, T1]);
ok("2 · a pickup dated ahead holds it", (await blockers(CUST)).some((b) => /order on its way/.test(b)), await blockers(CUST));
const refused = await erase(CUST);
ok("2 · and deleting the account says so, in those words, and changes nothing", /order on its way/.test(refused || "") && (await count(`select count(*) n from public.reviews where user_id = $1`, [CUST])) === 1, refused);
await q(`update public.drop_orders set fulfillment_status = 'fulfilled', picked_up = true where user_id = $1 and drop_date > current_date`, [CUST]);
await q(`insert into public.orders (user_id, customer_id, customer, items, total_cents, tenant_id) values ($1, $2, $3, '{}', 1000, $4)`, [CUST, custRec, CASEY.name, T1]);
ok("2 · a truck order from the last twelve hours holds it", (await blockers(CUST)).some((b) => /order on its way/.test(b)), await blockers(CUST));
await q(`update public.orders set status = 'done' where user_id = $1`, [CUST]);   // fulfillment_status follows status (sync_order_status)
ok("2 · with the membership cancelled and the orders collected, nothing stands in the way", (await blockers(CUST)).length === 0, await blockers(CUST));

// ── 3–5 · the customer deletes their account ──
const ordersBefore = {
  drop: await count(`select count(*) n from public.drop_orders where customer_id = $1`, [custRec]),
  delivery: await count(`select count(*) n from public.delivery_orders where customer_id = $1`, [custRec]),
  shop: await count(`select count(*) n from public.shop_orders where customer_id = $1`, [custRec]),
  orders: await count(`select count(*) n from public.orders where customer_id = $1`, [custRec]),
};
const pastDrop = (await one(`select id from public.drop_orders where customer_id = $1 and drop_date < current_date`, [custRec])).id;
const gone = await erase(CUST);
ok("3 · the account goes — and its data with it, in the same delete", gone === null, gone);

// every foreign key in the schema that can name an account or a profile, asked for this one
async function stillNamed(id) {
  const refs = (await q(`select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and cardinality(c.conkey) = 1 and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)`)).rows;
  const found = [];
  for (const r of refs) if (await count(`select count(*) n from ${r.tbl} where ${r.col} = $1`, [id])) found.push(`${r.tbl}.${r.col}`);
  return { refs: refs.length, found };
}
// every text-ish column of every table, asked for the person's words
async function stillSaid(words) {
  const cols = (await q(`select c.table_schema as s, c.table_name as t, c.column_name as col from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema in ('public', 'auth') and c.data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY')`)).rows;
  const found = [];
  for (const c of cols) {
    for (const w of words) {
      if (await count(`select count(*) n from "${c.s}"."${c.t}" where "${c.col}"::text ilike $1`, [`%${w}%`])) found.push(`${c.t}.${c.col} has "${w}"`);
    }
  }
  return { cols: cols.length, found };
}
const named = await stillNamed(CUST);
ok(`3 · no foreign key anywhere names the customer's account (${named.refs} checked)`, named.refs > 100 && named.found.length === 0, named.found);
const said = await stillSaid([CASEY.name, "Quillfeather", CASEY.email, CASEY.phone, "8645550142", CASEY.street, "Gate code 4411", "blue door", "Station 3",
  "best thing in Greenville", "Gift for my sister", "Slept badly"]);
ok(`3 · their name, email, phone, address and words are in no column of any table — the audit trail included (${said.cols} columns read)`, said.cols > 600 && said.found.length === 0, said.found);
ok("3 · their review, RSVP, VIP proof, wait-list entry, points, check-in, holds and push subscription are gone",
  !(await count(`select count(*) n from public.reviews`)) && !(await count(`select count(*) n from public.rsvps where event_id = $1`, [ev]))
  && !(await count(`select count(*) n from public.vip_verifications`)) && !(await count(`select count(*) n from public.subscription_interest`))
  && !(await count(`select count(*) n from public.loyalty_ledger`)) && !(await count(`select count(*) n from public.check_ins`))
  && !(await count(`select count(*) n from public.reserve_claims`)) && !(await count(`select count(*) n from public.push_subscriptions`)));
ok("3 · the two bottles they held are back on the shelf", (await one(`select stock_remaining from public.reserves where id = $1`, [barrel])).stock_remaining === 10);
ok("3 · the referral pair is gone, and the person they referred is let go", !(await count(`select count(*) n from public.referral_events`)) && (await one(`select referred_by from public.profiles where id = $1`, [CREW])).referred_by === null);
ok("3 · the history of what was deleted went with it (their review's audit rows hold nothing)",
  (await count(`select count(*) n from public.audit_log where table_name = 'reviews' and row_id = $1`, [reviewId])) > 0
  && (await count(`select count(*) n from public.audit_log where table_name = 'reviews' and row_id = $1 and (old_data is not null or new_data is not null)`, [reviewId])) === 0);

const ordersAfter = {
  drop: await count(`select count(*) n from public.drop_orders where customer_id = $1`, [custRec]),
  delivery: await count(`select count(*) n from public.delivery_orders where customer_id = $1`, [custRec]),
  shop: await count(`select count(*) n from public.shop_orders where customer_id = $1`, [custRec]),
  orders: await count(`select count(*) n from public.orders where customer_id = $1`, [custRec]),
};
ok("4 · every order is kept, still pointing at its customer record", JSON.stringify(ordersAfter) === JSON.stringify(ordersBefore) && ordersAfter.drop === 2, { before: ordersBefore, after: ordersAfter });
ok("4 · with its money as it was", (await count(`select coalesce(sum(total_cents), 0) n from public.drop_orders where customer_id = $1`, [custRec])) === 12000
  && (await count(`select coalesce(sum(total_cents), 0) n from public.delivery_orders where customer_id = $1`, [custRec])) === 6500
  && (await count(`select coalesce(sum(total_cents), 0) n from public.shop_orders where customer_id = $1`, [custRec])) === 3200
  && (await count(`select coalesce(sum(total_cents), 0) n from public.orders where customer_id = $1`, [custRec])) === 1000);
const hist = (await q(`select new_data from public.audit_log where table_name = 'drop_orders' and row_id = $1 and new_data is not null order by id`, [pastDrop])).rows.map((r) => r.new_data);
ok("4 · and its history keeps its shape — the amount and every status — without them",
  hist.length >= 2 && hist.every((h) => h.total_cents === 6000 && h.name !== CASEY.name && h.user_id !== CUST) && hist.some((h) => h.fulfillment_status === "placed"), hist.map((h) => [h.total_cents, h.fulfillment_status, h.name, h.user_id]));
const rec = await one(`select name, phone, email, user_id from public.customers where id = $1`, [custRec]);
ok("4 · the customer record stays, as nobody", rec.name === "Deleted customer" && rec.phone === null && rec.email === null && rec.user_id === null, rec);
const msg = await one(`select to_address, body, status from public.customer_messages where order_id = $1`, [shopOrder]);
ok("4 · what was sent about their order is still on record as sent, without its words", msg.status === "sent" && msg.body === "deleted", msg);

const erasure = (await q(`select * from public.account_erasures`)).rows;
ok("5 · one erasure on record — its role and what was kept, nothing about who", erasure.length === 1 && erasure[0].role === "member" && erasure[0].orders_kept === 5
  && Object.keys(erasure[0]).sort().join(",") === "erased_at,id,orders_kept,role,rows_deleted,tenant_id", erasure);
ok("5 · counting what it deleted", erasure[0]?.rows_deleted >= 10, erasure[0]);

// ── the crew member deletes theirs ──
const crewGone = await erase(CREW);
ok("3 · a crew member's account goes too", crewGone === null, crewGone);
ok("3 · no foreign key names them", (await stillNamed(CREW)).found.length === 0, (await stillNamed(CREW)).found);
const samSaid = await stillSaid([SAM.name, "Thistlewood"]);
ok("3 · nor their name, anywhere", samSaid.found.length === 0, samSaid.found);
ok("4 · their work for the business stays, unsigned: the goal, the brew note, the decision, the draft, the meeting notes",
  (await count(`select count(*) n from public.goals where title = '100 cups at Harvest Pour' and created_by is null and author_name is null`)) === 1
  && (await count(`select count(*) n from public.agent_knowledge where title = 'Bloom for 45s' and created_by is null and author_name is null`)) === 1
  && (await count(`select count(*) n from public.strategy_decisions where key = 'pricing' and author_id is null and author_name is null`)) === 1
  && (await count(`select count(*) n from public.gtm_drafts where name = 'Run club' and author_id is null and author_name is null`)) === 1
  && (await count(`select count(*) n from public.meeting_notes where title = 'Saturday debrief' and created_by is null`)) === 1);

// ── the operator deletes theirs: the agreement is a contract, and stays as signed ──
const patGone = await erase(PAT);
ok("3 · an operator's account goes too", patGone === null, patGone);
ok("3 · no foreign key names them", (await stillNamed(PAT)).found.length === 0, (await stillNamed(PAT)).found);
const pact = await one(`select operator_name, signed_name, status, operator_user_id, signed_by from public.operator_agreements where operator_name = 'Pat Underhill'`);
ok("4 · their signed agreement stays as signed — the names on it kept, the link to the account gone",
  pact && pact.signed_name === "Pat Underhill" && pact.status === "signed" && pact.operator_user_id === null && pact.signed_by === null, pact);

// ── an owner, once there is another ──
await profile(OWNER2, "Second Owner", "owner");
ok("2 · with a second owner, the first may leave", (await blockers(OWNER)).length === 0, await blockers(OWNER));
const ownerGone = await erase(OWNER);
ok("3 · and their account goes", ownerGone === null, ownerGone);
const appr = await one(`select approver_id, decision from public.offer_approvals where offer_id = $1`, [offer]);
ok("4 · the offer they approved keeps the approval, without them", appr && appr.decision === "approved" && appr.approver_id === null, appr);
ok("5 · four erasures on record, by role", (await q(`select role from public.account_erasures`)).rows.map((r) => r.role).sort().join(",") === "member,operator,owner,server");

// ── the switch the erasure turns on is off again before its transaction goes on ──
await q(`insert into auth.users (id, email) values ('5a10e000-0000-4000-8000-0000000000f2', 'riley@example.test')`);
let after = "no error";
try {
  await db.transaction(async (tx) => {
    await tx.query(`delete from auth.users where id = '5a10e000-0000-4000-8000-0000000000f2'`);
    await tx.query(`delete from public.drop_orders where customer_id = $1`, [custRec]);   // someone else's books, same transaction
  });
} catch (e) { after = String(e.message || e); }
ok("the switch is off again the moment the erasure is done — the rest of its transaction is guarded as before", /Hard deletes are blocked on drop_orders/.test(after), after);

// ── the weekly audit prune, which 0141's guard had stopped ──
await q(`insert into public.audit_log (table_name, op, at) values ('prune_probe', 'INSERT', now() - interval '400 days'), ('prune_probe', 'INSERT', now() - interval '100 days')`);
const pruned = await raises(`select public.tidy_audit_log(365)`);
ok("the weekly audit prune runs again, keeps the year, and the switch it uses ends with it",
  pruned === null && (await count(`select count(*) n from public.audit_log where table_name = 'prune_probe'`)) === 1
  && /Hard deletes are blocked/.test((await raises(`delete from public.audit_log where table_name = 'prune_probe'`)) || ""), pruned);

// ── 6 · every table that points at an account and holds words about people has a decided fate ──
// deleted: only about the person · books: kept, emptied of them · work: kept, unsigned · signed: contracts,
// kept as signed · business: a company's account the person only used
const DECIDED = {
  deleted: ["academy_acknowledgements", "agent_convos", "check_ins", "loyalty_ledger", "profiles", "reviews", "rsvps", "subscription_interest",
            "team_invites", "user_activity", "vip_verifications"],
  books: ["customer_messages", "customers", "delivery_orders", "drop_orders", "jug_ledger", "loop_txns", "shop_orders"],
  work: ["account_activities", "agent_knowledge", "alerts", "asset_maintenance", "brew_batch_steps", "brew_batches", "comments", "compliance_checks",
         "compliance_rules", "content_items", "documents", "event_schedule_items", "expenses", "goals", "gtm_drafts", "inventory_ledger", "inventory_lots",
         "meeting_notes", "note_addenda", "note_files", "opportunities", "os_workstreams", "promos", "proposal_events", "proposals", "readiness_checks",
         "schema_migrations", "shoots", "shots", "strategy_decisions"],
  signed: ["agreement_hours", "offer_approvals", "offer_events", "offer_letters", "operator_agreement_events", "operator_agreements"],
  business: ["business_accounts", "business_orders"],
};
const decided = new Set(Object.values(DECIDED).flat());
const PERSONAL = /(^|_)(name|phone|email|address|street|zip|note|notes|body|bio|instructions|contact|description|summary|details|text|comment|message|photo|url|action)($|_)/i;
const refTables = (await q(`
  select cl.relname as tbl, array_agg(distinct col.column_name) as cols
    from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = 'public'
    join information_schema.columns col on col.table_schema = 'public' and col.table_name = cl.relname and col.data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY')
   where c.contype = 'f' and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass, 'public.customers'::regclass)
   group by 1`)).rows.filter((r) => r.cols.some((c) => PERSONAL.test(c)));
const undecided = refTables.filter((r) => !decided.has(r.tbl)).map((r) => `${r.tbl} (${r.cols.filter((c) => PERSONAL.test(c)).join(", ")})`);
ok(`6 · every table that points at an account and holds words about people has a decided fate (${refTables.length} tables) — a new one: decide what deleting an account does with it, in a migration, then list it here`,
  refTables.length >= 50 && undecided.length === 0, undecided);
const stale = [...decided].filter((t) => !refTables.some((r) => r.tbl === t));
ok("6 · and the list names no table that no longer points at an account", stale.length === 0, stale);

console.log(`DELETE MY ACCOUNT (0353): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
