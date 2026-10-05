// THE WINDOW SAYS WHAT IT TOOK — 0341, executed from its file against a real Postgres.
//
// The fixture copies the tables' real DDL — 0005's orders, 0119's drop_orders with 0136/0148's
// columns, 0139's delivery_orders, 0187's business_orders and invoices with their policies — and
// then runs 0155 VERBATIM, so the sync triggers 0341 redefines are the ones production has, attached
// the way production has them. A fixture that does not match production is a test that lies.
//
// Four claims are worth a database:
//   1. Cash and the reader are different writes. Cash sets paid; the reader must NOT, or Square's
//      walk-up count and report_sales count the same money twice. Asserted on the row.
//   2. "Settled" has one rule. The trigger derives payment_status; lib/collect.ts isSettled() says
//      the same thing in the app. Both are run over every legal row here — compiled from the real
//      TypeScript, not restated — and over the optimistic patches the pass paints before the
//      database answers.
//   3. What was paid at the window cannot be canceled from a phone, and nothing else about
//      cancelling changed.
//   4. An invoice is visible when it is owed and only then. The backfills settle what the orders
//      already say in the same run that dates the rest — so the invoices below exist BEFORE 0341
//      runs, in each of the states production can hold, and the test reads what is left owed.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const S1 = "00000000-0000-0000-0000-0000000000a1";   // a server at the window
const S2 = "00000000-0000-0000-0000-0000000000a2";   // a second server
const AD = "00000000-0000-0000-0000-0000000000ad";   // an owner
const M = "00000000-0000-0000-0000-0000000000b1";    // a member
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s, p) => (await db.query(s, p)).rows[0];
const rows = async (s, p) => (await db.query(s, p)).rows;
const raises = async (s, p) => { try { await db.query(s, p); return null; } catch (e) { return String(e.message || e); } };
const as = async (uid, { staff = false, admin = false, tenant = T } = {}) => db.exec(`
  select set_config('test.uid', '${uid}', false), set_config('test.staff', '${staff ? "on" : "off"}', false),
         set_config('test.admin', '${admin ? "on" : "off"}', false), set_config('test.tenant', '${tenant}', false);`);

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  insert into auth.users (id) values ('${S1}'), ('${S2}'), ('${AD}'), ('${M}');
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public to anon, authenticated;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('test.uid', true), ''), '')::uuid $$;
  create or replace function public.is_staff() returns boolean language sql stable as $$
    select coalesce(current_setting('test.staff', true), 'off') = 'on' $$;
  create or replace function public.is_admin() returns boolean language sql stable as $$
    select coalesce(current_setting('test.admin', true), 'off') = 'on' $$;
  create or replace function public.effective_tenant() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('test.tenant', true), ''), '${T}')::uuid $$;

  create table public.tenants (id uuid primary key);
  insert into public.tenants (id) values ('${T}'), ('${T2}');
  create table public.changelog (id uuid primary key default gen_random_uuid(), title text,
    category text, area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null,
    applied_at timestamptz, recorded_at timestamptz not null default now(), applied_by uuid,
    applied_count int not null default 1, evidence text not null default 'stamped', note text);
  create or replace function public.record_migration(p_version text, p_note text default null)
  returns public.schema_migrations language plpgsql as $$
  declare r public.schema_migrations; begin
    insert into public.schema_migrations (version, seq, applied_at, note)
    values (p_version, substring(p_version from '^[0-9]+')::int, now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1
    returning * into r; return r; end $$;
  create table public.alerts (id uuid primary key default gen_random_uuid(),
    severity text not null default 'important', category text, title text not null, body text,
    link text default '/admin', created_at timestamptz not null default now());

  -- 0005, with the columns 0153 / 0193 added
  create table public.orders (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid references auth.users(id) on delete set null,
    customer    text,
    items       text[] not null,
    total_cents int not null,
    paid        boolean not null default false,
    payment_id  text,
    status      text not null default 'new' check (status in ('new', 'preparing', 'ready', 'done', 'void')),
    created_at  timestamptz not null default now(),
    tenant_id   uuid references public.tenants(id) default '${T}',
    customer_id uuid);

  -- 0119, with 0136's canceled_at, 0148's stage, 0153's tenant and 0193's customer
  create table public.drop_orders (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid references auth.users(id) on delete set null,
    name              text not null,
    phone             text,
    size              int  not null check (size in (3, 6, 12)),
    glass             text not null check (glass in ('return', 'new')),
    mix               jsonb not null default '{}'::jsonb,
    total_cents       int  not null,
    paid              boolean not null default false,
    payment_id        text,
    drop_date         date not null,
    picked_up         boolean not null default false,
    bottles_returned  boolean not null default false,
    created_at        timestamptz not null default now(),
    canceled_at       timestamptz,
    stage             text not null default 'reserved' check (stage in ('reserved','preparing','ready','en_route','picked_up')),
    tenant_id         uuid references public.tenants(id) default '${T}',
    customer_id       uuid);

  -- 0139, the columns the unified view and 0155 read
  create table public.delivery_orders (
    id             uuid primary key default gen_random_uuid(),
    tenant_id      uuid references public.tenants(id) default '${T}',
    user_id        uuid references auth.users(id),
    customer_id    uuid,
    total_cents    int not null,
    payment_status text not null default 'paid' check (payment_status in ('pending','paid','failed','refunded')),
    status         text not null default 'received' check (status in ('received','brewed','out_for_delivery','delivered','held_for_pickup','issue')),
    canceled_at    timestamptz,
    created_at     timestamptz not null default now());

  -- 0187, verbatim where 0341 reads it, with 0193's customer_id and 0220's payment_id
  create table public.business_accounts (id uuid primary key default gen_random_uuid(),
    tenant_id uuid default '${T}', user_id uuid references auth.users(id), company text not null, market text);
  create table public.business_orders (
    id            uuid primary key default gen_random_uuid(),
    tenant_id     uuid references public.tenants(id) default '${T}',
    business_id   uuid references public.business_accounts(id),
    user_id       uuid references auth.users(id),
    company       text not null,
    delivery_date date not null,
    gallons       numeric not null check (gallons >= 3),
    total_cents   int not null,
    billing_terms text not null default 'prepaid' check (billing_terms in ('prepaid','net15','net30')),
    payment_status text not null default 'pending' check (payment_status in ('pending','paid','invoiced','failed','refunded')),
    status        text not null default 'received' check (status in ('received','brewed','out_for_delivery','delivered','held_for_pickup','issue')),
    canceled_at   timestamptz,
    created_at    timestamptz not null default now(),
    customer_id   uuid,
    payment_id    text);
  create table public.invoices (
    id            uuid primary key default gen_random_uuid(),
    tenant_id     uuid references public.tenants(id) default '${T}',
    business_id   uuid references public.business_accounts(id),
    business_order_id uuid references public.business_orders(id),
    amount_cents  int not null,
    terms         text not null default 'net15',
    status        text not null default 'open' check (status in ('open','sent','paid','void')),
    issued_at     timestamptz not null default now(),
    due_at        date,
    paid_at       timestamptz,
    note          text,
    created_at    timestamptz not null default now());
  alter table public.business_orders enable row level security;
  alter table public.invoices        enable row level security;
  create policy "biz order own read" on public.business_orders
    for select using (user_id = (select auth.uid()));
  create policy "biz order own insert" on public.business_orders
    for insert with check (user_id = (select auth.uid()));
  create policy "biz order own cancel" on public.business_orders
    for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  create policy "biz order staff" on public.business_orders
    for all using ((select public.is_staff())) with check ((select public.is_staff()));
  create policy "invoice staff" on public.invoices
    for all using ((select public.is_staff())) with check ((select public.is_staff()));
  grant select, insert, update on public.business_orders to authenticated;
  grant select on public.invoices to authenticated;
`);

// 0155 as it is in production: the derived columns, the sync triggers, the first unified view.
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0155_real_status_columns.sql"), "utf8"));

// ── THE INVOICES PRODUCTION CAN ALREADY HOLD, written before 0341 exists ─────────────────────────
// Every one has due_at null, because OfficeOrders never wrote one.
const acct = (await q1(`insert into public.business_accounts (user_id, company) values ('${M}', 'Acme') returning id`)).id;
const bo = async (pay, extra = "") => (await q1(`insert into public.business_orders
  (business_id, user_id, company, delivery_date, gallons, total_cents, billing_terms, payment_status ${extra ? ", canceled_at" : ""})
  values ('${acct}', '${M}', 'Acme', '2026-09-28', 3, 13500, 'net15', '${pay}' ${extra ? `, ${extra}` : ""}) returning id`)).id;
const inv = async (order, terms, status, issued) => (await q1(`insert into public.invoices
  (business_id, business_order_id, amount_cents, terms, status, issued_at)
  values ('${acct}', ${order ? `'${order}'` : "null"}, 13500, '${terms}', '${status}', '${issued}') returning id`)).id;
const oPaidByLink = await bo("paid");                        // the webhook settled the order; its invoice stayed open
const oOwed = await bo("invoiced");
const oCanceled = await bo("invoiced", "now()");
const oSent30 = await bo("invoiced");
const iPaidByLink = await inv(oPaidByLink, "net15", "open", "2026-09-01T15:00:00Z");
const iOwed = await inv(oOwed, "net15", "open", "2026-09-20T15:00:00Z");
const iCanceled = await inv(oCanceled, "net15", "open", "2026-09-20T15:00:00Z");
const iSent30 = await inv(oSent30, "net30", "sent", "2026-09-20T15:00:00Z");

const MIG = readFileSync(join(ROOT, "supabase/migrations/0341_the_window_says_what_it_took.sql"), "utf8");
await db.exec(MIG);
console.log("0341 executed against a real Postgres (on top of 0155, verbatim).\n");

// ── 1 · THE COLUMNS ────────────────────────────────────────────────────────────────────────────
const cols = (await rows(`select table_name || '.' || column_name c from information_schema.columns
  where table_name in ('orders','drop_orders') and column_name like 'collected_%' order by 1`)).map((r) => r.c);
ok("six columns: how, when and who, on both boards", cols.join() ===
  "drop_orders.collected_at,drop_orders.collected_by,drop_orders.collected_via,orders.collected_at,orders.collected_by,orders.collected_via", cols);
const order = async (extra = {}) => (await q1(`insert into public.orders (customer, items, total_cents, paid, payment_id, status, user_id)
  values ($1, '{rise}', $2, $3, $4, $5, $6) returning id`,
  [extra.who ?? "Dana", extra.cents ?? 850, extra.paid ?? false, extra.payment_id ?? null, extra.status ?? "new", extra.user ?? null])).id;
const pack = async (extra = {}) => (await q1(`insert into public.drop_orders (name, size, glass, total_cents, paid, payment_id, drop_date, stage, user_id)
  values ($1, 6, 'new', $2, $3, $4, '2026-10-10', $5, $6) returning id`,
  [extra.who ?? "Rae", extra.cents ?? 4000, extra.paid ?? false, extra.payment_id ?? null, extra.stage ?? "reserved", extra.user ?? null])).id;
{
  const o = await order();
  ok("a third way to pay is refused by the table", /check/i.test(await raises(`update public.orders set collected_via = 'venmo', collected_at = now() where id = '${o}'`) ?? ""));
  ok("a method with no moment is refused — how and when are one fact",
    /collected_pair/.test(await raises(`update public.orders set collected_via = 'cash' where id = '${o}'`) ?? ""));
  ok("…and a moment with no method", /collected_pair/.test(await raises(`update public.drop_orders set collected_at = now() where id = '${await pack()}'`) ?? ""));
}

// ── 2 · TAKING IT ──────────────────────────────────────────────────────────────────────────────
const collect = (kind, id, via) => q1(`select public.staff_collect_payment($1, $2, $3) r`, [kind, id, via]).then((x) => x.r);
const undo = (kind, id) => q1(`select public.staff_undo_collection($1, $2) r`, [kind, id]).then((x) => x.r);
const row = (t, id) => q1(`select paid, collected_via, collected_at, collected_by, payment_status, status_text from (
  select paid, collected_via, collected_at::text, collected_by::text, payment_status, ${t === "orders" ? "status" : "stage"} status_text
    from public.${t} where id = $1) x`, [id]);

await as(S1, { staff: true });
const cash = await order({ who: "Dana", cents: 850 });
ok("cash at the window: collected", (await collect("cup", cash, "cash")) === "collected");
let r = await row("orders", cash);
ok("cash sets paid — the till is counted nowhere else", r.paid === true && r.collected_via === "cash", r);
ok("…says who took it", r.collected_by === S1, r.collected_by);
ok("…and the trigger calls it settled", r.payment_status === "paid", r.payment_status);
ok("…without moving the ticket", r.status_text === "new", r.status_text);

const reader = await order({ who: "Lee", cents: 900 });
ok("the card reader: collected", (await collect("cup", reader, "card_reader")) === "collected");
r = await row("orders", reader);
ok("the reader does NOT set paid — Square already counts it as a walk-up", r.paid === false && r.collected_via === "card_reader", r);
ok("…and the order is settled all the same", r.payment_status === "paid", r.payment_status);

ok("a second tap is not a second payment", (await collect("cup", reader, "cash")) === "already settled");
r = await row("orders", reader);
ok("…and does not rewrite how it was paid", r.collected_via === "card_reader" && r.paid === false, r);

const online = await order({ paid: true, payment_id: "sq_pay_1" });
ok("a card paid online needs nothing at the window", (await collect("cup", online, "cash")) === "already settled");
ok("…and gets no collection stamped on it", (await row("orders", online)).collected_at === null);

ok("a voided order cannot be collected", /voided/.test(await raises(`select public.staff_collect_payment('cup', $1, 'cash')`, [await order({ status: "void" })]) ?? ""));
ok("a third way to pay is refused by the function, in words",
  /cash or card_reader/.test(await raises(`select public.staff_collect_payment('cup', $1, 'venmo')`, [await order()]) ?? ""));
ok("an unknown board is refused", /unknown kind/.test(await raises(`select public.staff_collect_payment('delivery', $1, 'cash')`, [await order()]) ?? ""));

const pCash = await pack({ who: "Rae", cents: 4000, stage: "ready" });
ok("a pack, cash: collected", (await collect("pickup", pCash, "cash")) === "collected");
r = await row("drop_orders", pCash);
ok("…paid, settled, still ready for pickup", r.paid === true && r.payment_status === "paid" && r.status_text === "ready", r);
const pReader = await pack({ who: "Kai" });
await collect("pickup", pReader, "card_reader");
r = await row("drop_orders", pReader);
ok("a pack on the reader: settled, not paid", r.paid === false && r.payment_status === "paid" && r.collected_via === "card_reader", r);
const pGone = await pack();
await db.exec(`update public.drop_orders set canceled_at = now() where id = '${pGone}'`);
ok("a canceled pack cannot be collected", /canceled/.test(await raises(`select public.staff_collect_payment('pickup', $1, 'cash')`, [pGone]) ?? ""));

await as(M);
ok("a member cannot record a payment", /not authorized/.test(await raises(`select public.staff_collect_payment('cup', $1, 'cash')`, [await order()]) ?? ""));
await as(S1, { staff: true, tenant: T2 });
ok("another tenant's staff cannot reach this tenant's order", /does not exist/.test(await raises(`select public.staff_collect_payment('cup', $1, 'cash')`, [await order()]) ?? ""));
await as(S1, { staff: true });

// ── 3 · ONE RULE, IN SQL AND IN THE APP ────────────────────────────────────────────────────────
// lib/collect.ts compiled from its source, the way db.stalledorder compiles lib/shopOrder — with
// the one module it imports, lib/settled.ts, where the rule itself lives.
const ts = (await import("typescript")).default;
const compileTs = (rel, req) => {
  const mod = { exports: {} };
  new Function("module", "exports", "require",
    ts.transpileModule(readFileSync(join(ROOT, rel), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  )(mod, mod.exports, req);
  return mod.exports;
};
const SETTLED = compileTs("lib/settled.ts", () => ({}));
const C = compileTs("lib/collect.ts", (id) => (id === "./settled" ? SETTLED : {}));
ok("known pair: the crew's isSettled is the customer's — one function, re-exported, not a copy", C.isSettled === SETTLED.isSettled);
ok("known pair: lib/collect compiled, and isSettled found", typeof C.isSettled === "function" && typeof C.collectedPatch === "function");
ok("known pair: the app's two ways are the table's two ways", JSON.stringify(C.COLLECT_VIA) === JSON.stringify(["cash", "card_reader"]));
{
  // Every legal combination: paid or not, collected or not, by either way.
  const combos = [];
  for (const paid of [false, true]) for (const via of [null, "cash", "card_reader"]) {
    const id = await order({ paid });
    if (via) await db.exec(`update public.orders set collected_via = '${via}', collected_at = now() where id = '${id}'`);
    combos.push(id);
  }
  const got = await rows(`select o.id, o.paid, o.collected_via, o.collected_at::text, o.payment_status, a.payment_status view_status
    from public.orders o join public.all_orders a on a.id = o.id and a.channel = 'cup' where o.id = any($1)`, [combos]);
  const off = got.filter((x) => C.isSettled(x) !== (x.payment_status === "paid"));
  ok("known pair: isSettled() and the trigger agree on every legal row", got.length === 6 && off.length === 0, off);
  // The rule itself, from its own two columns: what the trigger computes from, with nothing stored.
  const offRule = got.filter((x) => C.isSettled({ paid: x.paid, collected_at: x.collected_at }) !== (x.payment_status === "paid"));
  ok("known pair: …from the rule's own two columns, paid and collected_at", offRule.length === 0, offRule);
  const offWithoutNew = got.filter((x) => C.isSettled({ paid: x.paid, payment_status: x.payment_status }) !== (x.payment_status === "paid"));
  ok("known pair: …and from the old columns alone — a screen that selected only paid and payment_status gets the same answer",
    offWithoutNew.length === 0, offWithoutNew);
  ok("all_orders reads the trigger's answer, not a second CASE", got.every((x) => x.view_status === x.payment_status), got);
}
{
  // The optimistic patch the pass paints must be what the database then writes.
  for (const via of ["cash", "card_reader"]) {
    const id = await order();
    const before = await row("orders", id);
    const patch = C.collectedPatch(before, via, new Date().toISOString(), S1);
    await collect("cup", id, via);
    const after = await row("orders", id);
    ok(`known pair: the pass's optimistic ${via} patch is what the database wrote`,
      patch.paid === after.paid && patch.payment_status === after.payment_status && patch.collected_via === after.collected_via, { patch, after });
    const back = C.undonePatch(after);
    await undo("cup", id);
    const undone = await row("orders", id);
    ok(`known pair: …and the ${via} undo patch is what the database put back`,
      back.paid === undone.paid && back.payment_status === undone.payment_status && undone.collected_at === null, { back, undone });
  }
}
{
  const id = await pack({ stage: "preparing" });
  const v = await q1(`select fulfillment_status, payment_status from public.all_orders where id = $1`, [id]);
  ok("a pack being prepared reads in_prep in the unified view — what the pack is, not 0193's 'placed'", v.fulfillment_status === "in_prep", v);
  const off = await q1(`select a.payment_status from public.all_orders a where a.id = $1`, [oOwed]);
  ok("an invoiced office order still reads as money owed", off.payment_status === "pending", off);
}

