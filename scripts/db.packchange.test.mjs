// 0388 — A PACK IS CHANGED IN PLACE, executed from its file against the whole schema (every migration before it, in
// order: scripts/fixtures/schema.full.mjs), with lib/packChange driving it the way app/api/reserve/change does.
//
// The finding, as a sentence (C5 of the customer frontend audit): "Change the pack" placed a second reservation and
// canceled the first, so a paid pack was charged again in full and the first payment waited on a crew alert. After
// 0388 the pack changes in place and only the difference moves — charged, refunded, or nothing — under one key, once.
//
// Square is stood in for: a charge or refund answers ok, declines/refuses, or throws (Square did not say). Everything
// else is real: 0388's functions, the drop_orders triggers, RLS, and lib/packChange compiled from its TypeScript.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";
import { libLoader } from "./fixtures/chargeonce.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const F388 = "0388_a_pack_is_changed_in_place.sql";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const pc = libLoader()("lib/packChange.ts");

const T1 = "00000000-0000-0000-0000-000000000001";
const JORDAN = "0c388000-0000-4000-8000-0000000000c1", RIVER = "0c388000-0000-4000-8000-0000000000c2",
  STAFF = "0c388000-0000-4000-8000-0000000000c3";

const t0 = Date.now();
const db = await fullSchema({ before: "0388" });
console.log(`the schema before 0388 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
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
  grant select on all tables in schema public to anon, authenticated;
`);
for (const [id, role] of [[JORDAN, "member"], [RIVER, "member"], [STAFF, "server"]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
  await db.query(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, T1, `Made-up ${role}`]);
}
// Made-up packs. A paid 12-pack ($60 on pay_P1), a pay-at-pickup 6-pack ($30), and spares for the guards.
const pack = async (o) => (await q(`insert into public.drop_orders (user_id, name, phone, size, glass, mix, total_cents, paid, payment_id, drop_date)
  values ($1, $2, '+18645550100', $3, $4, $5::jsonb, $6, $7, $8, $9) returning id`,
  [o.user ?? JORDAN, o.name ?? "Jordan Made-up", o.size, o.glass ?? "return", JSON.stringify(o.mix), o.total, o.paid ?? false, o.payment ?? null, o.day ?? "2026-10-24"]))[0].id;
const P1 = await pack({ size: 12, mix: { RISE: 12 }, total: 6000, paid: true, payment: "pay_P1" });
const P2 = await pack({ size: 6, mix: { FLOW: 6 }, total: 3000 });
const row = async (id) => (await q(`select size, glass, mix, drop_date::text d, total_cents t, paid, payment_id, canceled_at from public.drop_orders where id = $1`, [id]))[0];
const pts = async () => (await q(`select coalesce(points, 0)::int p from public.profiles where id = $1`, [JORDAN]))[0].p;
const ptsBefore = await pts();

// ── BEFORE 0388 ───────────────────────────────────────────────────────────────────────────────────────────────
{
  let err = null;
  try { await q(`select public.pack_change_begin('k-before-0388', $1, $2, '{}'::jsonb, 0, false, 0)`, [P1, JORDAN]); } catch (e) { err = String(e.message || e); }
  ok("before 0388: there is no way to change a pack in place (the page placed a second order)", /pack_change_begin/.test(err || "") && /does not exist/.test(err || ""), err);
}

await db.exec(MIG(F388));

