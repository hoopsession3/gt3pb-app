// R29 — A DOOR STAYS OPEN FOR THE CUSTOMER WHILE A SCRIPT KNOCKS (2026-10-18 — the 10/10 audit, API F1; Ryan, 2026-10-17:
// "Keep working to improve to a 10").
//
// Every public door that rings the crew or reaches Square had a ceiling for everyone together that a handful of addresses
// could spend: two addresses' booking requests turned every catering lead away for the hour, ten kept card checkout shut.
//   1 · the card doors (lib/cardGuard): the ceiling is asked of cards Square REFUSED — twenty in a minute pause card
//       payments for the rest of it, asked before Square and never counted (rate_limit_peek, 0434) — and a try let
//       through still counts against a ceiling no rush reaches; lib/squareServer counts each refusal of a card.
//   2 · the two checkouts ask everyone's ceiling only of a try that would reach Square: after the menu, the stop, the cart
//       and the price have said yes.
//   3 · /api/book: past the hour's thirty a lead is kept, marked quiet, and the crew told once that a burst came.
// (0434 itself is run in db.r29.test.mjs; the push function's skip of a quiet lead in push.function.test.mjs.)
import { readFileSync } from "node:fs";
import { routeLoader, NextResponseShim } from "./fixtures/moneyWorld.mjs";
import { libLoader } from "./fixtures/chargeonce.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

// A store that keeps counts as rate_limit_hit does (true is under the cap; a try over it is refused and not counted —
// 0419) and answers rate_limit_peek from the same counts without counting. One window: each test runs inside one.
const store = ({ peekMissing = false } = {}) => {
  const counts = {}, asked = [];
  return {
    counts, asked,
    rpc: async (fn, a) => {
      asked.push([fn, a.p_bucket]);
      if (fn === "rate_limit_hit") { const n = counts[a.p_bucket] ?? 0; if (n >= a.p_max) return { data: false, error: null }; counts[a.p_bucket] = n + 1; return { data: true, error: null }; }
      if (fn === "rate_limit_peek") return peekMissing ? { data: null, error: { code: "PGRST202", message: "Could not find the function public.rate_limit_peek" } } : { data: (counts[a.p_bucket] ?? 0) < a.p_max, error: null };
      return { data: null, error: { message: `no such function ${fn}` } };
    },
  };
};