// ── 4 · TAKING IT BACK ─────────────────────────────────────────────────────────────────────────
{
  const id = await order();
  await collect("cup", id, "cash");
  await as(S2, { staff: true });
  ok("another server cannot take back what someone else took", /only the person who took it/.test(await raises(`select public.staff_undo_collection('cup', $1)`, [id]) ?? ""));
  await as(S1, { staff: true });
  ok("the server who took it can, inside the hour", (await undo("cup", id)) === "undone");
  r = await row("orders", id);
  ok("…and cash comes off paid", r.paid === false && r.collected_via === null && r.payment_status === "pending", r);
  ok("it can then be taken again, the right way", (await collect("cup", id, "card_reader")) === "collected");

  const late = await order();
  await collect("cup", late, "cash");
  await db.exec(`update public.orders set collected_at = now() - interval '2 hours' where id = '${late}'`);
  ok("after the hour, not even the one who took it", /only the person who took it/.test(await raises(`select public.staff_undo_collection('cup', $1)`, [late]) ?? ""));
  await as(AD, { staff: true, admin: true });
  ok("an admin can, any time", (await undo("cup", late)) === "undone");
  await as(S1, { staff: true });

  ok("a card paid online has nothing to take back", (await undo("cup", online)) === "nothing to undo");
  ok("…and stays paid", (await row("orders", online)).paid === true);
  const pr = await pack();
  await collect("pickup", pr, "card_reader");
  await undo("pickup", pr);
  r = await row("drop_orders", pr);
  ok("a reader collection taken back never touched paid", r.paid === false && r.collected_at === null && r.payment_status === "pending", r);
}