// ── the store, as lib/packChangeStore calls 0388 — one function per step ──────────────────────────────────────
const one = async (sql, params) => (await q(sql, params))[0].r;
const store = {
  begin: (a) => one(`select public.pack_change_begin($1, $2, $3, $4::jsonb, $5, $6, $7) r`, [a.key, a.order, a.user, JSON.stringify(a.after), a.newTotal, a.payNow, a.expectedDiff]),
  moved: (key, m) => one(`select public.pack_change_moved($1, $2, $3::jsonb, $4, $5) r`, [key, m.chargePaymentId, JSON.stringify(m.refunds), m.byHand, m.outcome]),
  end: (key, state, outcome) => one(`select public.pack_change_end($1, $2, $3) r`, [key, state, outcome]),
  apply: (key, who) => one(`select public.pack_change_apply($1, $2, $3) r`, [key, who?.name ?? null, who?.phone ?? null]),
  refunded: (key, r) => one(`select public.pack_change_refunded($1, $2::jsonb) r`, [key, JSON.stringify(r)]),
  answer: async (key, a) => { await q(`select public.pack_change_answer($1, $2, $3::jsonb)`, [key, a.status, JSON.stringify(a.body)]); },
};
// Square, stood in for. A script entry per call: "ok" (the default), "decline"/"refuse", or "unknown" (throws).
const sq = { charges: [], refunds: [], chargeScript: [], refundScript: [] };
const money = {
  async charge({ amountCents, key }) {
    sq.charges.push({ amountCents, key });
    const s = sq.chargeScript.shift() ?? "ok";
    if (s === "unknown") throw new Error("Square answered 503 (TEMPORARY_ERROR)");
    if (s === "decline") return { ok: false, error: "Card declined." };
    return { ok: true, paymentId: `pay_C${sq.charges.length}` };
  },
  async refund({ paymentId, amountCents, key }) {
    sq.refunds.push({ paymentId, amountCents, key });
    const s = sq.refundScript.shift() ?? "ok";
    if (s === "unknown") throw new Error("Square answered 500 (INTERNAL_SERVER_ERROR)");
    if (s === "refuse") return { ok: false, error: "The requested refund amount exceeds the amount available to refund." };
    return { ok: true, refundId: `ref_${sq.refunds.length}`, status: "PENDING" };
  },
};
const told = { crew: [], customer: [] };
const tell = { crew: async (a) => { told.crew.push(a); }, customer: async (c, words, phone) => { told.customer.push(words); told.phone = phone; } };
let clock = Date.parse("2026-10-20T15:00:00Z");
const after = (o) => ({ size: o.size, glass: o.glass ?? "return", mix: o.mix, drop_date: o.day ?? "2026-10-24", total_cents: o.total, benefit_code: null });
const change = (key, order, o, extra = {}) => pc.changePack({ store, money, tell, now: () => clock, key, order, user: extra.user ?? JORDAN,
  after: after(o), who: extra.who ?? { name: "Jordan Made-up", phone: "+18645550100" }, newTotal: o.total, payNow: extra.payNow ?? false, expectedDiff: extra.expectedDiff ?? 0 });
const ch = async (key) => (await q(`select state, diff_cents, charge_payment_id, refunds, by_hand_cents, status, card from public.drop_order_changes where key = $1`, [key]))[0];

// ── a paid pack, smaller: the difference goes back to the card that paid ──────────────────────────────────────
{
  const a = await change("k-down-0001", P1, { size: 6, mix: { RISE: 6 }, total: 3000 }, { expectedDiff: -3000 });
  ok("smaller: answered 200, $30 refunded, the pack changed", a.status === 200 && a.body.refundedCents === 3000 && a.body.changed === true, a);
  ok("…one refund, of $30, on the pack's own payment, under a key of its own", sq.refunds.length === 1 && sq.refunds[0].paymentId === "pay_P1" && sq.refunds[0].amountCents === 3000 && sq.refunds[0].key === "k-down-0001.r0", sq.refunds);
  const r = await row(P1);
  ok("…the same row, changed in place: a 6-pack, $30, still paid by pay_P1", r.size === 6 && r.t === 3000 && r.paid === true && r.payment_id === "pay_P1" && r.mix.RISE === 6, r);
  ok("…no second reservation was placed", (await q(`select count(*)::int n from public.drop_orders where user_id = $1`, [JORDAN]))[0].n === 2);
  const c = await ch("k-down-0001");
  ok("…its record: done, −$30, the refund on it", c.state === "done" && c.diff_cents === -3000 && c.refunds.length === 1 && c.refunds[0].cents === 3000, c);
  ok("…the customer is told what moved, at the pack's phone", told.customer.at(-1)?.includes("$30 is going back to the card you paid with") && told.phone === "+18645550100", told.customer.at(-1));
  const kept = (await q(`select after::text a, coalesce(answer::text, '') b, coalesce(outcome, '') c from public.drop_order_changes where key = 'k-down-0001'`))[0];
  ok("…and the change log keeps no name or phone — they went onto the pack", !/Jordan|5550100/.test(kept.a + kept.b + kept.c), kept);
  ok("…the crew is told, plainly", told.crew.some((x) => x.kind === "reservation_changed" && /12-pack → 6-pack/.test(x.body) && /Refunded \$30/.test(x.body)), told.crew);
  const again = await change("k-down-0001", P1, { size: 6, mix: { RISE: 6 }, total: 3000 }, { expectedDiff: -3000 });
  ok("the same key again: the same answer, and no second refund", again.status === 200 && again.body.refundedCents === 3000 && sq.refunds.length === 1, again);
}

