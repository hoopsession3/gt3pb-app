// R55 — TRAFFIC AND THE ROOM, LINKED INTO THE MONEY (2026-10-25 — phase C of the investor-ready vision: "explain how
// traffic will actually be generated… Reach → Conversion → First Purchase → Repeat Purchase → Retention → Revenue";
// "when I move a counter… recalculate estimated throughput… show the estimated financial impact"; the traceability
// audit's gaps 5 and 6: the funnel reached the money only by a button that copied a number, and the room never capped it).
//
//   1 · lib/visionTraffic by hand: new guests, the ones who come back, orders, what a guest costs and is worth.
//   2 · lib/visionRoom: the counter's capacity, each hour against it, a change to the room, our own busiest hour.
//   3 · The link, not a copy: the channels drive the 36 months live (orders and marketing); the room caps them and says
//       what it couldn't take; both on the one dependency map, traced, in the what-if and in what moves it most.
//   4 · The wiring: the plan's case has Traffic and The room beside Money, on the same scenario and the same save.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const M = loadTs("lib/visionMoney.ts"), T = loadTs("lib/visionTraffic.ts"), R = loadTs("lib/visionRoom.ts");

// ── 1 · the traffic, by hand ────────────────────────────────────────────────────────────────────────────────────────
// One channel: 1,000 reached a month, 5% order a first time (50 new guests), $300 a month. Guests who've ordered come back
// twice a month; half stay each month.
const ch = [{ kind: "local", label: "", reach: 1000, convertPct: 5, costCents: 30000, startMonth: 1 }];
const ret = { repeatPerMonth: 2, keptPct: 50 };
{
  const t = T.traffic(ch, ret, 1000, 70, 30);
  ok("month 1: 50 new guests, nobody back yet — 50 orders", t.ok && t.months[0].newGuests === 50 && t.months[0].returning === 0 && t.months[0].orders === 50, t.months[0]);
  ok("month 2: 25 kept come back twice — 100 orders; month 3: 37.5 back — 125", t.months[1].orders === 100 && t.months[2].orders === 125, [t.months[1].orders, t.months[2].orders]);
  ok("a guest places 1 + 2 × ½ ÷ ½ = 3 orders; worth 3 × $10 × 70% = $21", near(t.ordersPerGuest, 3) && near(t.ltv, 2100));
  ok("a new guest costs $300 ÷ 50 = $6", near(t.blendedCac, 600));
  ok("nothing guessed: no channel, no return rate → it says what's missing", !T.traffic([], ret, 1000, 70, 30).ok && T.traffic(ch, { repeatPerMonth: null, keptPct: 50 }, 1000, 70, 30).missing.includes("how often a guest comes back"));
  ok("a channel that costs more per guest than a guest is worth is a stop", T.trafficFlags(T.traffic([{ ...ch[0], costCents: 300000 }], ret, 1000, 70, 30), [{ ...ch[0], costCents: 300000 }], null, 0).some((f) => f.level === "stop"));
}

// ── 2 · the room ────────────────────────────────────────────────────────────────────────────────────────────────────
const it = (kind, id) => ({ id, kind, x: 0, y: 0, rot: 0 });
const oneCounter = { items: [it("order_counter", "a"), it("two_top", "b"), it("four_top", "c"), it("tap_tower", "d")] };
const two = { items: [...oneCounter.items, it("walk_up", "e")] };
{
  const c = R.capacity(oneCounter, 45);
  ok("one register at 45 s an order: 80 an hour; 6 seats; a tap", c.registers === 1 && c.counterPerHour === 80 && c.seats === 6 && c.taps === 1, c);
  ok("a walk-up window is a second register: 160 an hour", R.capacity(two, 45).counterPerHour === 160);
  const h = R.hours(1000, 10, 1.5, 0.5);
  ok("the hours: 100 an average hour, 150 at the peak, 50 slow", near(h.normal, 100) && near(h.peak, 150) && near(h.slow, 50));
  const checks = R.checkHours(h, c, 1000);
  const peak = checks.find((x) => x.kind === "peak");
  ok("the peak is 70 past the counter — $700 an hour it can't take", !peak.fits && near(peak.overBy, 70) && near(peak.salesShortCents, 70000), peak);
  ok("moving to two registers: the room says what it does", R.roomDiff(oneCounter, two, 45, h, 1000).says.some((w) => /Another register/.test(w)));
  const at = (iso) => ({ at: iso, channel: "cup", isPaid: true, canceled: false });
  const o = R.observedHours([at("2026-10-01T14:05:00Z"), at("2026-10-01T14:20:00Z"), at("2026-10-01T14:40:00Z"), at("2026-10-02T15:10:00Z")], "cup");
  ok("our busiest hour: 3 cups against an average of 2 — 1.5×", o.sellingHours === 2 && o.peakHour === 3 && o.peakFactor === 1.5, o);
}