// The app's mirror of who may undo: the same three cases.
{
  const now = Date.now();
  const mine = { collected_via: "cash", collected_at: new Date(now - 5 * 60e3).toISOString(), collected_by: S1 };
  ok("known pair: canUndo — the collector, inside the hour", C.canUndo(mine, S1, false, now) === true);
  ok("known pair: canUndo — not another server", C.canUndo(mine, S2, false, now) === false);
  ok("known pair: canUndo — not after the hour", C.canUndo({ ...mine, collected_at: new Date(now - 2 * 3600e3).toISOString() }, S1, false, now) === false);
  ok("known pair: canUndo — an admin, any time", C.canUndo({ ...mine, collected_at: new Date(now - 9 * 3600e3).toISOString() }, AD, true, now) === true);
  ok("known pair: canUndo — never an online payment", C.canUndo({ paid: true, payment_id: "x", collected_at: null }, AD, true, now) === false);
}

// ── 5 · NOT CANCELED FROM A PHONE ──────────────────────────────────────────────────────────────
{
  const cancelO = (id) => q1(`select public.cancel_own_order($1) r`, [id]).then((x) => x.r);
  const cancelP = (id) => q1(`select public.cancel_own_reservation($1) r`, [id]).then((x) => x.r);
  const mineCash = await order({ user: M });
  const mineOpen = await order({ user: M });
  const mineOnline = await order({ user: M, paid: true, payment_id: "sq_pay_m" });
  const packCash = await pack({ user: M });
  const packOpen = await pack({ user: M });
  await collect("cup", mineCash, "cash");
  await collect("pickup", packCash, "card_reader");
  const alertsBefore = Number((await q1(`select count(*) n from public.alerts`)).n);
  await as(M);
  ok("a member cannot cancel an order they paid for at the window", (await cancelO(mineCash)) === false);
  ok("…it is still on the pass", (await row("orders", mineCash)).status_text === "new");
  ok("…and no refund alert was raised for money that is in the till", Number((await q1(`select count(*) n from public.alerts`)).n) === alertsBefore);
  ok("an unpaid order still cancels, exactly as before", (await cancelO(mineOpen)) === true);
  ok("a card paid online still cancels, exactly as before", (await cancelO(mineOnline)) === true);
  ok("…with exactly one refund flag, exactly as before",
    Number((await q1(`select count(*) n from public.alerts where title ilike '%refund%'`)).n) === alertsBefore + 1);
  ok("a pack paid at the window cannot be canceled from a phone", (await cancelP(packCash)) === false);
  ok("an unpaid pack still cancels", (await cancelP(packOpen)) === true);
  await as(S1, { staff: true });
}