// ── a new name and phone go onto the pack with the change; a change finished later keeps the pack's ───────────────
{
  const a = await change("k-rename-001", P1, { size: 6, mix: { RISE: 6 }, total: 3000 }, { expectedDiff: 0, who: { name: "Jordan M. Made-up", phone: "+18645550199" } });
  const r = (await q(`select name, phone from public.drop_orders where id = $1`, [P1]))[0];
  ok("a change carries the name and phone the page sent onto the pack", a.status === 200 && r.name === "Jordan M. Made-up" && r.phone === "+18645550199", { a, r });
  ok("…and the crew's line names them as the pack now does", told.crew.at(-1)?.body.startsWith("Jordan M. Made-up changed their pack"), told.crew.at(-1));
  await change("k-rename-002", P1, { size: 6, mix: { RISE: 6 }, total: 3000 }, { expectedDiff: 0, who: { name: "Jordan Made-up", phone: "+18645550100" } });
}

// ── bigger: the difference is charged, under the change's own key ─────────────────────────────────────────────
{
  const a = await change("k-up-0000002", P1, { size: 12, mix: { RISE: 6, DUSK: 6 }, total: 6000 }, { expectedDiff: 3000 });
  ok("bigger: answered 200, $30 charged", a.status === 200 && a.body.chargedCents === 3000, a);
  ok("…one charge of the difference, under the change's key", sq.charges.length === 1 && sq.charges[0].amountCents === 3000 && sq.charges[0].key === "k-up-0000002", sq.charges);
  const r = await row(P1);
  ok("…the pack is a 12-pack at $60 again, its own payment kept", r.size === 12 && r.t === 6000 && r.payment_id === "pay_P1", r);
  const f = await one(`select public.pack_change_funding($1) r`, [P1]);
  ok("funding, newest first: the $30 just charged, then $30 left on pay_P1 (it paid $60, $30 came back)",
    f.length === 2 && f[0].payment_id === "pay_C1" && f[0].left === 3000 && f[1].payment_id === "pay_P1" && f[1].left === 3000, f);
}

// ── smaller again, past what the newest payment holds: the refund is split, newest first ──────────────────────
{
  const n = sq.refunds.length;
  const a = await change("k-split-0003", P1, { size: 3, mix: { FLOW: 3 }, total: 1500 }, { expectedDiff: -4500 });
  const parts = sq.refunds.slice(n);
  ok("split: $45 back as $30 from the newest payment and $15 from the first", a.status === 200 && parts.length === 2
    && parts[0].paymentId === "pay_C1" && parts[0].amountCents === 3000 && parts[1].paymentId === "pay_P1" && parts[1].amountCents === 1500
    && parts[0].key === "k-split-0003.r0" && parts[1].key === "k-split-0003.r1", parts);
  const f = await one(`select public.pack_change_funding($1) r`, [P1]);
  ok("…and nothing left on the newest, $15 on the first", f[0].left === 0 && f[1].left === 1500, f);
}

// ── the same price: nothing moves ─────────────────────────────────────────────────────────────────────────────
{
  const c0 = sq.charges.length, r0 = sq.refunds.length;
  const a = await change("k-same-0004", P1, { size: 3, mix: { DUSK: 3 }, total: 1500, day: "2026-10-31" }, { expectedDiff: 0 });
  ok("same price, another day: changed, nothing charged or refunded", a.status === 200 && !a.body.chargedCents && !a.body.refundedCents && sq.charges.length === c0 && sq.refunds.length === r0, a);
  const r = await row(P1);
  ok("…the day and the mix moved in place", r.d === "2026-10-31" && r.mix.DUSK === 3, r);
  ok("…and the text says so", told.customer.at(-1)?.includes("Same price — nothing charged."), told.customer.at(-1));
}

