// R7 OF THE CUSTOMER RE-AUDIT — THE TRUTH, RUN IN POSTGRES (2026-10-15; Ryan: "Keep working to improve to a 10").
//
//   0412  go offline stops every order — a city's switch holds it closed, and never keeps it open
//   0413  a shared link shows the order — and only the phone that placed it changes it
//   0414  founding is one switch — the card and the price agree
//
// The findings, as sentences: once a city's switch had been turned on, Go offline cleared the truck and the city kept
// taking cards with no stop to pour at; an order's Share link sent its ticket — the key that cancels it, tells the
// truck "I'm outside" and reads the card's last four; and the owner's Founding switch changed the card and not the
// price. What is run here is the whole schema up to 0411, then 0412, 0413 and 0414 — twice — as a guest, a member, the
// crew and the owner would call them.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sqlOf = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
const SQL = [sqlOf("0412_go_offline_stops_every_order.sql"), sqlOf("0413_a_shared_link_shows_the_order.sql")];
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

const T1 = "00000000-0000-0000-0000-000000000001";

const t0 = Date.now();
const db = await fullSchema({ before: "0412" });
console.log(`the schema to 0411 loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
const root = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
const as = async (uid, sql, params) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; }
  catch (e) { return { rows: [], error: String(e.message || e), code: e.code ?? null }; }
  finally { await root(); }
};
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
const liveIn = async (market) => (await q1(`select is_live from public.market_live where market = $1`, [market]))?.is_live;
await q(`insert into public.live_status (id, is_live) values (1, true) on conflict (id) do update set is_live = true`);
await q(`update public.markets set is_live = true, opens_on = null where slug = 'greenville'`);

// ── before 0412: the bug, reproduced ─────────────────────────────────────────────────────────────────────────
await q(`update public.live_status set is_live = false where id = 1`);
ok("before 0412: a city switched on stays live after Go offline — the bug, reproduced", (await liveIn("greenville")) === true);

for (const sql of SQL) await db.exec(sql);
for (const sql of SQL) await db.exec(sql);   // a second run changes nothing
// 0412 and 0413 load on the schema to 0411, and load again — a throw above fails this file; a milestone, not counted as a check (R14, F25).

// ── 0412 · go offline stops every order ──────────────────────────────────────────────────────────────────────
ok("Go offline: the city switched on is not taking orders", (await liveIn("greenville")) === false);
await q(`update public.live_status set is_live = true where id = 1`);
ok("Go live: it is again — on, or following, a city takes orders while the truck is live", (await liveIn("greenville")) === true);
await q(`update public.markets set is_live = null where slug = 'greenville'`);
ok("…a city that follows the truck takes orders while it is live", (await liveIn("greenville")) === true);
await q(`update public.markets set is_live = false where slug = 'greenville'`);
ok("a city held closed takes none, whatever the truck does", (await liveIn("greenville")) === false);
const heldIn = async (market) => (await q1(`select held_closed from public.market_live where market = $1`, [market]))?.held_closed;
ok("…and says it is held, so a scheduled stop's own windows close too (lib/orderingRead)", (await heldIn("greenville")) === true);
await q(`update public.markets set is_live = null where slug = 'greenville'`);
ok("a city that follows the truck is not held", (await heldIn("greenville")) === false);
await q(`update public.markets set is_live = true where slug = 'greenville'`);
ok("…nor one an owner left on", (await heldIn("greenville")) === false);
await q(`update public.markets set is_live = null where slug = 'greenville'`);
await q(`update public.markets set is_live = null, opens_on = current_date + 10 where slug = 'atlanta'`);
ok("a city before its opening day takes none, truck live or not", (await liveIn("atlanta")) === false);
ok("the view is still the storefront's to read, signed out", (await as(null, `select count(*)::int n from public.market_live`)).rows[0]?.n >= 2);
ok("its columns are 0285's, in order, and held_closed after them", (await q(`select attname from pg_attribute where attrelid = 'public.market_live'::regclass and attnum > 0 order by attnum`))
  .map((r) => r.attname).join() === "market,is_live,preorder_lead_h,pay_at_pickup,opens_on,pre_launch,held_closed");

// The readiness board's storefront check asks what a launch needs, not whether the truck is live this hour.
const storefront = async (market) => q1(`select status, detail from public.v_market_readiness where market = $1 and check_name = 'Storefront switched on'`, [market]);
await q(`update public.live_status set is_live = false where id = 1`);
ok("readiness: a city that follows the truck is ready for launch with the truck offline", ((r) => r?.status === "ready" && /whenever the truck is live/.test(r.detail))(await storefront("greenville")), await storefront("greenville"));
await q(`update public.markets set is_live = false where slug = 'greenville'`);
ok("…held closed, it blocks, and says where it is held", ((r) => r?.status === "blocked" && /Held closed in Settings/.test(r.detail))(await storefront("greenville")), await storefront("greenville"));
await q(`update public.markets set is_live = null where slug = 'greenville'`);
ok("…before its opening day, it blocks with the day", ((r) => r?.status === "blocked" && /held until/.test(r.detail))(await storefront("atlanta")), await storefront("atlanta"));
ok("…and the board is still an invoker view", (await q1(`select coalesce((select option_value from pg_options_to_table(reloptions) where option_name = 'security_invoker'), 'off') v
  from pg_class where oid = 'public.v_market_readiness'::regclass`)).v === "on");
await q(`update public.live_status set is_live = true where id = 1`);

// ── 0413 · a shared link shows the order ─────────────────────────────────────────────────────────────────────
const WX = (await q1(`insert into public.stops (name, status, starts_at, ends_at, address)
  values ('WineXpress', 'upcoming', now() + interval '1 hour', now() + interval '4 hours', '202 Scuffletown Rd') returning id`)).id;
const o = await q1(`insert into public.orders (items, total_cents, tip_cents, status, customer, tenant_id, stop_id, paid, payment_id, card_brand, card_last4, lines)
  values ('{flow,flow}', 2200, 330, 'new', 'Ana Ruiz', $1, $2, true, 'sq-413', 'Visa', '4242',
          '[{"slug":"flow","name":"FLOW","qty":2,"unit_cents":1100}]'::jsonb) returning id, ticket, share`, [T1, WX]);
ok("every order has a share key, and it is not its ticket", !!o.share && o.share !== o.ticket
  && (await q1(`select count(*)::int n from public.orders where share is null`)).n === 0);
const tv = (await as(null, `select public.order_ticket($1) v`, [o.ticket])).rows[0]?.v;
ok("the ticket's own view carries the share key — what its Share link sends", tv?.share === o.share && tv?.card === "Visa ··4242", tv);
const sv = (await as(null, `select public.order_shared($1) v`, [o.share])).rows[0]?.v;
ok("a shared link shows the order: its number, where it is, its drinks, the first name and the stop",
  sv?.no === `#${o.id.slice(0, 4).toUpperCase()}` && sv.status === "new" && sv.for === "Ana" && sv.stop?.name === "WineXpress"
    && sv.lines?.[0]?.name === "FLOW" && sv.lines[0].qty === 2 && sv.paid === true && sv.due_cents === 0, sv);