// ── 6 · A MEMBER DOES NOT WRITE THEIR OWN OFFICE ORDER ─────────────────────────────────────────
{
  const pol = (await rows(`select polname from pg_policy where polrelid = 'public.business_orders'::regclass order by 1`)).map((x) => x.polname);
  ok("the member insert and update policies are gone; reading and the crew's stay",
    pol.join() === "biz order own read,biz order staff", pol);
  const target = await bo("invoiced");
  await as(M);
  await db.exec(`set role authenticated`);
  const seen = Number((await q1(`select count(*) n from public.business_orders where id = '${target}'`)).n);
  const changed = (await db.query(`update public.business_orders set payment_status = 'paid' where id = '${target}' returning id`)).rows.length;
  const forged = await raises(`insert into public.business_orders (user_id, company, delivery_date, gallons, total_cents, payment_status)
    values ('${M}', 'Acme', '2026-10-05', 3, 1, 'paid')`);
  await db.exec(`reset role`);
  await as(S1, { staff: true });
  ok("a member still reads their own office order", seen === 1, seen);
  ok("a member can no longer mark their own office order paid", changed === 0, changed);
  ok("…or insert one at a price they chose", /row-level security|policy/i.test(forged ?? ""), forged);
  ok("…and the order is still owed", (await q1(`select payment_status from public.business_orders where id = $1`, [target])).payment_status === "invoiced");
}

