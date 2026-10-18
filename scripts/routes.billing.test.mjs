// THE THREE MONEY ROUTES NOTHING RAN (R30, 2026-10-18 — the 10/10 audit, operations F13's last).
//
// R16 ran the money routes that charge a card (scripts/routes.money.test.mjs and its siblings). Three that move money
// were still read and never run:
//   · /api/billing/checkout — an operator's software subscription, a Stripe Checkout for the caller's business;
//   · /api/office/paylink — the Square payment link for a prepaid office order, and switching one off;
//   · /api/shop/resubmit — sending a paid shop order to the printer, which places an order against a card at Apliiq.
// Each is compiled from its TypeScript and run here as Next runs it, over a stand-in Supabase that applies the filters
// each write sends (so a write that forgets the caller's business reaches nothing, and shows), with Stripe, Square and
// Apliiq stood in at the edge. Every person and business is made up.
import { routeLoader, NextResponseShim } from "./fixtures/moneyWorld.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };

const T1 = "00000000-0000-4000-8000-0000000000a1", T2 = "00000000-0000-4000-8000-0000000000a2";

// ── the stand-in Supabase: reads, updates, inserts and rpcs, each applying its filters; any write can be refused ─────
function world(tables = {}) {
  const db = { tables, calls: [], fail: {}, rpcs: {} };
  const match = (t, filters) => (db.tables[t] ?? []).filter((r) => filters.every(([op, c, v]) =>
    op === "eq" ? r[c] != null && String(r[c]) === String(v)
      : op === "is" ? (v === null ? r[c] == null : r[c] === v)
        : op === "in" ? v.map(String).includes(String(r[c])) : true));
  db.from = (table) => {
    const call = { table, op: "select", filters: [], patch: null };
    let single = false, back = false;
    const q = {
      select() { if (call.op !== "select") back = true; return q; },
      update(p) { call.op = "update"; call.patch = p; return q; },
      insert(p) { call.op = "insert"; call.patch = p; return q; },
      eq(c, v) { call.filters.push(["eq", c, v]); return q; },
      is(c, v) { call.filters.push(["is", c, v]); return q; },
      in(c, v) { call.filters.push(["in", c, v]); return q; },
      maybeSingle() { single = true; return q; },
      then(res, rej) {
        return Promise.resolve().then(() => {
          db.calls.push(call);
          const f = db.fail[`${table}.${call.op}`];
          if (f) { if (!(f.times > 1)) delete db.fail[`${table}.${call.op}`]; else f.times--; return { data: null, error: { message: f.message ?? "refused" } }; }
          if (call.op === "select") { const rows = match(table, call.filters).map((r) => ({ ...r })); return { data: single ? rows[0] ?? null : rows, error: null }; }
          if (call.op === "update") { const rows = match(table, call.filters); for (const r of rows) Object.assign(r, call.patch); return { data: back ? rows.map((r) => ({ ...r })) : null, error: null }; }
          (db.tables[table] ??= []).push(...[].concat(call.patch));
          return { data: null, error: null };
        }).then(res, rej);
      },
    };
    return q;
  };
  db.rpc = async (fn, args) => { db.calls.push({ rpc: fn, args }); const h = db.rpcs[fn]; return h ? h(args) : { data: null, error: { message: `no function ${fn}` } }; };
  db.writes = (table) => db.calls.filter((c) => c.table === table && c.op !== "select");
  return db;
}