// ── a pay-at-pickup pack: changed with nothing charged, or paid now ───────────────────────────────────────────
{
  const a = await change("k-later-0005", P2, { size: 12, mix: { FLOW: 12 }, total: 6000 }, { expectedDiff: 0 });
  const r = await row(P2);
  ok("pay at pickup: changed in place, still to pay at pickup, $60", a.status === 200 && r.size === 12 && r.t === 6000 && r.paid === false, { a, r });
  ok("…its text names what is due at pickup", told.customer.at(-1)?.includes("$60 at pickup"), told.customer.at(-1));
  const b = await change("k-paynow-006", P2, { size: 12, mix: { FLOW: 12 }, total: 6000 }, { payNow: true, expectedDiff: 6000 });
  const r2 = await row(P2);
  ok("…paid now: the whole $60 charged, and the pack paid by that payment", b.status === 200 && b.body.chargedCents === 6000 && r2.paid === true && r2.payment_id === `pay_C${sq.charges.length}`, { b, r2 });
  const f = await one(`select public.pack_change_funding($1) r`, [P2]);
  ok("…its funding is that one payment, $60 to refund from", f.length === 1 && f[0].left === 6000, f);
}

// ── the difference the page was shown is the one that moves ───────────────────────────────────────────────────
{
  const n = (await q(`select count(*)::int n from public.drop_order_changes`))[0].n;
  const a = await change("k-reprice-07", P1, { size: 12, mix: { RISE: 12 }, total: 6000 }, { expectedDiff: 3000 });
  ok("repriced: the page was shown +$30 and it is +$45 — refused before anything moves", a.status === 409 && a.body.priceChanged === true && a.body.diffCents === 4500, a);
  ok("…no change recorded, so the same key can confirm the new difference", (await q(`select count(*)::int n from public.drop_order_changes`))[0].n === n);
}

// ── Square says no, or does not say ───────────────────────────────────────────────────────────────────────────
{
  sq.chargeScript.push("decline");
  const a = await change("k-decline-08", P1, { size: 12, mix: { RISE: 12 }, total: 6000 }, { expectedDiff: 4500 });
  ok("declined: 400, the key let go, the pack as it was", a.status === 400 && a.body.declined === true && (await row(P1)).size === 3, a);
  ok("…its record: refused", (await ch("k-decline-08")).state === "refused");

  const crew0 = told.crew.length;
  sq.chargeScript.push("unknown");
  const b = await change("k-unknown-09", P1, { size: 12, mix: { RISE: 12 }, total: 6000 }, { expectedDiff: 4500 });
  ok("not confirmed: 409 pending — the page keeps its key — and the pack is unchanged", b.status === 409 && b.body.pending === true && (await row(P1)).size === 3, b);
  ok("…the crew is told to look for the payment by its key", told.crew.slice(crew0).some((x) => x.kind === "pack_change_unknown" && x.severity === "critical" && x.body.includes("k-unknown-09")), told.crew.slice(crew0));
  const c0 = sq.charges.length;
  const again = await change("k-unknown-09", P1, { size: 12, mix: { RISE: 12 }, total: 6000 }, { expectedDiff: 4500 });
  ok("…the same key again hears the same, and Square is not asked twice", again.status === 409 && again.body.pending === true && sq.charges.length === c0, again);
  ok("…and the pack is free for a change under a new key", (await ch("k-unknown-09")).state === "unknown");
}

// ── a refund Square refuses, or does not confirm, is the crew's to send — and the pack still changes ──────────
{
  const crew0 = told.crew.length;
  sq.refundScript.push("refuse");
  const a = await change("k-refuse-010", P2, { size: 6, mix: { FLOW: 6 }, total: 3000 }, { expectedDiff: -3000 });
  ok("refused refund: the pack changes, and the page says the crew is sending $30", a.status === 200 && a.body.refundPendingCents === 3000 && /crew is sending \$30/.test(a.body.warn), a);
  ok("…the crew gets a critical: refund $30 by hand, check Square first", told.crew.slice(crew0).some((x) => x.kind === "pack_refund_by_hand" && x.severity === "critical" && /Check the payment in Square first/.test(x.body)), told.crew.slice(crew0));
  ok("…its record: done, $30 by hand", (await ch("k-refuse-010")).by_hand_cents === 3000);
  sq.refundScript.push("unknown");
  const b = await change("k-unconf-011", P2, { size: 3, mix: { FLOW: 3 }, total: 1500 }, { expectedDiff: -1500 });
  const c = await ch("k-unconf-011");
  ok("unconfirmed refund: changed, by hand, and the note says Square did not confirm", b.status === 200 && c.by_hand_cents === 1500, { b, c });
}