// ── 7 · INVOICES ───────────────────────────────────────────────────────────────────────────────
const invRow = (id) => q1(`select status, due_at::text, paid_at is not null as paid_at_set from public.invoices where id = $1`, [id]);
{
  // The backfills, which ran on rows that existed before 0341.
  ok("backfill: an invoice whose order was paid by link is paid, not overdue", (await invRow(iPaidByLink)).status === "paid");
  ok("…with no invented payment time — when it was paid was never recorded", (await invRow(iPaidByLink)).paid_at_set === false);
  ok("backfill: an invoice whose order was canceled is void", (await invRow(iCanceled)).status === "void");
  ok("backfill: an owed net15 invoice is due fifteen days after its ET issue date", (await invRow(iOwed)).due_at === "2026-10-05", await invRow(iOwed));
  ok("backfill: a sent net30 invoice, thirty", (await invRow(iSent30)).due_at === "2026-10-20", await invRow(iSent30));
  const owed = (await rows(`select id from public.invoices where due_at is not null and status in ('open','sent') order by issued_at, id`)).map((x) => x.id);
  ok("what v_obligations will now see is exactly the money still owed", owed.length === 2 && owed.includes(iOwed) && owed.includes(iSent30), owed);
  ok("no invoice is left without a due date", Number((await q1(`select count(*) n from public.invoices where due_at is null`)).n) === 0);
}
{
  const o = await bo("pending");
  const a = (await q1(`insert into public.invoices (business_id, business_order_id, amount_cents, terms, status, issued_at)
    values ('${acct}', '${o}', 13500, 'net15', 'open', '2026-10-05T02:00:00Z') returning id`)).id;
  ok("at insert: the due date comes from the terms, counted from the ET day (10 PM Oct 4 ET is Oct 4)", (await invRow(a)).due_at === "2026-10-19", await invRow(a));
  const b = (await q1(`insert into public.invoices (business_id, amount_cents, terms) values ('${acct}', 100, 'net30') returning id, issued_at, due_at::text`));
  // Thirty CALENDAR days from the ET issue date — what the trigger computes. The expectation used to
  // add 30 × 24 hours to the instant and then read the ET date, which is a day short whenever the
  // thirty days cross the November clock change and the invoice is issued in ET's first hour: CI ran
  // this at 04:01 UTC on 2026-10-05 (00:01 EDT) and failed on a due date that was right (#589).
  const etDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const plusDays = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  ok("at insert: net30 is thirty days", b.due_at === plusDays(etDay(b.issued_at), 30), b);
  const dst = (await q1(`insert into public.invoices (business_id, amount_cents, terms, issued_at) values ('${acct}', 100, 'net30', '2026-10-05T04:01:31Z') returning due_at::text`));
  ok("at insert: net30 across the clock change — issued 00:01 EDT on Oct 5, due Nov 4", dst.due_at === "2026-11-04", dst);
  const c = (await q1(`insert into public.invoices (business_id, amount_cents, terms, due_at) values ('${acct}', 100, 'net15', '2026-12-25') returning due_at::text`));
  ok("a due date somebody set on purpose is kept", c.due_at === "2026-12-25", c);
  ok("terms are the two the app writes", /invoices_terms_check/.test(await raises(`insert into public.invoices (business_id, amount_cents, terms) values ('${acct}', 100, 'net45')`) ?? ""));

  await db.exec(`update public.business_orders set payment_status = 'paid' where id = '${o}'`);
  ok("an invoice follows its order: paid there is paid here", (await invRow(a)).status === "paid" && (await invRow(a)).paid_at_set === true, await invRow(a));
  await db.exec(`update public.business_orders set canceled_at = now() where id = '${o}'`);
  ok("…and a later cancel does not unpay it", (await invRow(a)).status === "paid");

  const o2 = await bo("invoiced");
  const d = await inv(o2, "net15", "open", "2026-10-01T15:00:00Z");
  await db.exec(`update public.business_orders set canceled_at = now() where id = '${o2}'`);
  ok("canceled there is void here", (await invRow(d)).status === "void");
}
{
  const markPaid = (id) => q1(`select public.mark_invoice_paid($1) r`, [id]).then((x) => x.r);
  const o = await bo("invoiced");
  const i = await inv(o, "net15", "sent", "2026-10-01T15:00:00Z");
  ok("a server cannot mark an invoice paid — money is the owner's", /owner or admin/.test(await raises(`select public.mark_invoice_paid($1)`, [i]) ?? ""));
  await as(AD, { staff: true, admin: true });
  ok("an admin marks it paid", (await markPaid(i)) === "paid");
  ok("…the invoice is paid, with the time", (await invRow(i)).status === "paid" && (await invRow(i)).paid_at_set === true);
  ok("…and so is its order, in the same write", (await q1(`select payment_status from public.business_orders where id = $1`, [o])).payment_status === "paid");
  ok("a second tap says so and changes nothing", (await markPaid(i)) === "already paid");
  ok("a void invoice is not paid", /voided/.test(await raises(`select public.mark_invoice_paid($1)`, [iCanceled]) ?? ""));
  await as(AD, { staff: true, admin: true, tenant: T2 });
  ok("another tenant's admin cannot reach it", /does not exist/.test(await raises(`select public.mark_invoice_paid($1)`, [iOwed]) ?? ""));
  await as(S1, { staff: true });
}

