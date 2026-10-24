// R51 — EVERY ORDER, BY THE DAY IT WAS BOUGHT (2026-10-24 — Ryan: "pull orders and attach orders based on the date of
// purchase"; "1, but best practice for all you mentioned if something is missing").
//
//   1 · lib/orderLedger: five channels, one kind of line; the day is the purchase's, in Eastern time; the days, their
//       counts and totals (a canceled order counted in neither); search; the window's days; the accountant's words.
//   2 · Money › Orders: every channel by the day bought — the days, a channel, a search, a file of what's shown.
//   3 · A customer's record: their orders on every channel — the shop's too — by the day bought, all of them on a tap.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ── 1 · the ledger ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  const L = loadTs("lib/orderLedger.ts");
  // 11:30pm Eastern on Oct 23 is 03:30Z on the 24th: bought on the 23rd, the business's day.
  const late = L.toLine("cup", { id: "4f2a0000-0000", customer: "Kim", customer_id: "c1", total_cents: 1400, status: "done", paid: true, payment_id: "sq_1", created_at: "2026-10-24T03:30:00Z" });
  ok("a cup bought at 11:30pm Eastern is that day's, in the Pass's words, paid in the accountant's", late.day === "2026-10-23" && late.state === "Picked up" && late.paid === "Paid online" && late.isPaid && !late.canceled, late);
  const cash = L.toLine("pickup", { id: "p1", name: "Pat", total_cents: 3600, paid: true, collected_via: "cash", collected_at: "2026-10-22T15:00:00Z", picked_up: true, created_at: "2026-10-22T14:00:00Z" });
  ok("a pickup paid in cash at the window says so, and that it was picked up", cash.paid === "Cash at the window" && cash.state === "Picked up" && cash.isPaid, cash);
  const shop = L.toLine("shop", { id: "s1", ship_name: null, email: "a@x.test", total_cents: 3200, status: "refunded", created_at: "2026-10-20T18:00:00Z" });
  const office = L.toLine("office", { id: "b1", company: "Upstate Spine", total_cents: 9000, payment_status: "pending", status: "delivered", created_at: "2026-10-21T13:00:00Z" });
  const gone = L.toLine("delivery", { id: "d1", name: "Jo", total_cents: 4100, payment_status: "paid", canceled_at: "2026-10-21T20:00:00Z", created_at: "2026-10-21T12:00:00Z" });
  ok("the shop's, the office's and a canceled delivery's lines", shop.who === "a@x.test" && shop.paid === "Refunded" && shop.canceled && !shop.isPaid
    && office.who === "Upstate Spine" && office.paid === "Due" && office.state === "Delivered" && !office.isPaid && gone.state === "Canceled" && gone.canceled, { shop, office, gone });
  ok("money and where it is, said once", L.lineWords({ paid: "Paid", state: "Paid" }) === "Paid" && L.lineWords(office) === "Due · Delivered");
  const days = L.byDay([late, cash, shop, office, gone]);
  ok("by the day bought, newest first, each day's count and its total of what wasn't canceled",
    JSON.stringify(days.map((d) => [d.day, d.count, d.totalCents])) === '[["2026-10-23",1,1400],["2026-10-22",1,3600],["2026-10-21",2,9000],["2026-10-20",1,0]]', days.map((d) => [d.day, d.count, d.totalCents]));
  const m = (c) => (c / 100).toFixed(2);
  ok("search: every typed word — the name, the channel, the state, the order's number with or without its #, the amount",
    L.lineMatches(late, "kim cup", m) && L.lineMatches(late, "#4F2A", m) && L.lineMatches(late, "14.00", m) && L.lineMatches(office, "upstate delivered", m) && !L.lineMatches(late, "shop", m));
  ok("the window: today, the last 7 / 30 / 90 days, or two dates in either order",
    JSON.stringify(L.rangeDays("today", "2026-10-24")) === '{"from":"2026-10-24","through":"2026-10-24"}' && JSON.stringify(L.rangeDays("7", "2026-10-24")) === '{"from":"2026-10-18","through":"2026-10-24"}'
      && JSON.stringify(L.rangeDays("custom", "2026-10-24", { from: "2026-10-10", to: "2026-10-01" })) === '{"from":"2026-10-01","through":"2026-10-10"}' && L.rangeDays("30", "2026-03-10").from === "2026-02-09");
  ok("a day's heading: Today, Yesterday, then the date — and the year when it isn't this one",
    L.dayHead("2026-10-24", "2026-10-24") === "Today · Sat, Oct 24" && L.dayHead("2026-10-23", "2026-10-24") === "Yesterday · Fri, Oct 23" && L.dayHead("2026-10-20", "2026-10-24") === "Tue, Oct 20"
      && L.dayHead("2025-12-31", "2026-10-24") === "Wed, Dec 31, 2025");
  const lib = read("lib/orderLedger.ts");
  ok("every channel read on its own, by its purchase, newest first — a refused one named, never an empty day",
    /order\("created_at", \{ ascending: false \}\)/.test(lib) && /q = q\.gte\("created_at", opts\.fromIso\)/.test(lib) && /q = q\.lt\("created_at", opts\.toIso\)/.test(lib)
      && /failed: res\.filter\(\(r\) => r\.rows === null\)\.map\(\(r\) => r\.ch\)/.test(lib) && /shop: \{ table: "shop_orders"/.test(lib));
}

