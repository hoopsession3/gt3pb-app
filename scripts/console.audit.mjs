// THE CONSOLE'S LISTS, HELD TO TEN POINTS — AND NEVER LOWER (R48, 2026-10-23 — Ryan: "audits across all consoles…
// 10 out of 10… figure out what we need to do to get to 10, and make that our baseline standard… no regression ever").
//
//   node scripts/console.audit.mjs          # fail on a list below its floor, a floor below its score, or a panel nobody can find
//   node scripts/console.audit.mjs --list   # every list, every point, what it is missing
//
// Every list screen in the crew console (a panel or a section that shows many records) is scored on the same ten points,
// the ones a store, a CRM or a course platform is held to:
//   1 findable    its panel is in lib/panelIndex (⌘K finds it by its title and the words an owner types), or it is a
//                 section of its own (⌘K finds sections)
//   2 search      a search field or a filter over its rows
//   3 select      tick rows, and Select all = what the list shows (components/BulkBar)
//   4 bulk        an action on every ticked row at once
//   5 confirm     the count named before anything is written
//   6 failures    each row answered on its own; a refusal named, never a blanket "Saved"
//   7 undo        what was there put back, for the rows that changed
//   8 history     every table it edits writes who changed what to admin_audit (Settings › Activity log, 0260's trigger)
//   9 permission  the database refuses a role the screen doesn't offer it to (checked by hand; cited per list)
//  10 export      the rows as a CSV (lib/csv downloadCsv)
// A point that genuinely doesn't apply (a read-only report has nothing to bulk-change) is "n/a" WITH ITS REASON, and the
// score is out of what applies. 3–7 are earned by the shared kit (components/BulkBar — it asks, names failures, holds
// Undo), or by a list's own pattern cited in OWN.
//
// THE FLOOR. FLOOR holds each list's score as it stands; a list may only go up. A list above its floor fails too, until
// the floor is raised to it — slack is room to slip back. The aim is TARGET: every list 10/10 of what applies.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const PAGE = "app/crew/page.tsx";