// ── 1 · the card doors ─────────────────────────────────────────────────────────────────────────────────────────────
const load = libLoader();
const CG = load("lib/cardGuard.ts");
const SQ = load("lib/squareServer.ts");
ok("compiled: lib/cardGuard, lib/squareServer", typeof CG.cardTryRefusal === "function" && typeof CG.cardRefused === "function" && typeof SQ.isCardRefusal === "function");
{
  const s = store();
  for (let i = 0; i < 19; i++) await CG.cardRefused(s);
  ok("refused cards: nineteen in a minute pause nothing", (await CG.cardsPaused(s)) === false && s.counts["card:refused"] === 19);
  await CG.cardRefused(s);
  ok("…the twentieth pauses card payments for the rest of the minute", (await CG.cardsPaused(s)) === true && CG.CARD_TRIES.refusedPerMinute === 20);
  await CG.cardRefused(s); await CG.cardRefused(s);
  ok("…and a refusal past the cap is never counted past it (the store's own rule)", s.counts["card:refused"] === 20);
  s.asked.length = 0;
  const words = await CG.cardTryRefusal(s, { userId: "u-1", ip: "1.2.3.4" });
  ok("paused: a card try is told so — nothing charged — before any count is asked (the person's, the address's, everyone's)",
    words === CG.CARDS_PAUSED_WORDS && /paused for a minute/.test(words) && /Nothing was charged/.test(words)
    && s.asked.every(([fn]) => fn === "rate_limit_peek"), { words, asked: s.asked });
}
{
  const s = store();
  const none = await CG.cardTryRefusal(s, { userId: "u-1", ip: "1.2.3.4" });
  ok("not paused: the person's, then the address's, then everyone's — and a try let through counts on each",
    none === null && JSON.stringify(s.asked.filter(([fn]) => fn === "rate_limit_hit").map(([, b]) => b)) === JSON.stringify(["card:u:u-1", "card:1.2.3.4", "card:all"])
    && s.counts["card:all"] === 1, s.asked);
  ok("…everyone's ceiling is two hundred and forty a minute — no rush at a truck reaches it; the person's and the address's as they were",
    CG.cardLimits({ ip: "x" }).at(-1).max === 240 && CG.cardLimits({ ip: "x" }).at(-1).windowMs === 60_000
    && CG.cardLimits({ userId: "u", ip: "x" })[0].max === 6 && CG.cardLimits({ ip: "x" })[0].max === 10);
  for (let i = 0; i < 6; i++) await CG.cardTryRefusal(s, { userId: "u-2", ip: "5.6.7.8" });
  const own = await CG.cardTryRefusal(s, { userId: "u-2", ip: "5.6.7.8" });
  ok("…the person's own six are still theirs to spend, in the old words", own === CG.CARD_TRIES_WORDS, own);
}
{
  const before = store({ peekMissing: true });
  for (let i = 0; i < 25; i++) await CG.cardRefused(before);
  const broken = { rpc: async () => { throw new Error("socket hang up"); } };
  ok("before 0434 (no rate_limit_peek), or a store that can't answer: nothing pauses — the person's and the address's counts still stand",
    (await CG.cardsPaused(before)) === false && (await CG.cardTryRefusal(before, { ip: "9.9.9.9" })) === null
    && (await CG.cardsPaused(broken)) === false && (await CG.cardTryRefusal(broken, { ip: "9.9.9.9" })) === null);
}
ok("a refusal of the card is counted — its decline, a card entry Square wouldn't take — and Square's own trouble isn't",
  SQ.isCardRefusal(SQ.DECLINE_WORDS) && SQ.isCardRefusal(SQ.CARD_ENTRY_WORDS) && !SQ.isCardRefusal(SQ.SQUARE_DOWN_WORDS)
  && SQ.refusalWords(402, { errors: [{ category: "PAYMENT_METHOD_ERROR", code: "CARD_DECLINED" }] }) === SQ.DECLINE_WORDS);
{
  const sq = code(read("lib/squareServer.ts")), cg = code(read("lib/cardGuard.ts"));
  ok("chargeCard counts each refusal of a card (and only those), in the running app — a test compiling the file alone counts nothing",
    /const words = refusalWords\(res\.status, data\);\s*if \(isCardRefusal\(words\)\) await countCardRefused\(\);\s*return \{ ok: false, error: words \};/.test(sq)
    && /async function countCardRefused\(\): Promise<void> \{\s*if \(typeof process === "undefined" \|\| !process\.env\.NEXT_RUNTIME\) return;/.test(sq)
    && /await cardRefused\(supabaseAdmin\)/.test(sq));
  ok("the pause tells the crew once an hour (raiseAlertOnce, an hour's subject), critical, with where to look",
    /kind: "cards_paused", subjectId: `cards-paused:\$\{now\.toISOString\(\)\.slice\(0, 13\)\}`/.test(cg) && /severity: "critical", category: "money"/.test(cg)
    && /link: "\/crew\?s=money&a=pay"/.test(cg) && /if \(typeof process !== "undefined" && process\.env\.NEXT_RUNTIME\) \{/.test(cg));
  const doors = ["app/api/delivery/checkout/route.ts", "app/api/reserves/pay/route.ts", "app/api/reserve/route.ts", "app/api/reserve/change/route.ts", "app/api/subscriptions/create/route.ts"];
  const off = doors.filter((f) => { const c = code(read(f)); return !/const cardRefusal = [^;]*await cardTryRefusal\(/.test(c) || !/if \(cardRefusal\) return NextResponse\.json\(\{ error: cardRefusal/.test(c) || /cardTryFits/.test(c); });
  ok("every other card door asks cardTryRefusal and answers in its words — the pause's, or too many tries", off.length === 0, off);
}

// ── 2 · the checkouts ask everyone's ceiling of a try that would reach Square ─────────────────────────────────────────
{
  const cup = code(read("app/api/checkout/route.ts")), shop = code(read("app/api/shop/checkout/route.ts"));
  const at = (c, s) => c.indexOf(s);
  ok("cup checkout: the address's own six a minute before the menu is read; the pause and everyone's two hundred and forty after the price is agreed, before the claim and the card",
    /\{ bucket: `checkout:\$\{ip\}`, windowMs: 60_000, max: 6 \},\s*\]\)\)\)/.test(cup) && at(cup, "checkout:${ip}") < at(cup, "readMenuRows(supabaseAdmin, uniq)")
    && at(cup, "if (expected !== null && expected !== due) {") < at(cup, "const paused = await cardsPausedRefusal(supabaseAdmin);")
    && at(cup, "const paused = await cardsPausedRefusal(supabaseAdmin);") < at(cup, '{ bucket: "checkout:global", windowMs: 60_000, max: CARD_TRIES.allPerMinute }')
    && at(cup, '{ bucket: "checkout:global", windowMs: 60_000, max: CARD_TRIES.allPerMinute }') < at(cup, "return reply(await chargeOnce({")
    && (cup.match(/"checkout:global"/g) || []).length === 1);
  ok("shop checkout: the same — the address's six before the cart is read; the pause and everyone's after the cart is priced and agreed, before the claim",
    /\{ bucket: `shop-checkout:\$\{ip\}`, windowMs: 60_000, max: 6 \},\s*\]\)\)\)/.test(shop) && at(shop, "shop-checkout:${ip}") < at(shop, "const rawItems =")
    && at(shop, "if (raised) return NextResponse.json(raised, { status: 409 });") < at(shop, "const paused = await cardsPausedRefusal(supabaseAdmin);")
    && at(shop, '{ bucket: "shop-checkout:global", windowMs: 60_000, max: CARD_TRIES.allPerMinute }') < at(shop, "const held = await claimKey(")
    && (shop.match(/"shop-checkout:global"/g) || []).length === 1);
}