// ── 3 · the link ────────────────────────────────────────────────────────────────────────────────────────────────────
const base = M.toInputs({ uses: [{ id: "bar", label: "Bar", category: "equipment", qty: 1, unitCents: 3000000 }], ordersPerDay: 100, avgOrderCents: 1000, daysOpenPerMonth: 30, hoursOpenPerDay: 10,
  cogsPct: 30, cardFeePct: 0, staffHoursPerDay: 20, wageCents: 1500, rentCents: 300000, marketingCents: 50000, channels: ch, repeatPerMonth: 2, keptPct: 50 });
{
  const typed = M.project(base);
  ok("typed by default: the channels set beside the money don't move it", typed.demandFrom === "typed" && typed.months[0].orders === 3000 && typed.traffic === null);
  const linked = { ...base, demandFrom: "channels" };
  const lm = M.project(linked);
  ok("linked: month 1's orders are the channels' 50, month 2's 100", lm.ok && lm.months[0].orders === 50 && lm.months[1].orders === 100, lm.months.slice(0, 2).map((x) => x.orders));
  ok("…and marketing is what they cost, not the typed $500", lm.months[0].marketing === 30000 && lm.months[0].operatingExpenses === M.project({ ...base, marketingCents: 30000, ordersPerDay: 50 / 30 }).months[0].operatingExpenses);
  ok("…orders a day isn't asked for; the channels' numbers are", M.missing({ ...linked, ordersPerDay: null }).length === 0 && M.missing({ ...linked, channels: [] }).includes("a traffic channel"));
  const moreReach = M.project({ ...linked, channels: [{ ...ch[0], reach: 2000 }] });
  ok("live: double a channel's reach and sales follow — no button", moreReach.months[0].revenue === 2 * lm.months[0].revenue);
  // the room's cap: 80 an hour × 10 hours × 30 days = 24,000 a month against the 30,000 a busy plan asks (1,000 a day)
  const busy = { ...base, ordersPerDay: 1000, capToRoom: true };
  const ctx = { counterPerHour: 80 };
  const capped = M.project(busy, { kind: "none" }, ctx);
  ok("capped: 24,000 orders a month, 6,000 the counter can't take", capped.capPerMonth === 24000 && capped.months[0].orders === 24000 && capped.months[0].ordersLost === 6000, capped.months[0]);
  ok("…every month, 216,000 orders and $2.16M of sales not counted", capped.cappedMonths === 36 && capped.ordersLost === 216000 && capped.salesLost === 216000000);
  ok("…said in the flags, pointing at sales", M.flags(busy, capped, { kind: "none" }).some((f) => f.about === "revenue" && /counter caps sales in 36 of 36/.test(f.words)));
  ok("…and the cap without a room is a missing input, not a zero", M.missing({ ...base, capToRoom: true }).some((w) => /room/.test(w)) && !M.project({ ...base, capToRoom: true }).ok);
  ok("a cap the plan never reaches changes nothing", M.project({ ...base, capToRoom: true }, { kind: "none" }, { counterPerHour: 500 }).months.every((x, k) => x.orders === typed.months[k].orders));
  // traced and on the map
  ok("sales are made of demand, the channels and the room", ["demand", "channels", "room"].every((k) => M.DEPS.revenue.includes(k)) && M.DEPS.operatingExpenses.includes("channels"));
  ok("the channels and the room reach ROI and payback", ["roiBusiness", "payback", "requiredFunding"].every((k) => M.upstreamInputs(k).includes("channels") && M.upstreamInputs(k).includes("room")));
  const tr = M.trace(busy, { kind: "none" }, capped);
  ok("the sales trace says it's capped, how much, and is simulated", tr.revenue.kind === "simulated" && /216,000 orders/.test(tr.revenue.worked) && tr.revenue.path.some((s) => /counter takes/.test(s.label)), tr.revenue.worked);
  const tl = M.trace(linked, { kind: "none" }, lm);
  ok("the linked trace walks reach → first orders → coming back", tl.revenue.path[0].value === "The traffic channels, live" && tl.revenue.path.some((s) => /First orders/.test(s.label)));
  ok("the what-if names the channels when you link them", M.changedInputs(base, linked, { kind: "none" }, { kind: "none" }).includes("channels"));
  ok("…and the room when its counter changes under a cap", M.changedInputs({ ...base, capToRoom: true }, { ...base, capToRoom: true }, { kind: "none" }, { kind: "none" }, { counterPerHour: 80 }, { counterPerHour: 160 }).join() === "room");
  ok("what moves it most: the channels' reach, once they drive it (orders a day doesn't)", M.sensitivity(linked, 20).some((s) => /reach/.test(s.driver)) && !M.sensitivity(linked, 20).some((s) => s.driver === "Orders a day"));
  ok("nothing typed moves by itself: the default is the money as it was", M.BLANK.demandFrom === "typed" && M.BLANK.capToRoom === false);
}

// ── 4 · the wiring ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const plans = read("components/vision/Plans.tsx"), panel = read("components/vision/MoneyPanel.tsx"), views = read("components/vision/TrafficRoom.tsx");
  ok("the case: The plan, Traffic, The room, Money", /\{ key: "traffic", label: "Traffic" \}, \{ key: "room", label: "The room" \}, \{ key: "money", label: "Money" \}/.test(plans));
  ok("one panel, one scenario, one save: the views are the money's", /view=\{step\} room=\{room\}/.test(plans) && /view === "traffic" && <TrafficView/.test(panel) && /view === "room" && <RoomView/.test(panel));
  ok("the room is read live, at the scenario's own seconds an order", /capacity\(room, x\.serveSec \?\? ASSUMED_SERVE_SEC\)\.counterPerHour/.test(panel));
  ok("no copy buttons left: a link for orders, a cap for the room", !/Use \{one\(t\.perDay12\)\} orders a day in the money/.test(views) && /From these channels/.test(views) && /At most the counter/.test(views));
  ok("simulated is said as simulated; an assumed timing is labelled", /Simulated from the room as drawn/.test(views) && /Assumed \{ASSUMED_SERVE_SEC\} seconds/.test(views));
  ok("one line, every register: the flow serves from each", /registers: \{ at: Pt; guest: number \| null; end: number \}\[\]/.test(read("lib/visionFlow.ts")));
}

console.log(`R55 — TRAFFIC AND THE ROOM, LINKED INTO THE MONEY: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