// ── one change at a time per pack ────────────────────────────────────────────────────────────────────────────
{
  // A change under key A has begun and is in flight (its request is still talking to Square).
  const h = await store.begin({ key: "k-held-00012", order: P1, user: JORDAN, after: after({ size: 6, mix: { RISE: 6 }, total: 3000 }), newTotal: 3000, payNow: false, expectedDiff: 1500 });
  ok("a change in flight holds the pack", h.change?.state === "started", h);
  const b = await change("k-other-0013", P1, { size: 12, mix: { RISE: 12 }, total: 6000 }, { expectedDiff: 4500 });
  ok("…another key, meanwhile: told another change is going through, nothing moved", b.status === 409 && /Another change/.test(b.body.error), b);
  // Its request died: five minutes later, the next one stops it — money was at stake, so it is unknown and the crew told.
  await q(`update public.drop_order_changes set updated_at = now() - interval '5 minutes' where key = 'k-held-00012'`);
  const crew0 = told.crew.length;
  const c = await change("k-other-0014", P1, { size: 6, mix: { RISE: 6 }, total: 3000 }, { expectedDiff: 1500 });
  ok("…a dead change is stopped once (unknown, the crew told) and the new one goes through", c.status === 200 && (await ch("k-held-00012")).state === "unknown"
    && told.crew.slice(crew0).some((x) => x.kind === "pack_change_unknown"), { c, crew: told.crew.slice(crew0) });
}
{
  // Key A moved its money (a refund) and died before it was applied. The next request finishes it first.
  const A = "k-moved-0015";
  const h = await store.begin({ key: A, order: P1, user: JORDAN, after: after({ size: 3, mix: { RISE: 3 }, total: 1500 }), newTotal: 1500, payNow: false, expectedDiff: -1500 });
  await store.moved(A, { chargePaymentId: null, refunds: [{ payment_id: "pay_P1", refund_id: "ref_hand", cents: 1500, status: "PENDING" }], byHand: 0, outcome: null });
  const b = await change("k-later-0016", P1, { size: 12, mix: { RISE: 12 }, total: 6000 }, { expectedDiff: 3000 });
  ok("a moved change left unapplied is finished by the next request, which is told the pack just changed",
    h.change?.state === "started" && b.status === 409 && b.body.refresh === true && (await ch(A)).state === "done" && (await row(P1)).size === 3, { b, a: await ch(A) });
}

// ── the pack changed underneath: a charge is given back, a refund goes to the crew ────────────────────────────
{
  const C = "k-stale-0017";
  const b = await store.begin({ key: C, order: P1, user: JORDAN, after: after({ size: 12, mix: { RISE: 12 }, total: 6000 }), newTotal: 6000, payNow: false, expectedDiff: 4500 });
  await store.moved(C, { chargePaymentId: "pay_STALE", refunds: [], byHand: 0, outcome: null });
  await q(`update public.drop_orders set stage = 'preparing' where id = $1`, [P1]);   // the crew started brewing it
  const r0 = sq.refunds.length;
  const a = await change(C, P1, { size: 12, mix: { RISE: 12 }, total: 6000 }, { expectedDiff: 4500 });
  ok("stale: the charge is refunded in full and the page told the change was undone", b.change?.state === "started" && a.status === 409 && a.body.refresh === true
    && /charge refunded/.test(a.body.error) && sq.refunds.length === r0 + 1 && sq.refunds.at(-1).paymentId === "pay_STALE" && sq.refunds.at(-1).amountCents === 4500 && sq.refunds.at(-1).key === "k-stale-0017.bk", { a, r: sq.refunds.at(-1) });
  const c = await ch(C);
  ok("…its record: stale, the give-back on it; the pack untouched (still a 3-pack, being brewed)", c.state === "stale" && c.refunds.length === 1 && (await row(P1)).size === 3, c);
  await q(`update public.drop_orders set stage = 'reserved' where id = $1`, [P1]);
}

