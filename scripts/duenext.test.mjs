// DUE NEXT, AS ONE LIST (2026-10-11, the dispatch round).
//
// The finding, as a sentence: "what leaves the truck next, and is any of it in trouble?" took four reads on Live Ops —
// three folded cards and the Pass's button — and two of the answers were never said at all: a porch past its window,
// and an office stop past its own. lib/dueNext is the one list: every pickup pack, porch, office stop and cup placed
// ahead, soonest first, one row each, in words.
//
// What is real is compiled from lib/ (dueNext, and what it imports: dates, settled, office). The rows are the shapes
// the cards already select; every name, address and time below is made up. The clock is Eastern, as the truck's is,
// and the windows are checked across both of 2026's clock changes — the Sunday porch run lands on both.
process.env.TZ = "America/New_York";
import { libLoader } from "./fixtures/chargeonce.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const load = libLoader();
const N = load("lib/dueNext.ts");
ok("compiled: lib/dueNext", typeof N.dueList === "function" && typeof N.porchWindow === "function");

const iso = (ms) => new Date(ms).toISOString();
const et = (s) => Date.parse(`${s}-04:00`);   // October: Eastern Daylight Time
const words = (flags) => flags.map((f) => f.word);

// ── windows, as instants, across the clock changes ──────────────────────────────────────────────────
{
  const w = N.porchWindow("2026-10-11", "5–8 AM");
  ok("a porch's 5–8 AM on Sun Oct 11 is 09:00Z–12:00Z (EDT)", w && iso(w.start) === "2026-10-11T09:00:00.000Z" && iso(w.end) === "2026-10-11T12:00:00.000Z", w && [iso(w.start), iso(w.end)]);
  const fallBack = N.porchWindow("2026-11-01", "5–8 AM");
  ok("…on Sun Nov 1, the morning the clocks go back, 5 AM is 10:00Z (EST) — not midnight plus five hours (09:00Z)",
    fallBack && iso(fallBack.start) === "2026-11-01T10:00:00.000Z" && iso(fallBack.end) === "2026-11-01T13:00:00.000Z", fallBack && [iso(fallBack.start), iso(fallBack.end)]);
  const springOn = N.porchWindow("2026-03-08", "5–8 AM");
  ok("…on Sun Mar 8, the morning they go forward, 5 AM is 09:00Z (EDT) — not 10:00Z",
    springOn && iso(springOn.start) === "2026-03-08T09:00:00.000Z" && iso(springOn.end) === "2026-03-08T12:00:00.000Z", springOn && [iso(springOn.start), iso(springOn.end)]);
  const winter = N.porchWindow("2026-12-06", "5–8 AM");
  ok("…and in December, 10:00Z–13:00Z", winter && iso(winter.start) === "2026-12-06T10:00:00.000Z" && iso(winter.end) === "2026-12-06T13:00:00.000Z");
  ok("a hyphen reads as the dash does", N.porchWindow("2026-10-11", "5-8 AM")?.end === w.end);
  const noon = N.porchWindow("2026-10-11", "11 AM–2 PM");
  ok("11 AM–2 PM is 15:00Z–18:00Z", noon && iso(noon.start) === "2026-10-11T15:00:00.000Z" && iso(noon.end) === "2026-10-11T18:00:00.000Z");
  const oneHalf = N.porchWindow("2026-10-11", "11–2 PM");
  ok("11–2 PM starts at 11 in the morning, not 11 at night", oneHalf && iso(oneHalf.start) === "2026-10-11T15:00:00.000Z", oneHalf && iso(oneHalf.start));
  const half = N.porchWindow("2026-10-11", "5:30–8 AM");
  ok("5:30–8 AM starts at 09:30Z", half && iso(half.start) === "2026-10-11T09:30:00.000Z");
  ok("words that are not a window are no window (and never late)", N.porchWindow("2026-10-11", "morning") === null && N.porchWindow("2026-10-11", null) === null && N.porchWindow("2026-10-11", "25–8 AM") === null);
  const office = N.officeWindow("2026-10-12", "mon_0600_0900");
  ok("an office code 'mon_0600_0900' on Mon Oct 12 is 10:00Z–13:00Z", office && iso(office.start) === "2026-10-12T10:00:00.000Z" && iso(office.end) === "2026-10-12T13:00:00.000Z");
  ok("a code that is not one is no window", N.officeWindow("2026-10-12", "monday early") === null && N.officeWindow("2026-10-12", null) === null);
  ok("wallAt works in any zone — 5 AM in Chicago is 10:00Z", iso(N.wallAt("2026-10-11", 5, 0, "America/Chicago")) === "2026-10-11T10:00:00.000Z");
}