// ── 2 · Money › Orders ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const c = read("components/OrderLedger.tsx");
  const page = read("app/crew/page.tsx");
  ok("Order history is every order by the day bought, in Money", /<Panel id="orders" title="Orders · by the day bought" sub="Every channel — cups, pickups, delivery, office, shop"><OrdersHistory \/><\/Panel>/.test(page)
    && /function OrdersHistory\(\) \{\s*return <OrderLedger \/>;\s*\}/.test(page) && /const OrderLedger = dynamic\(\(\) => import\("@\/components\/OrderLedger"\)/.test(page));
  ok("narrowed by the days (two dates too), a channel and a search; the day's ET bounds; read again on a new order",
    /<Segmented label="Bought" kind="choice" size="sm" value=\{range\}/.test(c) && /type="date"/.test(c) && /aria-label="Which channel"/.test(c) && /type="search"/.test(c)
      && /fromIso: etDayStart\(span\.from\)\.toISOString\(\), toIso: etDayStart\(addDays\(span\.through, 1\)\)\.toISOString\(\)/.test(c) && /shownIds\.current\.has\(String\(row\.id/.test(c));
  ok("each day under its heading with its count and total; a refused channel said; the file is what's shown, named by its days",
    /\{dayHead\(d\.day, today\)\}/.test(c) && /\{d\.count\} · \{money\(d\.totalCents\)\}/.test(c) && /Couldn&apos;t read \{board\.data\.failed/.test(c)
      && /downloadCsv\(`gt3-orders-\$\{span\.from\}-to-\$\{span\.through\}\.csv`, shown\.map/.test(c) && /bought: l\.day, time: timeOf\(l\.at\), channel: CHANNEL_WORD\[l\.channel\], order: orderNo\(l\.id\)/.test(c));
  ok("⌘K finds it by the words for it", /\{ id: "orders", section: "money", title: "Orders · by the day bought", words: \[[^\]]*"shop orders"[^\]]*"purchase date"/.test(read("lib/panelIndex.ts")));
}

// ── 3 · a customer's record ──────────────────────────────────────────────────────────────────────────────────────────
{
  const crm = read("components/CrmPanel.tsx");
  ok("a customer's orders are the ledger's — every channel, the shop's too — by the day bought",
    /readLedger\(supabase, \{ customerId: c\.id, limit: 200 \}\)/.test(crm) && !/from\("all_orders"\)/.test(crm) && /type CrmOrder = LedgerLine;/.test(crm));
  ok("twelve, then all of them on a tap; the year when it isn't this one; a channel that couldn't be read said; paid counted by what was taken",
    /\{allOrders \? "Show the latest 12" : `Show all \$\{orders\.length\}`\}/.test(crm) && /o\.day\.startsWith\(thisYear\)/.test(crm) && /Couldn&apos;t read their \{ordersFailed/.test(crm)
      && /orders\.filter\(\(o\) => o\.isPaid && !o\.canceled\)/.test(crm));
  ok("this file runs with the rest", /node scripts\/r50\.test\.mjs && node scripts\/r51\.test\.mjs/.test(JSON.parse(read("package.json")).scripts.test));
}

console.log(`R51 — EVERY ORDER, BY THE DAY IT WAS BOUGHT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