// ── 3 · /api/book: a burst is kept and hushed, never turned away ─────────────────────────────────────────────────────
{
  const rows = [], alerts = [];
  let s = store(), schemaHasQuiet = true;
  const admin = {
    rpc: (fn, a) => s.rpc(fn, a),
    from: (t) => ({
      insert: async (row) => {
        if (t !== "booking_requests") return { error: { message: `unexpected table ${t}` } };
        if ("quiet" in row && !schemaHasQuiet) return { error: { code: "PGRST204", message: "Could not find the 'quiet' column of 'booking_requests' in the schema cache" } };
        rows.push(row); return { error: null };
      },
    }),
  };
  const R = routeLoader({
    "next/server": { NextResponse: NextResponseShim },
    "@/lib/supabaseAdmin": { supabaseAdmin: admin },
    "@/lib/apiRoute": { route: (_n, f) => f },
    "@/lib/serverAlerts": { raiseAlertOnce: async (a) => { alerts.push(a); return true; } },
    "@/lib/tenantScope": { integrationTenant: () => "00000000-0000-0000-0000-000000000001" },
  })("app/api/book/route.ts");
  ok("compiled: the booking route, with the real lib/rateLimit and lib/planNav", typeof R.POST === "function");
  let n = 0;
  const ask = async (over = {}) => {
    n++;
    const res = await R.POST(new Request("https://app.example.test/api/book", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": over.ip ?? `10.0.0.${n}` },
      body: JSON.stringify({ name: "Made-up Planner", email: over.email ?? `planner${n}@example.test`, event_date: "2026-11-07", headcount: 40, ...over.body }) }));
    return { status: res.status, j: await res.json() };
  };
  const first = await ask();
  ok("a lead under the hour's thirty: kept, not quiet, and nothing said beyond its own announcement", first.status === 200 && first.j.ok === true && rows.length === 1 && !("quiet" in rows[0]) && alerts.length === 0, { first, rows });
  await ask({ ip: "7.7.7.7" }); await ask({ ip: "7.7.7.7" }); await ask({ ip: "7.7.7.7" });
  const fourth = await ask({ ip: "7.7.7.7" });
  ok("an address's own three in ten minutes: the fourth is told — and spends nothing everyone shares", fourth.status === 429 && /from you/.test(fourth.j.error) && s.counts["book:global"] === 4, { fourth, global: s.counts["book:global"] });
  s.counts["book:global"] = 30;
  rows.length = 0;
  const burst = await ask(), burst2 = await ask();
  ok("past everyone's thirty an hour: the lead is kept — quiet — and the person thanked as anyone is",
    burst.status === 200 && burst.j.ok === true && burst2.status === 200 && rows.length === 2 && rows.every((r) => r.quiet === true) && rows[0].name === "Made-up Planner", { burst, rows });
  ok("…and the crew are told that a burst came, where it is, once (raiseAlertOnce, an hour's subject)",
    alerts.length === 2 && alerts.every((a) => a.kind === "booking_burst" && a.category === "booking" && a.severity === "important" && a.link === "/crew?s=plan&t=leads"
      && /^book-burst:\d{4}-\d{2}-\d{2}T\d{2}$/.test(a.subjectId)) && alerts[0].subjectId === alerts[1].subjectId && /nobody was turned away/.test(alerts[0].body), alerts);
  schemaHasQuiet = false; rows.length = 0; alerts.length = 0;
  const old = await ask();
  ok("before 0434 (no quiet column): kept as before — announced as before — never a failure", old.status === 200 && rows.length === 1 && !("quiet" in rows[0]), { old, rows });
  schemaHasQuiet = true; rows.length = 0; s = store();
  const bot = await ask({ body: { website: "https://spam.example.test" } });
  ok("the field no person fills in: thanked, nothing kept, nothing counted", bot.status === 200 && rows.length === 0 && !s.asked.length, { bot, asked: s.asked });
}
{
  const crew = code(read("app/crew/page.tsx"));
  ok("Plan › Leads says which leads came in a burst, not announced", /r\.quiet \? "came in a burst, not announced" : null/.test(crew) && /quiet\?: boolean;/.test(read("lib/db.ts")));
}