// ── the shapes the cards read (made up) ─────────────────────────────────────────────────────────────
const porch = (id, name, extra = {}) => ({
  id, name, address_street: `${id.length * 7} Elm St`, address_city: "Greenville", address_zip: "29601",
  delivery_date: "2026-10-11", delivery_window: "5–8 AM", pack_size: 12, status: "received", payment_status: "paid",
  driver_note: null, canceled_at: null, ...extra,
});
const stop = (id, company, extra = {}) => ({
  id, company, address_street: "100 Main St", address_city: "Greenville", delivery_date: "2026-10-12",
  delivery_window: "mon_0600_0900", gallons: 5, status: "received", payment_status: "paid", billing_terms: "prepaid",
  canceled_at: null, ...extra,
});
const pack = (id, name, extra = {}) => ({
  id, name, size: 6, drop_date: "2026-10-11", stage: "reserved", picked_up: false, canceled_at: null,
  paid: true, payment_id: "pay_TEST1", payment_status: "paid", collected_at: null, ...extra,
});
const cup = (id, customer, readyFrom, extra = {}) => ({
  id, customer, items: ["rise", "flow"], status: "new", ready_from: readyFrom,
  paid: true, payment_id: "pay_TEST2", payment_status: "paid", collected_at: null, ...extra,
});

// ── states and what is wrong, in words ──────────────────────────────────────────────────────────────
{
  const at730 = et("2026-10-11T07:30:00"), at815 = et("2026-10-11T08:15:00");
  ok("a scheduled porch inside its window: 'scheduled'", JSON.stringify(words(N.porchFlags(porch("p", "A"), at730))) === '["scheduled"]');
  ok("…past it: 'scheduled', 'late' — the window against the clock, which no board compared before",
    JSON.stringify(words(N.porchFlags(porch("p", "A"), at815))) === '["scheduled","late"]', words(N.porchFlags(porch("p", "A"), at815)));
  ok("brewed, and out for delivery, past the window: late too",
    JSON.stringify(words(N.porchFlags(porch("p", "A", { status: "brewed" }), at815))) === '["brewed","late"]'
    && JSON.stringify(words(N.porchFlags(porch("p", "A", { status: "out_for_delivery" }), at815))) === '["out for delivery","late"]');
  ok("held is 'held' and never late — it is an outcome", JSON.stringify(words(N.porchFlags(porch("p", "A", { status: "held_for_pickup" }), at815))) === '["held"]');
  ok("the driver's not home (issue + 'Not home — 6:42 AM') is 'not home'",
    JSON.stringify(words(N.porchFlags(porch("p", "A", { status: "issue", driver_note: "Not home — 6:42 AM" }), at815))) === '["not home"]');
  ok("any other issue is 'issue'", JSON.stringify(words(N.porchFlags(porch("p", "A", { status: "issue", driver_note: null }), at815))) === '["issue"]');
  ok("a porch not paid says unpaid; a refunded one, refunded",
    words(N.porchFlags(porch("p", "A", { payment_status: "pending" }), at730)).includes("unpaid")
    && words(N.porchFlags(porch("p", "A", { payment_status: "refunded" }), at730)).includes("refunded")
    && !words(N.porchFlags(porch("p", "A", { payment_status: "refunded" }), at730)).includes("unpaid"));
  ok("a window nobody can read is never called late", !N.porchLate(porch("p", "A", { delivery_window: "morning" }), at815));
  ok("tones: late is crit, held/not home/unpaid warn, a state plain",
    N.porchFlags(porch("p", "A"), at815)[1].tone === "crit" && N.porchFlags(porch("p", "A", { status: "held_for_pickup" }), at815)[0].tone === "warn"
    && N.porchFlags(porch("p", "A"), at730)[0].tone === "plain");

  const mon = et("2026-10-12T08:00:00"), monLate = et("2026-10-12T09:30:00");
  ok("an office stop inside its window: 'scheduled'; past it, 'late'",
    JSON.stringify(words(N.officeFlags(stop("o", "Acme"), mon))) === '["scheduled"]' && JSON.stringify(words(N.officeFlags(stop("o", "Acme"), monLate))) === '["scheduled","late"]');
  ok("…an overdue one from last Monday is late today", N.officeLate(stop("o", "Acme", { delivery_date: "2026-10-05" }), et("2026-10-11T10:00:00")));
  ok("a stop the driver couldn't make is 'not delivered', and not late", JSON.stringify(words(N.officeFlags(stop("o", "Acme", { status: "issue" }), monLate))) === '["not delivered"]');
  ok("prepaid and not paid is unpaid; a failed payment is unpaid",
    words(N.officeFlags(stop("o", "Acme", { payment_status: "pending" }), mon)).includes("unpaid") && words(N.officeFlags(stop("o", "Acme", { billing_terms: "net15", payment_status: "failed" }), mon)).includes("unpaid"));
  ok("net terms before the delivery are invoiced after it — not unpaid; invoiced is not unpaid either",
    !words(N.officeFlags(stop("o", "Acme", { billing_terms: "net15", payment_status: "pending" }), mon)).includes("unpaid")
    && !words(N.officeFlags(stop("o", "Acme", { billing_terms: "net30", payment_status: "invoiced" }), mon)).includes("unpaid"));

  ok("a pack: its stage's word; unpaid until paid online, in cash or on the reader",
    JSON.stringify(words(N.packFlags(pack("k", "Cara", { paid: false, payment_id: null, payment_status: "pending" })))) === '["reserved","unpaid"]'
    && JSON.stringify(words(N.packFlags(pack("k", "Cara", { paid: false, payment_status: "pending", collected_at: "2026-10-11T15:10:00Z" })))) === '["reserved"]'
    && JSON.stringify(words(N.packFlags(pack("k", "Cara", { stage: "en_route" })))) === '["en route"]');
  ok("a cup placed ahead: 'scheduled', and unpaid until it is",
    JSON.stringify(words(N.cupFlags(cup("c", "Dee", "2026-10-11T15:00:00Z", { paid: false, payment_id: null, payment_status: "pending" })))) === '["scheduled","unpaid"]'
    && JSON.stringify(words(N.cupFlags(cup("c", "Dee", "2026-10-11T15:00:00Z")))) === '["scheduled"]');
}