/** A function's body in the console page, by name — the lists drawn inline there. */
function fnBody(src, name) {
  const at = src.search(new RegExp(`\\nfunction ${name}\\(`));
  if (at < 0) return "";
  const rest = src.slice(at + 1);
  const end = rest.slice(1).search(/\n(?:export )?(?:async )?function |\nconst [A-Z]\w+ = dynamic/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

// ── the lists (the R48 console audit: Catalog, Money, Customers, Team, Plan, Prep, Studio, Settings, Service, Production) ──
// file: where its rows are drawn (fn: a function in the console page) · panel: its <Panel id>, or section: the section that
// is it · tables: what it edits (history) · na: points that don't apply, with why · perm: where the database gates it.
export const LISTS = [
  { key: "menu", name: "Menu & products", file: "components/MenuManager.tsx", panel: "menu", tables: ["products"], perm: "0351 products policies; crew 86 only (products_crew_86_only)" },
  { key: "merch", name: "The Shop · merch", file: "components/MerchManager.tsx", panel: "merch", tables: ["shop_products"], perm: "0382 shop products admin write" },
  { key: "shoporders", name: "The Shop · orders", file: "components/ShopOrders.tsx", panel: "shoporders", tables: ["shop_orders"], perm: "0313 set_shop_order_status",
    na: { 3: "one order at a time: each is sent to the printer, shipped or refunded on its own record", 4: "the same", 5: "the same", 6: "the same", 7: "a refund or a send can't be undone" } },
  { key: "resv", name: "Reserve drops", file: PAGE, fn: "ReservesAdmin", panel: "resv", tables: ["reserves"], perm: "0014 reserves admin write" },
  { key: "students", name: "GT3 Nutrition · students", file: "components/nutrition/CourseStudents.tsx", panel: "students", tables: ["program_access"], perm: "0444 course_give / course_take_back (is_admin)" },
  { key: "lessons", name: "GT3 Nutrition · lessons", file: "components/LessonsManager.tsx", panel: "lessons", tables: ["primal_lessons", "primal_modules", "primal_pillars"], perm: "0382 primal lessons admin write" },
  { key: "plans", name: "Membership plans", file: "components/PlanEditor.tsx", panel: "plans", tables: ["subscription_plans"], perm: "0351 plans admin write",
    na: { 2: "a handful of plans", 3: "a handful of plans, each changed on its own", 4: "the same", 5: "the same", 6: "the same" } },
  { key: "codes", name: "Discount codes", file: "components/CodesPanel.tsx", panel: "cust-codes", tables: ["member_benefits"], perm: "0351 benefits admin write" },
  { key: "perks", name: "Founding perks", file: "components/PerksPanel.tsx", panel: "cust-perks", tables: ["member_benefits"], perm: "0351 benefits admin write",
    na: { 2: "a handful of perks", 3: "a handful of perks", 4: "the same", 5: "the same", 6: "the same" } },
  { key: "pay", name: "Get paid", file: "components/GetPaid.tsx", panel: "pay", tables: ["invoices"], perm: "invoices staff policies",
    na: { 3: "each invoice, refund or dispute is acted on alone", 4: "the same", 5: "the same", 6: "the same" } },
  { key: "sales", name: "Sales", file: "components/Reports.tsx", panel: "sales", tables: [], perm: "read-only",
    na: { 3: "a report", 4: "a report", 5: "a report", 6: "a report", 7: "a report", 8: "a report — it changes nothing", 9: "read-only" } },
  { key: "pnl", name: "Events P&L", file: "components/EventPnlReport.tsx", panel: "pnl", tables: [], perm: "read-only",
    na: { 3: "a report", 4: "a report", 5: "a report", 6: "a report", 7: "a report", 8: "a report — it changes nothing", 9: "read-only" } },
  { key: "snapshot", name: "Subscriptions", file: "components/SnapshotReport.tsx", panel: "snapshot", tables: [], perm: "read-only",
    na: { 3: "a report", 4: "a report", 5: "a report", 6: "a report", 7: "a report", 8: "a report — it changes nothing", 9: "read-only" } },
  { key: "spend", name: "Spend vs budget", file: "components/SpendBudget.tsx", panel: "spend", tables: ["expenses", "budgets"], perm: "0209 spend policies" },
  // R51: every channel, by the day bought (components/OrderLedger) — a record; each order is changed on its own board.
  { key: "orders", name: "Orders · by the day bought", file: "components/OrderLedger.tsx", panel: "orders", tables: ["orders", "drop_orders", "delivery_orders", "business_orders", "shop_orders"], perm: "each channel's staff policies",
    na: { 3: "a record of what was bought; each order is changed on its own board (the Pass, pickups, delivery, office, the shop)", 4: "the same", 5: "the same", 6: "the same", 7: "a void or a refund is its own receipt" } },
  { key: "custbook", name: "Customer book", file: "components/CrmPanel.tsx", panel: "cust-book", tables: ["customers", "profiles"], perm: "0392 admin_set_customer_tier; 0414 admin_set_member" },
  { key: "vip", name: "Bottle-owner proofs", file: "components/VipQueue.tsx", panel: "cust-vip", tables: ["vip_verifications"], perm: "0392 vip review" },
  { key: "broadcast", name: "Broadcast", file: "components/BroadcastEditor.tsx", panel: "cust-broadcast", tables: ["broadcasts"], perm: "0351 broadcasts admin write" },
  { key: "reviews", name: "Customer reviews", file: "components/ReviewsAdmin.tsx", panel: "reviews", tables: ["reviews"], perm: "0131 reviews staff moderate" },
  { key: "offers", name: "Offer letters", file: "components/OfferLetters.tsx", panel: "offers", tables: ["offer_letters"], perm: "0281 offer approvals" },
  { key: "operators", name: "Operator agreements", file: "components/OperatorDeal.tsx", panel: "operators", tables: ["operator_agreements"], perm: "0277 agreement policies" },
  { key: "prepboard", name: "Work every open task", file: "components/PrepBoard.tsx", panel: "prep-board", tables: ["event_tasks"], perm: "0025 tasks staff write" },
  { key: "gaps", name: "Needs sorting", file: "components/ScheduleGaps.tsx", panel: "schedule-gaps", tables: ["events", "stops"], perm: "events/stops staff write" },
  { key: "shoots", name: "Shoot planning", file: "components/ShootPlanner.tsx", panel: "shoots", tables: ["shoots", "shots"], perm: "0214 shoots staff write" },
  { key: "activity", name: "Activity log", file: "components/AuditTrail.tsx", panel: "set-admintrail", tables: [], perm: "0260 audit admin read",
    na: { 3: "history is read, never changed", 4: "the same", 5: "the same", 6: "the same", 7: "the same", 8: "it is the history" } },
  { key: "lists", name: "Data & lists", file: "components/ListsPanel.tsx", panel: "set-lists", tables: ["option_sets"], perm: "0306 option sets admin write" },
  { key: "pass", name: "The Pass", file: "components/pass/ThePass.tsx", section: "now", tables: ["orders"], perm: "orders staff policies",
    na: { 3: "service: one ticket at a time, at the window", 4: "the same", 5: "the same", 6: "the same" } },
  { key: "drops", name: "Drop pickups", file: "components/DropOps.tsx", section: "command", tables: ["drop_orders"], perm: "drop orders staff write" },
  { key: "delivery", name: "Delivery ops", file: "components/DeliveryOps.tsx", section: "command", tables: ["delivery_orders"], perm: "delivery staff write",
    own: { 3: "Mark all out picks the run (DeliveryOps :298)", 4: "Mark all out", 5: "the confirm names the count (:164)", 6: "outWords names each (lib/porchRun :115)", 7: "Undo (:173)" } },
  { key: "office", name: "Office orders", file: "components/OfficeOrders.tsx", section: "command", tables: ["business_orders"], perm: "0355 business orders" },
  { key: "brew", name: "Brew planner", file: "components/BrewPlanner.tsx", section: "brew", tables: ["brew_batches"], perm: "0293 brew staff write" },
  { key: "inventory", name: "Inventory", file: "components/InventoryLibrary.tsx", section: "garage", tables: ["inventory_items"], perm: "inventory staff write" },
  { key: "gear", name: "Gear library", file: "components/GearLibrary.tsx", section: "garage", tables: ["assets"], perm: "assets staff write" },
  { key: "today", name: "My Day", file: "components/TodayList.tsx", section: "day", tables: ["todos"], perm: "own tasks",
    own: { 3: "the stale fold gathers them (TodayList :258)", 4: "Mark N done · Move N to next week (:299)", 5: "the count is on the button", 6: "the count of what took (:152)" } },
];

/** Every table some migration attaches 0260's log_admin_audit to — by name, or in an array a loop runs it over. */
export function auditedTables(files = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql"))) {
  const out = new Set();
  for (const f of files) {
    const sql = readFileSync(join(ROOT, "supabase/migrations", f), "utf8").replace(/^\s*--.*$/gm, "");
    // Either trail: Settings › Activity log reads 0260's admin_audit and 0042's audit_log (R49), so a table under
    // either trigger has its history on the screen.
    for (const m of sql.matchAll(/create trigger \w+\s+after[^;]*?on public\.(\w+)[^;]*?execute function public\.(?:log_admin_audit|audit_row)\(\)/gi)) out.add(m[1]);
    for (const m of sql.matchAll(/array\s*\[([^\]]+)\]([\s\S]{0,700}?)(?:log_admin_audit|audit_row)\(\)/gi)) {
      for (const t of m[1].matchAll(/'(\w+)'/g)) out.add(t[1]);
    }
  }
  return out;
}

/** One list's ten points: 1, 0 or "n/a", with what earned it. */
export function scoreList(L, { panels, audited, src }) {
  const code = L.fn ? fnBody(src, L.fn) : src;
  const kit = /<BulkBar\b/.test(code);
  const own = L.own ?? {};
  const na = L.na ?? {};
  const p = {};
  p[1] = (L.panel && panels.has(L.panel)) || L.section ? 1 : 0;
  p[2] = /type="search"|aria-label="Search|placeholder="Search|<Segmented\b|className=\{`k-chip/.test(code) ? 1 : 0;
  for (const k of [3, 4, 5, 6, 7]) p[k] = kit || own[k] ? 1 : 0;
  p[8] = L.tables.length && L.tables.every((t) => audited.has(t)) ? 1 : 0;
  p[9] = L.perm ? 1 : 0;
  p[10] = /downloadCsv\(/.test(code) ? 1 : 0;
  for (const k of Object.keys(na)) p[k] = "n/a";
  const applies = Object.values(p).filter((v) => v !== "n/a");
  return { points: p, score: applies.reduce((a, b) => a + b, 0), of: applies.length };
}

// ── THE FLOOR: each list's score as it stands (R48). Only up — raise a row in the same change that earns it. ──
// R49: twenty-one rows up a point — history (8) now counts 0042's audit_log, which the Activity log reads since R49, and
// 0446 put nine more tables under it; the Activity log is searchable (2), so it is 4/4.
// R50: every list exports what it shows (10), and eleven more are searchable (2) — 27 rows up.
export const FLOOR = {
  menu: "10/10", merch: "10/10", shoporders: "5/5", resv: "5/10", students: "5/10", lessons: "5/10", plans: "4/5", codes: "5/10", perks: "4/5",
  pay: "5/6", sales: "3/3", pnl: "3/3", snapshot: "3/3", spend: "4/10", orders: "5/5", custbook: "4/10", vip: "4/10", broadcast: "5/10",
  reviews: "5/10", offers: "5/10", operators: "5/10", prepboard: "5/10", gaps: "5/10", shoots: "5/10", activity: "4/4", lists: "5/10",
  pass: "5/6", drops: "5/10", delivery: "10/10", office: "5/10", brew: "5/10", inventory: "5/10", gear: "5/10", today: "9/10",
};

export function run(list = false) {
  const panels = new Set([...read("lib/panelIndex.ts").matchAll(/\{ id: "([a-z0-9-]+)", section:/g)].map((m) => m[1]));
  const pageIds = new Set([...read(PAGE).matchAll(/<Panel id="([a-z0-9-]+)"/g)].map((m) => m[1]));
  const audited = auditedTables();
  const problems = [];
  const missingPanels = [...pageIds].filter((id) => !panels.has(id));
  const stalePanels = [...panels].filter((id) => !pageIds.has(id));
  if (missingPanels.length) problems.push(`not findable: ${missingPanels.join(", ")} — add each to lib/panelIndex (its title and the words someone looking for it types)`);
  if (stalePanels.length) problems.push(`lib/panelIndex names panels that are gone: ${stalePanels.join(", ")}`);
  const rows = [];
  let ten = 0;
  for (const L of LISTS) {
    const s = scoreList(L, { panels, audited, src: read(L.file) });
    const got = `${s.score}/${s.of}`;
    const floor = FLOOR[L.key];
    rows.push({ L, s, got });
    if (s.score === s.of) ten++;
    if (!floor) { problems.push(`${L.name}: no floor recorded — add ${L.key}: "${got}" to FLOOR`); continue; }
    const [fs, fo] = floor.split("/").map(Number);
    if (s.of !== fo) problems.push(`${L.name}: scored out of ${s.of}, the floor is out of ${fo} — a point's n/a changed; say why in LISTS and set the floor to ${got}`);
    else if (s.score < fs) problems.push(`${L.name}: ${got} — below its floor ${floor}. A list never goes down.`);
    else if (s.score > fs) problems.push(`${L.name}: ${got} — above its floor ${floor}. Good; now raise the floor to ${got}.`);
  }
  console.log(`CONSOLE AUDIT: ${LISTS.length} lists · ${ten} at 10/10 of what applies · ${pageIds.size} panels, ${pageIds.size - missingPanels.length} findable by name`);
  if (list) for (const { L, s, got } of rows) {
    const miss = Object.entries(s.points).filter(([, v]) => v === 0).map(([k]) => k);
    console.log(`  ${got.padStart(5)}  ${L.name}${miss.length ? `  — missing ${miss.join(", ")}` : ""}`);
  }
  for (const p of problems) console.log(`  ✗ ${p}`);
  if (problems.length) process.exit(1);
  console.log("CONSOLE AUDIT: clean — no list below its floor, every panel findable.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) run(process.argv.includes("--list"));