// ── the edges ───────────────────────────────────────────────────────────────────────────────────────────────────────
const who = { owner: true, staff: true, tenant: T1 };
const alerts = [];
const admin = { supabaseAdmin: null };
const apliiq = { sent: [], next: { ok: true, apliiqOrderId: "APQ-ORDER-1" } };
const office = { off: "off", asked: [] };
const net = { calls: [], answer: null };
globalThis.fetch = async (url, init) => {
  net.calls.push({ url: String(url), init });
  const a = typeof net.answer === "function" ? net.answer(String(url), init) : net.answer;
  return new Response(JSON.stringify(a?.body ?? {}), { status: a?.status ?? 200, headers: { "content-type": "application/json" } });
};
const load = routeLoader({
  "next/server": { NextResponse: NextResponseShim },
  "@/lib/supabaseAdmin": admin,
  "@/lib/apiRoute": { route: (_n, f) => f },
  "@/lib/apiAuth": {
    ownerFromRequest: async () => who.owner, staffFromRequest: async () => who.staff, tenantFromRequest: async () => who.tenant,
  },
  "@/lib/serverAlerts": { raiseAlert: async (a) => { alerts.push(a); } },
  "@/lib/apliiq": { submitOrderToApliiq: async (o) => { apliiq.sent.push(o); return apliiq.next; } },
  "@/lib/officeLink": { switchOffPaylink: async (token, o) => { office.asked.push(o.id); return office.off; } },
});
const post = async (R, body, raw) => {
  const res = await R.POST(new Request("https://app.example.test/api/x", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer made-up" },
    body: raw ?? JSON.stringify(body ?? {}) }));
  return { status: res.status, j: await res.json().catch(() => ({})) };
};
const reset = (tables) => { const db = world(tables); admin.supabaseAdmin = db; alerts.length = 0; net.calls.length = 0; apliiq.sent.length = 0; office.asked.length = 0; Object.assign(who, { owner: true, staff: true, tenant: T1 }); return db; };

// ── 1 · /api/billing/checkout ──────────────────────────────────────────────────────────────────────────────────────
{
  const R = load("app/api/billing/checkout/route.ts");
  ok("compiled: billing/checkout", typeof R.POST === "function");
  const tenants = () => [{ id: T1, slug: "made-up-bar", plan: "free", stripe_customer_id: null }, { id: T2, slug: "gt3", plan: "founder", stripe_customer_id: null }];
  delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_PRICE_PRO;
  reset({ tenants: tenants() });
  const off = await post(R);
  ok("billing: not switched on (no Stripe key or price) — a 503, and Stripe is never asked", off.status === 503 && net.calls.length === 0, off);
  Object.assign(process.env, { STRIPE_SECRET_KEY: "sk_test_made_up", STRIPE_PRICE_PRO: "price_made_up", NEXT_PUBLIC_APP_URL: "https://app.example.test" });
  reset({ tenants: tenants() }); who.owner = false;
  const crew = await post(R);
  ok("billing: an owner's alone — anyone else is refused before the business is read or Stripe asked", crew.status === 403 && net.calls.length === 0 && admin.supabaseAdmin.calls.length === 0, crew);
  reset({ tenants: tenants() }); who.tenant = null;
  const none = await post(R);
  ok("billing: an owner with no business on the session — a 400, nothing asked", none.status === 400 && net.calls.length === 0, none);
  reset({ tenants: tenants() }); who.tenant = T2;
  const founder = await post(R);
  ok("billing: the founding business has nothing to buy — refused before Stripe", founder.status === 400 && /Founding/.test(founder.j.error) && net.calls.length === 0, founder);
  reset({ tenants: tenants() });
  net.answer = { status: 200, body: { url: "https://checkout.stripe.example.test/c/made-up" } };
  const buy = await post(R);
  const sent = net.calls[0], form = new URLSearchParams(String(sent?.init?.body ?? ""));
  ok("billing: one Checkout session, for this business — its id as the reference, the plan's price, one seat, back to the console either way",
    buy.status === 200 && buy.j.url === "https://checkout.stripe.example.test/c/made-up" && net.calls.length === 1
    && sent.url === "https://api.stripe.com/v1/checkout/sessions" && sent.init.method === "POST" && sent.init.headers.Authorization === "Bearer sk_test_made_up"
    && form.get("mode") === "subscription" && form.get("client_reference_id") === T1 && form.get("line_items[0][price]") === "price_made_up" && form.get("line_items[0][quantity]") === "1"
    && form.get("success_url") === "https://app.example.test/crew?billing=success" && form.get("cancel_url") === "https://app.example.test/crew?billing=canceled"
    && !form.has("customer") && !!sent.init.signal, { buy, form: [...form] });
  admin.supabaseAdmin.tables.tenants[0].stripe_customer_id = "cus_made_up";
  net.calls.length = 0;
  await post(R);
  ok("billing: a business Stripe already knows is sent as that customer, not made again", new URLSearchParams(String(net.calls[0]?.init?.body ?? "")).get("customer") === "cus_made_up");
  net.answer = { status: 400, body: { error: { message: "No such price: 'price_made_up'" } } };
  const refused = await post(R);
  net.answer = { status: 200, body: {} };
  const empty = await post(R);
  ok("billing: Stripe's refusal is said as Stripe said it, and an answer with no page to go to is no success — both 502",
    refused.status === 502 && /No such price/.test(refused.j.error) && empty.status === 502 && empty.j.error === "Stripe error." && !empty.j.url, { refused, empty });
}