// ── one row each ────────────────────────────────────────────────────────────────────────────────────
{
  const feed = { status: "ready", day: "2026-10-11", at: "2026-10-11T15:00:00.000Z",
    rows: [pack("k1", "Cara"), pack("k2", "Gus", { picked_up: true, stage: "picked_up" }), pack("k3", "Hal", { canceled_at: "2026-10-10T12:00:00Z" }), pack("k4", "Ivy", { drop_date: "2026-10-17" })] };
  const r = N.pickupRows(feed);
  ok("pickup: only the drop's packs still to hand over (picked up, canceled and another drop's are not due)", r.length === 1 && r[0].id === "k1", r.map((x) => x.id));
  ok("pickup: the drop's stop time is the row's time, the card is the pickup drop, no row id (the card lists no packs)",
    r[0].at === Date.parse("2026-10-11T15:00:00.000Z") && r[0].time === "11:00am" && r[0].card === "due-pickup" && r[0].anchor === null && r[0].count === "6-pack");
  ok("pickup: the Saturday rule knows the day only — no time, sorted after that day's timed rows",
    N.pickupRows({ ...feed, at: null })[0].at === null && N.pickupRows({ ...feed, at: null })[0].time === "");
  ok("pickup: no drop yet, no rows", N.pickupRows({ status: "loading", day: null, at: null, rows: [pack("k1", "Cara")] }).length === 0);

  const p = N.porchRows({ status: "ready",
    run: [porch("a1", "Ana Ruiz"), porch("a2", "Bo Diaz", { status: "delivered" }), porch("a3", "Cy Ng", { canceled_at: "2026-10-09T12:00:00Z" })],
    earlier: [porch("e1", "Eli Fox", { delivery_date: "2026-10-04", status: "held_for_pickup" })] }, et("2026-10-11T07:30:00"));
  ok("porches: the run's not yet delivered, and what is carried from earlier — delivered and canceled are not due", JSON.stringify(p.map((x) => x.id)) === '["e1","a1"]', p.map((x) => x.id));
  ok("porches: the row lands on the porch in its card (porch-<id>), says its window, who, and bottles — the street is the card's",
    p[1].card === "due-porch" && p[1].anchor === "porch-a1" && p[1].time === "5–8 AM" && p[1].who === "Ana Ruiz" && p[1].count === "12 bottles" && !("where" in p[1]), p[1]);
  ok("porches: one bottle is a bottle", N.porchRows({ status: "ready", run: [porch("z", "Zed", { pack_size: 1 })], earlier: [] }, 0)[0].count === "1 bottle");

  const o = N.officeRows({ status: "ready", rows: [stop("o1", "Acme Co"), stop("o2", "Brite LLC", { status: "delivered" }), stop("o3", "Cobalt", { gallons: 4.6 })] }, et("2026-10-12T08:00:00"));
  ok("office: delivered stops are not due; the window in the route's words; gallons rounded as the route rounds them",
    o.length === 2 && o[0].time === "6–9 AM" && o[1].count === "5 gal" && o[0].anchor === "office-o1" && o[0].card === "due-office", o.map((x) => [x.id, x.time, x.count]));

  const now = et("2026-10-11T10:00:00");
  const c = N.cupRows({ status: "ready", rows: [
    cup("c1", "Dee", "2026-10-11T15:00:00Z"), cup("c2", "Old", "2026-10-11T13:00:00Z"), cup("c3", "Gone", "2026-10-11T16:00:00Z", { status: "void" }),
    cup("c4", "Late night", "2026-10-12T01:30:00Z"), cup("c5", "", "2026-10-11T16:00:00Z", { items: ["rise"] }),
  ] }, now);
  ok("cups: only those whose time has not come — the minute it comes, the ticket is the pass's", JSON.stringify(c.map((x) => x.id)) === '["c1","c4","c5"]', c.map((x) => x.id));
  ok("cups: a 9:30pm cup is that ET day's, not tomorrow's UTC day", c.find((x) => x.id === "c4").day === "2026-10-11");
  ok("cups: no name is Guest, one drink is a drink, and a cup opens the Pass", c.find((x) => x.id === "c5").who === "Guest" && c.find((x) => x.id === "c5").count === "1 drink" && c[0].card === null);
}

