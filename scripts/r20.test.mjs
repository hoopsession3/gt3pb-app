// R20 — THE 10/10 AUDIT, ROUND TWENTY, RUN (2026-10-17; Ryan: "Keep working to improve to a 10").
//
//   · an event's takings are asked of the database (performance F6; 0426, applied 2026-10-18 — the screen's own reading
//     of the rows, kept until it was, is retired in R21);
//   · what the phone keeps of a ticket is the board's own fields — never the card, the payment, the share key
//     (lib/passBoard forTheSnapshot; security F5);
//   · the error intake says a report it lost (lib/errorIntake; operations F2).
//
// The modules are compiled from their TypeScript and run as they are; the database is a recorder. Nothing here talks to
// Supabase; every row is made up.
import { routeLoader } from "./fixtures/moneyWorld.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };

// ── lib/eventTotals: the instrument's three numbers ──────────────────────────────────────────────────────────────────
{
  const ET = routeLoader()("lib/eventTotals.ts");
  const orders = [
    { total_cents: 900, paid: true, payment_id: "sq-card-1", created_at: "2026-10-17T18:10:00Z" },
    { total_cents: 700, paid: true, payment_id: null, created_at: "2026-10-17T18:20:00Z" },
    { total_cents: 900, paid: false, payment_id: null, created_at: "2026-10-17T18:50:00Z" },
  ];
  const sales = [
    { amount_cents: 900, square_payment_id: "sq-card-1", created_at: "2026-10-17T18:10:05Z" },   // the card order, mirrored
    { amount_cents: 1200, square_payment_id: "sq-walkup", created_at: "2026-10-17T18:05:00Z" },
    { amount_cents: 500, square_payment_id: null, created_at: "2026-10-17T18:30:00Z" },
  ];
  const t = ET.totalsFromRows(orders, sales);
  ok("totals: paid orders and Square's own sales — the card order counted once", t.cents === 3300 && t.orders === 5 && t.firstAt === "2026-10-17T18:05:00Z", t);
  ok("totals: nothing sold is nothing", JSON.stringify(ET.totalsFromRows([], [])) === JSON.stringify({ cents: 0, orders: 0, firstAt: null }));

  const asked = [];
  const db = (rpc, rows = { orders, sales }, rowsError = null) => ({
    rpc: async (fn, a) => { asked.push(`rpc:${fn}:${a.p_event}`); return rpc; },
    from: (table) => {
      asked.push(`read:${table}`);
      const chain = { select: () => chain, eq: () => Promise.resolve(rowsError ? { data: null, error: rowsError } : { data: table === "orders" ? rows.orders : rows.sales, error: null }) };
      return chain;
    },
  });
  asked.length = 0;
  const fromDb = await ET.eventTotals(db({ data: { cents: 3300, orders: 5, first_at: "2026-10-17T18:05:00+00:00" }, error: null }), "ev-1");
  ok("totals: with 0426 the database answers — three numbers, no rows read", fromDb?.cents === 3300 && fromDb?.orders === 5 && fromDb?.firstAt === "2026-10-17T18:05:00+00:00"
    && JSON.stringify(asked) === JSON.stringify(["rpc:event_totals:ev-1"]), { fromDb, asked });
  asked.length = 0;
  const down = await ET.eventTotals(db({ data: null, error: { code: "", message: "Failed to fetch" } }), "ev-1");
  ok("totals: a failure is no answer (null — the screen keeps its numbers), and asks nothing more", down === null && JSON.stringify(asked) === JSON.stringify(["rpc:event_totals:ev-1"]), { down, asked });
  asked.length = 0;
  const gone = await ET.eventTotals(db({ data: null, error: { code: "PGRST202", message: "Could not find the function public.event_totals(p_event) in the schema cache" } }), "ev-1");
  ok("totals: with 0426 applied the rows are never read here (R21) — a function the database doesn't find is no answer, not a reason to read every order",
    gone === null && JSON.stringify(asked) === JSON.stringify(["rpc:event_totals:ev-1"]), { gone, asked });
}