// ── 8 · WHO MAY CALL WHAT ──────────────────────────────────────────────────────────────────────
const can = async (role, fn) => (await q1(`select has_function_privilege('${role}', '${fn}', 'execute') v`)).v;
ok("anon cannot record a payment", (await can("anon", "public.staff_collect_payment(text,uuid,text)")) === false);
ok("anon cannot undo one", (await can("anon", "public.staff_undo_collection(text,uuid)")) === false);
ok("anon cannot mark an invoice paid", (await can("anon", "public.mark_invoice_paid(uuid)")) === false);
ok("authenticated can reach all three — each checks is_staff / is_admin itself",
  (await can("authenticated", "public.staff_collect_payment(text,uuid,text)")) && (await can("authenticated", "public.staff_undo_collection(text,uuid)")) && (await can("authenticated", "public.mark_invoice_paid(uuid)")));
ok("a trigger function is not an API: nobody may call invoice_follows_order", (await can("authenticated", "public.invoice_follows_order()")) === false && (await can("anon", "public.invoice_follows_order()")) === false);

// ── 9 · RE-RUNNABLE, AND RECORDED ──────────────────────────────────────────────────────────────
{
  const before = Number((await q1(`select count(*) n from public.invoices where status = 'paid'`)).n);
  let err = null;
  try { await db.exec(MIG); } catch (e) { err = String(e.message || e); }
  ok("0341 runs twice without error", err === null, err);
  ok("…and the second run changes no invoice", Number((await q1(`select count(*) n from public.invoices where status = 'paid'`)).n) === before);
  ok("…nor duplicates its changelog line", Number((await q1(`select count(*) n from public.changelog where title like 'Money taken at the window%'`)).n) === 1);
  ok("0341 recorded itself", Number((await q1(`select applied_count n from public.schema_migrations where version = '0341_the_window_says_what_it_took'`)).n) === 2);
}

console.log(fail
  ? `THE WINDOW SAYS WHAT IT TOOK: ${pass} passed, ${fail} FAILED`
  : `THE WINDOW SAYS WHAT IT TOOK: ${pass} passed, 0 failed`);
await db.close();
process.exit(fail ? 1 : 0);