// ── the whole list, soonest first ───────────────────────────────────────────────────────────────────
// Sunday Oct 11, 7:30 in the morning. On the board: two porches carried from last Sunday (one held, one not home), an
// office stop from last Monday never logged, today's run, today's 11:00 drop, cups placed ahead for 11:00 today and
// 9:00 tomorrow, and tomorrow's 6–9 office route.
{
  const now = et("2026-10-11T07:30:00");
  const feeds = {
    pickup: { status: "ready", day: "2026-10-11", at: "2026-10-11T15:00:00.000Z", rows: [pack("k1", "Cara", { paid: false, payment_id: null, payment_status: "pending" }), pack("k2", "Gus", { picked_up: true, stage: "picked_up" })] },
    porch: { status: "ready",
      run: [porch("a2", "Bo Diaz", { status: "out_for_delivery" }), porch("a1", "Ana Ruiz"), porch("a3", "Cy Ng", { status: "delivered" })],
      earlier: [porch("e2", "Fay Hu", { delivery_date: "2026-10-04", status: "issue", driver_note: "Not home — 6:42 AM" }), porch("e1", "Eli Fox", { delivery_date: "2026-10-04", status: "held_for_pickup" })] },
    office: { status: "ready", rows: [stop("o2", "Brite LLC", { billing_terms: "net15", payment_status: "pending" }), stop("o1", "Acme Co", { payment_status: "pending" }), stop("o0", "Old Mill", { delivery_date: "2026-10-05" })] },
    cup: { status: "ready", rows: [cup("c2", "Jo", "2026-10-12T13:00:00Z"), cup("c1", "Dee", "2026-10-11T15:00:00Z")] },
  };
  const l = N.dueList(feeds, now);
  const order = l.rows.map((r) => `${r.channel}:${r.who}`);
  const want = [
    "porch:Eli Fox", "porch:Fay Hu",             // Sun Oct 4, both 5 AM: by name
    "office:Old Mill",                           // Mon Oct 5, never logged
    "porch:Ana Ruiz", "porch:Bo Diaz",           // today 5 AM
    "pickup:Cara", "cup:Dee",                    // today 11:00 — a tie on the minute goes pickup, then cup
    "office:Acme Co", "office:Brite LLC",        // tomorrow 6 AM
    "cup:Jo",                                    // tomorrow 9 AM
  ];
  ok("soonest first across all four channels, what was carried from earlier first", JSON.stringify(order) === JSON.stringify(want), order);
  ok("nothing failed, nothing loading", l.failed.length === 0 && l.loading.length === 0);
  const flagsOf = (who) => words(l.rows.find((r) => r.who === who).flags);
  ok("each row says its state and what is wrong: held, not home, the office stop late, the pack unpaid, Acme unpaid, Brite not",
    JSON.stringify(flagsOf("Eli Fox")) === '["held"]' && JSON.stringify(flagsOf("Fay Hu")) === '["not home"]'
    && JSON.stringify(flagsOf("Old Mill")) === '["scheduled","late"]' && JSON.stringify(flagsOf("Cara")) === '["reserved","unpaid"]'
    && JSON.stringify(flagsOf("Acme Co")) === '["scheduled","unpaid"]' && JSON.stringify(flagsOf("Brite LLC")) === '["scheduled"]', l.rows.map((r) => [r.who, words(r.flags)]));
  ok("at 8:15 the run's porches not yet delivered say late", words(N.dueList(feeds, et("2026-10-11T08:15:00")).rows.find((r) => r.who === "Ana Ruiz").flags).includes("late"));
  ok("at 11:01 Dee's cup has left the list for the pass, with no read in between", !N.dueList(feeds, et("2026-10-11T11:01:00")).rows.some((r) => r.who === "Dee"));
  {
    const untimed = N.dueList({ ...feeds, pickup: { ...feeds.pickup, at: null } }, now).rows.filter((r) => r.day === "2026-10-11").map((r) => r.who);
    ok("a drop known only by its day goes after that day's timed rows ('sometime Sunday' below 'Sunday at 11')", untimed[untimed.length - 1] === "Cara", untimed);
  }
  const failed = N.dueList({ ...feeds, porch: { status: "error", run: [], earlier: [] }, cup: { status: "loading", rows: [] } }, now);
  ok("a feed that failed is named, and one still loading is known — neither is 'nothing due'",
    JSON.stringify(failed.failed) === '["porch"]' && JSON.stringify(failed.loading) === '["cup"]' && !failed.rows.some((r) => r.channel === "porch"));
  ok("feedsWord says which, as a sentence", N.feedsWord(["porch"]) === "the porches" && N.feedsWord(["porch", "office"]) === "the porches and the office route"
    && N.feedsWord(["pickup", "porch", "cup"]) === "the pickups, the porches and the cups placed ahead");
  ok("the same porch handed up twice is one row", N.porchRows({ status: "ready", run: [porch("a1", "Ana")], earlier: [porch("a1", "Ana")] }, now).length === 1);
}