// ── lib/passBoard forTheSnapshot: what the phone keeps of a ticket ───────────────────────────────────────────────────
{
  const PB = routeLoader({ "./supabase": { supabase: null } })("lib/passBoard.ts");
  const row = { id: "o-1", ticket: "A12", customer: "Sam", items: ["rise"], lines: [{ name: "Rise" }], status: "ready", total_cents: 900, paid: true, user_id: "u-1",
    created_at: "2026-10-17T18:10:00Z", payment_id: "sq-pay-secret", card_brand: "VISA", card_last4: "4242", share: "share-key-secret", benefit_code: "FREECUP" };
  const [kept] = PB.forTheSnapshot([row]);
  ok("snapshot: the card, Square's payment id, the share key and the code are not kept on the phone",
    ["payment_id", "card_brand", "card_last4", "share", "benefit_code"].every((k) => !(k in kept)), Object.keys(kept));
  ok("snapshot: …the board's own fields are — the ticket, the name, the lines, the status, who to tell",
    kept.id === "o-1" && kept.ticket === "A12" && kept.customer === "Sam" && kept.status === "ready" && kept.user_id === "u-1" && kept.lines.length === 1, kept);
  ok("snapshot: the rows on the board are left whole (only the copy kept is trimmed)", row.payment_id === "sq-pay-secret" && row.card_last4 === "4242");
}

// ── lib/errorIntake: a report it lost is said ────────────────────────────────────────────────────────────────────────
{
  const warned = [];
  const keepWarn = console.warn;
  console.warn = (m) => warned.push(String(m));
  try {
    const answers = { bump: [{ data: false, error: null }, { data: false, error: null }], fits: { data: true, error: null } };
    const admin = {
      rpc: async (fn) => (fn === "bump_client_error" ? answers.bump.shift() ?? { data: false, error: null } : answers.fits),
      from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "42703", message: "column \"skew\" of relation \"client_errors\" does not exist" } }) }) }) }),
    };
    const EI = routeLoader({ "./supabaseAdmin": { supabaseAdmin: null }, "./serverAlerts": { raiseAlert: async () => {}, raiseAlertOnce: async () => true } })("lib/errorIntake.ts");
    const deps = (a) => ({ admin: a, raiseAlert: async () => {}, raiseAlertOnce: async () => true });
    const filed = await EI.fileError({ message: "TypeError: made up", stack: "", url: "https://app.example.test/menu", ua: "test", browser: true, ip: "203.0.113.9" }, deps(admin));
    ok("intake: an insert refused for a reason that isn't a race, with nothing there to count, is said in the log", filed === false && warned.some((w) => /couldn't file or count a client error — column "skew"/.test(w)), warned);
    warned.length = 0;
    const throwing = { rpc: async () => { throw new Error("connection reset"); }, from: () => { throw new Error("connection reset"); } };
    const threw = await EI.fileError({ message: "TypeError: made up", stack: "", url: "", ua: "test" }, deps(throwing));
    ok("intake: a report the intake threw on is said too — and it still never throws", threw === false && warned.some((w) => /the intake threw filing a report — connection reset/.test(w)), warned);
  } finally { console.warn = keepWarn; }
}

// ── lib/geocode: a lookup that didn't answer is not a bad address (the R20 review) ─────────────────────────────────────
{
  const G = routeLoader()("lib/geocode.ts");
  const keep = globalThis.fetch;
  const answer = (fn) => { globalThis.fetch = fn; };
  try {
    answer(async () => new Response(JSON.stringify([{ lat: "34.85", lon: "-82.39", display_name: "Made-up Street, Greenville" }]), { status: 200 }));
    const hit = await G.lookUpAddress("1 Made-up Street, Greenville SC");
    ok("geocode: a place found is its spot", hit.hit?.lat === 34.85 && hit.hit?.lng === -82.39 && /Greenville/.test(hit.hit?.label), hit);
    answer(async () => new Response("[]", { status: 200 }));
    const none = await G.lookUpAddress("nowhere at all");
    answer(async () => { throw new TypeError("Network request timed out — no answer in 10 s"); });
    const lost = await G.lookUpAddress("1 Made-up Street");
    answer(async () => new Response("busy", { status: 503 }));
    const busy = await G.lookUpAddress("1 Made-up Street");
    ok("geocode (review): no such place is not-found; no answer, a refusal or a timeout is unreachable — never a bad address for a dropped signal",
      none.miss === "not-found" && lost.miss === "unreachable" && busy.miss === "unreachable", { none, lost, busy });
    ok("geocode: the old door still answers the spot or null, either way", (await G.geocode("1 Made-up Street")) === null);
  } finally { globalThis.fetch = keep; }
}

console.log(`R20 — ROUND TWENTY: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