ok("…and nothing about the money or the card: no prices, no tip, no card, no refunds, no ticket",
  !("card" in sv) && !("tip_cents" in sv) && !("total_cents" in sv) && !("refunded_cents" in sv) && !("ticket" in sv) && !("share" in sv)
    && !("unit_cents" in sv.lines[0]) && !JSON.stringify(sv).includes("4242") && !JSON.stringify(sv).includes(o.ticket), sv);
const unpaid = await q1(`insert into public.orders (items, total_cents, status, customer, tenant_id, stop_id) values ('{rise}', 600, 'new', 'Bo Lee', $1, $2) returning share`, [T1, WX]);
ok("an unpaid order's shared link says what is due at the window", (await as(null, `select public.order_shared($1) v`, [unpaid.share])).rows[0]?.v?.due_cents === 600);
const nope = await as(null, `select public.order_shared(gen_random_uuid()) v`);
ok("an unknown link is refused in words, as a 4xx", /That link isn't one of ours/.test(nope.error ?? "") && nope.code === "PT404", nope);
ok("the share key cancels nothing — cancel_by_ticket does not know it", /That ticket isn't one of ours/.test((await as(null, `select public.cancel_by_ticket($1) r`, [o.share])).error ?? "")
  && (await q1(`select status from public.orders where id = $1`, [o.id])).status === "new");
ok("…nor tells the truck anything", /That ticket isn't one of ours/.test((await as(null, `select public.ticket_eta($1, 'outside') r`, [o.share])).error ?? "")
  && (await q1(`select eta_status from public.orders where id = $1`, [o.id])).eta_status === null);
ok("the ticket still cancels its own order — links shared before 0413 keep working", (await as(null, `select public.cancel_by_ticket($1) r`, [o.ticket])).rows[0]?.r?.outcome === "canceled");
ok("a shared link to a canceled order says so, and nothing is due", ((v) => v?.status === "void" && v.due_cents === 0)((await as(null, `select public.order_shared($1) v`, [o.share])).rows[0]?.v));

// ── 0414 · founding is one switch ────────────────────────────────────────────────────────────────────────────
const OWN = "0c414000-0000-4000-8000-0000000000a1";   // the owner
const KIT = "0c414000-0000-4000-8000-0000000000a2";   // crew
const HAL = "0c414000-0000-4000-8000-0000000000b1";   // a member the owner makes founding — before 0414, the bug
const FAY = "0c414000-0000-4000-8000-0000000000b2";   // the card said founding, the price did not
const GUS = "0c414000-0000-4000-8000-0000000000b3";   // the price said founding, the card did not — the owner took it off
const IVY = "0c414000-0000-4000-8000-0000000000b4";   // a member, founding nowhere
for (const [id, role, name] of [[OWN, "owner", "Ola Grant"], [KIT, "server", "Kit Rowe"], [HAL, "member", "Hal Moss"],
  [FAY, "member", "Fay Diaz"], [GUS, "member", "Gus Park"], [IVY, "member", "Ivy Chen"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name.split(" ")[0].toLowerCase()}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3, display_name = $4 where id = $1`, [id, role, T1, name]);
}
await q(`update public.customers set tier = 'member' where user_id = any($1)`, [[HAL, FAY, GUS, IVY]]);
await q(`update public.profiles set founding_member = true where id = $1`, [FAY]);
await q(`update public.customers set tier = 'founding' where user_id = $1`, [GUS]);
const card = async (id) => q1(`select c.tier, coalesce(p.founding_member, false) f from public.customers c
  join public.profiles p on p.id = c.user_id where c.user_id = $1`, [id]);
const setFounding = (who, member, on) => as(who, `select public.admin_set_member($1, null, null, $2)`, [member, on]);
const lines = async (id, summary) => (await q1(`select count(*)::int n from public.admin_audit where row_pk = $1 and summary like $2`, [id, summary])).n;

const bug = await setFounding(OWN, HAL, true);
ok("before 0414: the owner's Founding switch turns the card on and leaves the price — the bug, reproduced",
  !bug.error && ((c) => c.f === true && c.tier === "member")(await card(HAL)), bug);

const logged = async (id) => (await q1(`select count(*)::int n from public.admin_audit where row_pk = $1`, [id])).n;
const loggedBefore = Object.fromEntries(await Promise.all([HAL, FAY, GUS, IVY].map(async (id) => [id, await logged(id)])));
const SQL14 = sqlOf("0414_founding_is_one_switch.sql");
await db.exec(SQL14);
await db.exec(SQL14);   // a second run changes nothing
// 0414 loads on 0413, and loads again — a throw above fails this file; a milestone, not counted as a check (R14, F25).
ok("where the card and the price disagreed they agree now — the card's way, the owner's last word",
  ((h, f, g, i) => h.tier === "founding" && h.f && f.tier === "founding" && f.f && g.tier === "member" && !g.f && i.tier === "member" && !i.f)(
    await card(HAL), await card(FAY), await card(GUS), await card(IVY)), [await card(HAL), await card(FAY), await card(GUS), await card(IVY)]);
ok("no member's card and price disagree", (await q1(`select count(*)::int n from public.customers c join public.profiles p on p.id = c.user_id
  where coalesce(p.founding_member, false) <> (c.tier = 'founding')`)).n === 0);
const added = async (id) => (await logged(id)) - loggedBefore[id];
ok("each one made one is a single line in the change log, however often 0414 runs — the price's, by its own trigger",
  (await added(FAY)) === 1 && (await lines(FAY, "tier: member → founding")) === 1
    && (await added(HAL)) === 1 && (await lines(HAL, "tier: member → founding")) === 1
    && (await added(GUS)) === 1 && (await lines(GUS, "tier: founding → member")) === 1
    && (await added(IVY)) === 0, { FAY: await added(FAY), HAL: await added(HAL), GUS: await added(GUS), IVY: await added(IVY) });

const on = await setFounding(OWN, IVY, true);
ok("the owner's switch on: the founding card and the founding price, together", !on.error && ((c) => c.f && c.tier === "founding")(await card(IVY)), on);
const off = await setFounding(OWN, FAY, false);
ok("…and off: both go, and the member's tier is left — never guest", !off.error && ((c) => !c.f && c.tier === "member")(await card(FAY)), off);
ok("…each a line about the switch and one about the price, with who", (await q1(`select count(*)::int n from public.admin_audit
  where row_pk = $1 and actor = $2 and (summary = 'Founding member: on → off' or summary = 'tier: founding → member')`, [FAY, OWN])).n === 2);
await q(`update public.profiles set credit_cents = 700 where id = $1`, [HAL]);
await as(OWN, `select public.admin_set_member($1, 40, null, null)`, [HAL]);
ok("points alone leave the tier where it is — and the credit, which the editors no longer send unchanged",
  ((c) => c.f && c.tier === "founding")(await card(HAL)) && (await q1(`select credit_cents c from public.profiles where id = $1`, [HAL])).c === 700);
const crew = await setFounding(KIT, IVY, false);
ok("the crew can't make or unmake a founding member here — the owner's edit only", /not authorized/.test(crew.error ?? "")
  && ((c) => c.f && c.tier === "founding")(await card(IVY)), crew);
ok("admin_set_member is nobody's signed out", (await q1(`select has_function_privilege('anon', 'public.admin_set_member(uuid, int, int, boolean)', 'execute') a,
  has_function_privilege('authenticated', 'public.admin_set_member(uuid, int, int, boolean)', 'execute') b`)).a === false);

console.log(`R7 TRUTH (0412 · 0413 · 0414, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