// ── 4 · the two-step screen in the day console ─────────────────────────────────────────────────────────────────────
{
  const tsp = code(read("components/TwoStepPrompt.tsx"));
  ok("the two-step screen's text is the theme's ink (text-cream on its section) — never inherited from the body's night cream",
    (tsp.match(/<section className="screen text-cream">/g) || []).length === 2 && !/<section className="screen">/.test(tsp)
    && /--color-cream: var\(--cream\);/.test(read("app/tailwind.css")));
  const crewPage = code(read("app/crew/page.tsx"));
  ok("…and the console's own messages before it opens — not set up, couldn't load, staff only — are drawn in it too",
    /if \(!enabled\) return <section className="screen text-cream"><div className="h-title">Admin<\/div>/.test(crewPage)
    && (crewPage.match(/<section className="screen text-cream">\s*<div className="toprow"><div className="eyb">Crew<\/div>/g) || []).length === 2);
  ok("the two-step screen's \"Crew\" sits in the console's header row (gold, as \"Staff only\" has it), never bare",
    (tsp.match(/<div className="toprow"><div className="eyb">Crew<\/div><\/div>/g) || []).length === 2 && !/<div className="eyb">Crew<\/div>\s*<h1/.test(tsp));
}

console.log(`\nR29 — A DOOR STAYS OPEN FOR THE CUSTOMER: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