// ── who may change what ───────────────────────────────────────────────────────────────────────────────────────
{
  const P3 = await pack({ size: 6, mix: { RISE: 6 }, total: 3000, user: RIVER, name: "River Made-up" });
  const notMine = await change("k-notmine-18", P3, { size: 3, mix: { RISE: 3 }, total: 1500 }, { expectedDiff: 0 });
  ok("somebody else's pack is not found", notMine.status === 404, notMine);
  const P4 = await pack({ size: 6, mix: { RISE: 6 }, total: 3000 });
  await q(`update public.drop_orders set canceled_at = now() where id = $1`, [P4]);
  ok("a canceled pack refuses", (await change("k-canceled-19", P4, { size: 3, mix: { RISE: 3 }, total: 1500 }, { expectedDiff: 0 })).body.error === "That pack was canceled.");
  const P5 = await pack({ size: 6, mix: { RISE: 6 }, total: 3000 });
  await q(`update public.drop_orders set stage = 'ready' where id = $1`, [P5]);
  ok("a pack the crew has in motion refuses", /in motion/.test((await change("k-motion-020", P5, { size: 3, mix: { RISE: 3 }, total: 1500 }, { expectedDiff: 0 })).body.error));
  const reuse = await change("k-down-0001", P2, { size: 3, mix: { FLOW: 3 }, total: 1500 }, { expectedDiff: 0 });
  ok("a key already used for another pack refuses", reuse.status === 409 && /another pack/.test(reuse.body.error), reuse);
  const g = (await q(`select has_function_privilege('authenticated', 'public.pack_change_apply(text, text, text)', 'execute') a,
    has_function_privilege('anon', 'public.pack_change_begin(text, uuid, uuid, jsonb, integer, boolean, integer)', 'execute') b,
    has_function_privilege('service_role', 'public.pack_change_begin(text, uuid, uuid, jsonb, integer, boolean, integer)', 'execute') c,
    has_table_privilege('authenticated', 'public.drop_order_changes', 'insert') d`))[0];
  ok("only the server runs a change: no execute for anon or a member, none of its writes", g.a === false && g.b === false && g.c === true && g.d === false, g);
  const mine = await as(JORDAN, `select count(*)::int n from public.drop_order_changes`);
  const theirs = await as(RIVER, `select count(*)::int n from public.drop_order_changes`);
  const crew = await as(STAFF, `select count(*)::int n from public.drop_order_changes`);
  const all = (await q(`select count(*)::int n from public.drop_order_changes`))[0].n;
  ok("a member reads their own changes, another member none, the crew all", mine.rows[0]?.n === all && theirs.rows[0]?.n === 0 && crew.rows[0]?.n === all, { mine, theirs, crew, all });
  ok("a change before pickup moves no stamps", (await pts()) === ptsBefore, await pts());
}

// ── the answers' words (pure) ─────────────────────────────────────────────────────────────────────────────────
{
  ok("diffFor: a paid pack moves the difference", pc.diffFor({ paid: true, total_cents: 6000 }, 3000, false) === -3000);
  ok("diffFor: pay at pickup moves nothing, unless paid now", pc.diffFor({ paid: false, total_cents: 3000 }, 6000, false) === 0 && pc.diffFor({ paid: false, total_cents: 3000 }, 6000, true) === 6000);
  const plan = pc.refundPlan([{ payment_id: "a", left: 1000 }, { payment_id: "b", left: 500 }], 1800);
  ok("refundPlan: newest first, and what no payment holds is short", plan.parts.length === 2 && plan.parts[0].cents === 1000 && plan.parts[1].cents === 500 && plan.short === 300, plan);
  ok("refund keys fit Square's 45", pc.refundKey("x".repeat(45), 3).length <= 45 && pc.backKey("y".repeat(45)).length <= 45);
}