// ── 2 · /api/office/paylink ────────────────────────────────────────────────────────────────────────────────────────
{
  const R = load("app/api/office/paylink/route.ts");
  ok("compiled: office/paylink", typeof R.POST === "function");
  const O1 = "0f000000-0000-4000-8000-0000000000b1", O2 = "0f000000-0000-4000-8000-0000000000b2";
  const orders = () => [
    { id: O1, tenant_id: T1, company: "Made-up Dental", gallons: 3, total_cents: 18000, payment_status: "unpaid", paylink_url: null, paylink_id: null, square_order_id: null, canceled_at: null },
    { id: O2, tenant_id: T2, company: "Another Business", gallons: 2, total_cents: 12000, payment_status: "unpaid", paylink_url: null, paylink_id: null, square_order_id: null, canceled_at: null },
  ];
  Object.assign(process.env, { SQUARE_ACCESS_TOKEN: "made-up-square-token", NEXT_PUBLIC_SQUARE_LOCATION_ID: "L-MADE-UP" });
  let db = reset({ business_orders: orders() }); who.staff = false;
  const stranger = await post(R, { orderId: O1 });
  ok("paylink: the crew's alone — anyone else is refused before an order is read", stranger.status === 401 && db.calls.length === 0, stranger);
  db = reset({ business_orders: orders() }); who.tenant = null;
  ok("paylink: crew with no business on the session — refused, nothing read", (await post(R, { orderId: O1 })).status === 401 && db.calls.length === 0);
  db = reset({ business_orders: orders() });
  const bad = await post(R, { orderId: "not-an-id" }), nobody = await post(R, {}), notJson = await post(R, null, "{");
  ok("paylink: an id that isn't one, no id, a body that isn't JSON — each a 400, never a read", bad.status === 400 && nobody.status === 400 && notJson.status === 400 && db.calls.length === 0, { bad, nobody, notJson });
  db = reset({ business_orders: orders() });
  const theirs = await post(R, { orderId: O2 });
  ok("paylink: another business's order is not found from this one — read only within the caller's business, and Square never asked",
    theirs.status === 404 && net.calls.length === 0 && db.calls[0].filters.some(([op, c, v]) => op === "eq" && c === "tenant_id" && v === T1), theirs);
  db = reset({ business_orders: orders() }); db.fail["business_orders.select"] = { message: "connection reset" };
  const unread = await post(R, { orderId: O1 });
  ok("paylink: a read that fails is said as a failure to read — a 503, not \"not found\"", unread.status === 503 && /Couldn't read the order/.test(unread.j.error), unread);
  for (const [why, patch, want] of [["canceled", { canceled_at: "2026-10-17T12:00:00Z" }, /canceled/], ["paid", { payment_status: "paid" }, /already paid/], ["no total", { total_cents: 0 }, /no total/]]) {
    db = reset({ business_orders: orders() }); Object.assign(db.tables.business_orders[0], patch);
    const r = await post(R, { orderId: O1 });
    ok(`paylink: an order ${why} gets no link — refused before Square`, r.status === 400 && want.test(r.j.error) && net.calls.length === 0, r);
  }
  db = reset({ business_orders: orders() }); db.tables.business_orders[0].paylink_url = "https://square.link/u/made-up-old";
  const again = await post(R, { orderId: O1 });
  ok("paylink: an order with its link already — the same link back, Square not asked again", again.status === 200 && again.j.url === "https://square.link/u/made-up-old" && net.calls.length === 0, again);
  db = reset({ business_orders: orders() });
  net.answer = { status: 200, body: { payment_link: { id: "PL-MADE-UP", url: "https://square.link/u/made-up", order_id: "SQ-ORDER-MADE-UP" } } };
  const made = await post(R, { orderId: O1 });
  const body = JSON.parse(String(net.calls[0]?.init?.body ?? "{}")), row = db.tables.business_orders[0], w = db.writes("business_orders")[0];
  ok("paylink: one Square link for the order's total, keyed to the order (a retry gets the same link), and its ids kept on the order in this business",
    made.status === 200 && made.j.url === "https://square.link/u/made-up" && net.calls[0].url.endsWith("/v2/online-checkout/payment-links")
    && body.quick_pay?.price_money?.amount === 18000 && body.quick_pay?.price_money?.currency === "USD" && body.quick_pay?.location_id === "L-MADE-UP"
    && /Made-up Dental · 3 gal/.test(body.quick_pay?.name) && /paylink-0f000000/.test(body.idempotency_key)
    && row.paylink_url === "https://square.link/u/made-up" && row.paylink_id === "PL-MADE-UP" && row.square_order_id === "SQ-ORDER-MADE-UP"
    && w.filters.some(([op, c, v]) => op === "eq" && c === "tenant_id" && v === T1) && db.tables.business_orders[1].paylink_url === null, { made, body, row });
  db = reset({ business_orders: orders() });
  net.answer = { status: 400, body: { errors: [{ detail: "Invalid location" }] } };
  const sqNo = await post(R, { orderId: O1 });
  ok("paylink: Square's refusal is said, and nothing is kept on the order", sqNo.status === 502 && /Invalid location/.test(sqNo.j.error) && db.tables.business_orders[0].paylink_url === null, sqNo);
  db = reset({ business_orders: orders() }); db.fail["business_orders.update"] = { message: "refused" };
  net.answer = { status: 200, body: { payment_link: { id: "PL-MADE-UP", url: "https://square.link/u/made-up", order_id: "SQ-ORDER-MADE-UP" } } };
  const unsaved = await post(R, { orderId: O1 });
  ok("paylink: a link made but not kept is said loudly (the webhook could never mark it paid) — tap again, the same link comes back",
    unsaved.status === 502 && /didn't save/.test(unsaved.j.error) && !unsaved.j.url, unsaved);
  // Switching a link off, when the order was paid another way.
  db = reset({ business_orders: orders() }); Object.assign(db.tables.business_orders[0], { paylink_url: "https://square.link/u/made-up", paylink_id: "PL-MADE-UP" });
  office.off = "off";
  const offed = await post(R, { orderId: O1, off: true });
  ok("paylink off: off at Square, and taken off the order in this business — said as off",
    offed.status === 200 && offed.j.ok === true && offed.j.link === "off" && office.asked.join() === O1 && db.tables.business_orders[0].paylink_url === null && db.tables.business_orders[0].paylink_id === null
    && db.writes("business_orders")[0].filters.some(([op, c, v]) => op === "eq" && c === "tenant_id" && v === T1), offed);
  db = reset({ business_orders: orders() }); Object.assign(db.tables.business_orders[0], { paylink_url: "https://square.link/u/made-up", paylink_id: "PL-MADE-UP" });
  db.fail["business_orders.update"] = { message: "refused" };
  const half = await post(R, { orderId: O1, off: true });
  ok("paylink off: off at Square but still on the order — said, a 500, so the crew tries again", half.status === 500 && half.j.link === "off" && /still shows it/.test(half.j.error), half);
  db = reset({ business_orders: orders() }); office.off = "unknown";
  const unsure = await post(R, { orderId: O1, off: true });
  office.off = "none";
  db = reset({ business_orders: orders() });
  const noLink = await post(R, { orderId: O1, off: true });
  ok("paylink off: Square unsure is not ok; no link to switch off is (and the order isn't written either way)",
    unsure.j.ok === false && unsure.j.link === "unknown" && noLink.j.ok === true && noLink.j.link === "none" && db.writes("business_orders").length === 0, { unsure, noLink });
}

// ── 3 · /api/shop/resubmit ─────────────────────────────────────────────────────────────────────────────────────────
{
  const R = load("app/api/shop/resubmit/route.ts");
  ok("compiled: shop/resubmit", typeof R.POST === "function");
  const S1 = "05000000-0000-4000-8000-0000000000c1", P1 = "05000000-0000-4000-8000-0000000000d1";
  const shop = () => ({
    shop_orders: [{ id: S1, tenant_id: T1, ship_name: "Made-up Customer", ship_address: { street: "1 Made-up St", city: "Greenville", state: "SC", zip: "29601" }, email: "c@example.test",
      apliiq_order_id: null, status: "paid", apliiq_submit_started_at: "2026-10-18T17:00:00Z", apliiq_submit_unknown_at: null }],
    shop_order_items: [{ order_id: S1, product_id: P1, title: "Made-up Cap", variant: { size: "OS", color: "Black" }, qty: 1, unit_cents: 3500 }],
    shop_products: [{ id: P1, tenant_id: T1, variants: [{ size: "OS", color: "Black", sku: "APQ-5888205S87A1" }] }],
  });
  const claimed = (db, answer = "ok") => { db.rpcs.claim_shop_order_for_submit = async (a) => (a.p_tenant === T1 && a.p_order === S1 ? { data: answer, error: null } : { data: "not found", error: null }); };
  let db = reset(shop()); who.staff = false;
  const stranger = await post(R, { orderId: S1 });
  ok("resubmit: the crew's alone — refused first, before anything is claimed or sent", stranger.status === 403 && db.calls.length === 0 && apliiq.sent.length === 0, stranger);
  db = reset(shop()); who.tenant = null;
  ok("resubmit: crew with no business on the session — refused, nothing claimed", (await post(R, { orderId: S1 })).status === 403 && db.calls.length === 0);
  db = reset(shop());
  ok("resubmit: an id that isn't one — a 400, nothing claimed", (await post(R, { orderId: "x" })).status === 400 && db.calls.length === 0);
  db = reset(shop()); db.rpcs.claim_shop_order_for_submit = async () => ({ data: null, error: { message: "timeout" } });
  const unsure = await post(R, { orderId: S1 });
  ok("resubmit: a claim that can't be asked is no claim — nothing sent (the failure here is a second cap and a second charge)", unsure.status === 503 && /Nothing was sent/.test(unsure.j.error) && apliiq.sent.length === 0, unsure);
  db = reset(shop()); claimed(db, "already at the printer");
  const taken = await post(R, { orderId: S1 });
  ok("resubmit: a claim refused — its words, a 409, nothing sent", taken.status === 409 && taken.j.error === "already at the printer" && apliiq.sent.length === 0, taken);
  db = reset(shop()); claimed(db); db.tables.shop_order_items = [];
  const empty = await post(R, { orderId: S1 });
  ok("resubmit: an order with no lines — let go (a press after the fix isn't refused for two minutes), nothing sent",
    empty.status === 409 && apliiq.sent.length === 0 && db.tables.shop_orders[0].apliiq_submit_started_at === null, empty);
  db = reset(shop()); claimed(db); db.fail["shop_orders.update"] = { message: "refused" };
  const unmarked = await post(R, { orderId: S1 });
  ok("resubmit: not written as \"no clear answer yet\" before it leaves — so not sent at all", unmarked.status === 503 && apliiq.sent.length === 0, unmarked);
  db = reset(shop()); claimed(db); apliiq.next = { ok: true, apliiqOrderId: "APQ-ORDER-1" };
  const sentOk = await post(R, { orderId: S1 });
  const order = db.tables.shop_orders[0], out = apliiq.sent[0];
  ok("resubmit: sent once — the line re-priced as sold and its SKU read again from the product (in this business); at the printer, said with Apliiq's id",
    sentOk.status === 200 && sentOk.j.apliiqOrderId === "APQ-ORDER-1" && apliiq.sent.length === 1 && out.id === S1 && out.items[0].sku === "APQ-5888205S87A1" && out.items[0].priceCents === 3500
    && out.ship.name === "Made-up Customer" && out.ship.zip === "29601" && order.apliiq_order_id === "APQ-ORDER-1" && order.status === "submitted" && order.apliiq_submit_unknown_at === null
    && db.writes("shop_orders").every((c) => c.filters.some(([op, col, v]) => op === "eq" && col === "tenant_id" && v === T1))
    && db.calls.find((c) => c.table === "shop_products")?.filters.some(([op, col, v]) => op === "eq" && col === "tenant_id" && v === T1), { sentOk, order, out });
  db = reset(shop()); claimed(db); apliiq.next = { ok: false, unclear: true, error: "timed out after 25s" };
  const unclear = await post(R, { orderId: S1 });
  ok("resubmit: no clear answer from Apliiq — the order stays \"look in Apliiq first\" (never offered again), and the crew told",
    unclear.status === 502 && unclear.j.unclear === true && db.tables.shop_orders[0].apliiq_submit_unknown_at !== null && db.tables.shop_orders[0].apliiq_submit_started_at === null
    && alerts.length === 1 && alerts[0].kind === "printer_unclear" && alerts[0].link === "/crew?s=catalog&a=shoporders", { unclear, alerts });
  db = reset(shop()); claimed(db); apliiq.next = { ok: false, error: "no payment method on file" };
  const refused = await post(R, { orderId: S1 });
  ok("resubmit: refused by Apliiq — nothing at the printer, the claim let go, and the crew told why",
    refused.status === 502 && /no payment method/.test(refused.j.error) && db.tables.shop_orders[0].apliiq_submit_started_at === null && db.tables.shop_orders[0].apliiq_submit_unknown_at === null
    && alerts.length === 1 && alerts[0].kind === "fulfillment" && /Nothing reached the printer/.test(alerts[0].body), { refused, alerts });
  db = reset(shop()); claimed(db); apliiq.next = { ok: true, apliiqOrderId: "APQ-ORDER-2" };
  const realUpdate = db.from;
  let n = 0;
  db.from = (t) => { const q = realUpdate(t); if (t !== "shop_orders") return q; const up = q.update; q.update = (p) => { if (p.apliiq_order_id) { n++; db.fail["shop_orders.update"] = { message: "refused" }; } return up(p); }; return q; };
  const lost = await post(R, { orderId: S1 });
  ok("resubmit: at the printer but not written back (tried twice) — critical, Apliiq's id in the words, and never \"send it again\"",
    lost.status === 500 && lost.j.unclear === true && /APQ-ORDER-2/.test(lost.j.error) && /Do not send it again/.test(lost.j.error) && n === 2
    && alerts.length === 1 && alerts[0].severity === "critical" && /APQ-ORDER-2/.test(alerts[0].body) && db.tables.shop_orders[0].apliiq_submit_unknown_at !== null, { lost, alerts });
}

console.log(`\nTHE MONEY ROUTES NOTHING RAN (billing, office paylink, shop resubmit): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