// ── the words on a row ──────────────────────────────────────────────────────────────────────────────
{
  const t = "2026-10-11";
  ok("dueDay: Today, Tomorrow, Yesterday", N.dueDay(t, t) === "Today" && N.dueDay("2026-10-12", t) === "Tomorrow" && N.dueDay("2026-10-10", t) === "Yesterday");
  ok("dueDay: the weekday inside the week ahead", N.dueDay("2026-10-17", t) === "Sat" && N.dueDay("2026-10-13", t) === "Tue");
  ok("dueDay: the date from a week on, and for the past", N.dueDay("2026-10-18", t) === "Sun, Oct 18" && N.dueDay("2026-10-04", t) === "Sun, Oct 4", [N.dueDay("2026-10-18", t), N.dueDay("2026-10-04", t)]);
  ok("dayAndDate", N.dayAndDate("2026-10-18") === "Sun, Oct 18");
  ok("dueLead fits the lead column: Today, Tomorrow, the weekday, else the date — yesterday too",
    N.dueLead(t, t) === "Today" && N.dueLead("2026-10-12", t) === "Tomorrow" && N.dueLead("2026-10-17", t) === "Sat"
    && N.dueLead("2026-10-10", t) === "Oct 10" && N.dueLead("2026-10-04", t) === "Oct 4" && N.dueLead("2026-10-24", t) === "Oct 24"
    && ["Today", "Tomorrow", "Sat", "Oct 10", "Oct 24"].every((w) => w.length <= 8));
  const r = N.porchRows({ status: "ready", run: [], earlier: [porch("e2", "Fay Hu", { delivery_date: "2026-10-04", status: "issue", driver_note: "Not home — 6:42 AM" })] }, et("2026-10-11T07:30:00"))[0];
  const label = N.dueLabel(r, t);
  ok("a row read aloud: when, channel, who, how many, its words, and where a tap goes",
    label === "Sun, Oct 4 5–8 AM · Porch · Fay Hu · 12 bottles · not home. Opens Sunday delivery.", label);
  ok("channel words", N.CHANNEL_WORD.pickup === "Pickup" && N.CHANNEL_WORD.porch === "Porch" && N.CHANNEL_WORD.office === "Office" && N.CHANNEL_WORD.cup === "Cup");
  ok("card ids are the ones the cards draw", N.DUE_CARD.pickup === "due-pickup" && N.DUE_CARD.porch === "due-porch" && N.DUE_CARD.office === "due-office" && N.dueAnchor("porch", "x") === "porch-x");
}

console.log(`duenext: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