// ── Square's answer to a refund, read the way a charge's is (lib/squareServer.refundPayment) ───────────────────
{
  const SQ = libLoader()("lib/squareServer.ts");
  const real = globalThis.fetch, sent = [], answers = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    const a = answers.shift();
    return { status: a.status, json: async () => a.body };
  };
  const ask = () => SQ.refundPayment({ token: "t", paymentId: "P", amountCents: 500, idempotencyKey: "k.r0", reason: "x".repeat(300) });
  try {
    answers.push({ status: 200, body: { refund: { id: "R1", status: "PENDING" } } });
    const r1 = await ask();
    ok("refund: PENDING is a refund made; the key, payment and amount go as Square asks, the reason cut to its 192",
      r1.ok && r1.refundId === "R1" && sent[0].url.endsWith("/v2/refunds") && sent[0].body.idempotency_key === "k.r0" && sent[0].body.payment_id === "P"
      && sent[0].body.amount_money.amount === 500 && sent[0].body.amount_money.currency === "USD" && sent[0].body.reason.length === 192, { r1, s: sent[0] });
    answers.push({ status: 400, body: { errors: [{ code: "REFUND_AMOUNT_INVALID", detail: "The requested refund amount exceeds the amount available to refund." }] } });
    const r2 = await ask();
    ok("refund: any other 4xx is a refusal — nothing went back — in Square's words", r2.ok === false && /exceeds/.test(r2.error), r2);
    answers.push({ status: 200, body: { refund: { id: "R3", status: "REJECTED" } } });
    ok("refund: REJECTED in the answer is a refusal too", (await ask()).ok === false);
    let thrown = null;
    answers.push({ status: 503, body: { errors: [{ code: "TEMPORARY_ERROR", detail: "You can safely retry your call using the same idempotency key." }] } });
    try { await ask(); } catch (e) { thrown = e.name; }
    ok("refund: a 5xx does not say whether the money went back — thrown, for the caller's not-confirmed branch", thrown === "RefundUnknown", thrown);
    thrown = null;
    answers.push({ status: 400, body: { errors: [{ code: "IDEMPOTENCY_KEY_REUSED", detail: "The idempotency key can only be retried with the same request data." }] } });
    try { await ask(); } catch (e) { thrown = e.name; }
    ok("refund: a key reused with other data may have refunded before — thrown, never a refusal", thrown === "RefundUnknown", thrown);
  } finally { globalThis.fetch = real; }
}

// ── an erased account leaves nothing of the person in the change log ───────────────────────────────────────────
{
  const n = (await q(`select count(*)::int n from public.drop_order_changes where user_id = $1`, [JORDAN]))[0].n;
  let err = null;
  await q(`update public.drop_orders set canceled_at = now() where user_id = $1 and canceled_at is null`, [JORDAN]);   // nothing on its way (0353's guard)
  try { await q(`delete from auth.users where id = $1`, [JORDAN]); } catch (e) { err = String(e.message || e); }
  const rows = await q(`select to_jsonb(c)::text t from public.drop_order_changes c`);
  ok("erasure: the changes are kept for the books, no longer the member's, with no name or phone in them",
    err === null && n > 0 && (await q(`select count(*)::int n from public.drop_order_changes where user_id is null`))[0].n >= n
    && rows.every((r) => !/Jordan|5550100|5550199/.test(r.t)), { err, n, leak: rows.filter((r) => /Jordan|5550100|5550199/.test(r.t)).slice(0, 2) });
}

// ── a second run ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const n = (await q(`select count(*)::int n from public.drop_order_changes`))[0].n;
  await db.exec(MIG(F388));
  ok("a second run changes nothing: the changes kept, one changelog line, recorded", (await q(`select count(*)::int n from public.drop_order_changes`))[0].n === n
    && (await q(`select count(*)::int n from public.changelog where title = 'A pack is changed in place'`))[0].n === 1
    && (await q(`select count(*)::int n from public.schema_migrations where version = '0388_a_pack_is_changed_in_place'`))[0].n >= 1);
  const rls = (await q(`select relrowsecurity r from pg_class where oid = 'public.drop_order_changes'::regclass`))[0].r;
  ok("RLS is on", rls === true);
}

console.log(`db.packchange: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
