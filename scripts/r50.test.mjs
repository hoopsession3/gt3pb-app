// R50 — EVERY LIST, AS A FILE, AND FOUND BY TYPING (2026-10-24 — Ryan: "10 out of 10… no less than 10… make that our
// baseline standard"; the console audit, scripts/console.audit.mjs, points 10 and 2).
//
//   1 · twenty-six lists export what they show (lib/csv downloadCsv — a cell is text, never a formula), each its own file.
//   2 · eleven more are searched by typing — every typed word must be in the row — with "No matches" said, and a short hint.
//   3 · the floor: every list that rose is held there.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const fnBody = (src, name) => { const at = src.indexOf(`\nfunction ${name}(`); const rest = src.slice(at + 1); const end = rest.slice(1).search(/\n(?:export )?(?:async )?function /); return end < 0 ? rest : rest.slice(0, end + 1); };

// ── 1 · exports ──────────────────────────────────────────────────────────────────────────────────────────────────────
const EXPORTS = {
  "components/ShopOrders.tsx": "gt3-shop-orders.csv", "components/LessonsManager.tsx": "gt3-lessons.csv", "components/PlanEditor.tsx": "gt3-plans.csv",
  "components/CodesPanel.tsx": "gt3-codes.csv", "components/PerksPanel.tsx": "gt3-perks.csv", "components/GetPaid.tsx": "gt3-get-paid.csv",
  "components/EventPnlReport.tsx": "gt3-event-pnl.csv", "components/SnapshotReport.tsx": "gt3-subscriptions.csv", "components/VipQueue.tsx": "gt3-vip-proofs.csv",
  "components/BroadcastEditor.tsx": "gt3-broadcasts.csv", "components/OfferLetters.tsx": "gt3-offer-letters.csv", "components/OperatorDeal.tsx": "gt3-operator-agreements.csv",
  "components/PrepBoard.tsx": "gt3-prep.csv", "components/ScheduleGaps.tsx": "gt3-needs-sorting.csv", "components/ShootPlanner.tsx": "gt3-shoots.csv",
  "components/ListsPanel.tsx": "gt3-lists.csv", "components/pass/ThePass.tsx": "gt3-pass.csv", "components/DeliveryOps.tsx": "gt3-delivery.csv",
  "components/OfficeOrders.tsx": "gt3-office-orders.csv", "components/InventoryLibrary.tsx": "gt3-inventory.csv", "components/GearLibrary.tsx": "gt3-gear.csv",
  "components/TodayList.tsx": "gt3-my-day.csv",
};
const missing = Object.entries(EXPORTS).filter(([f, name]) => !read(f).includes(`"${name}"`) || !/downloadCsv\(/.test(read(f)) || !/from "@\/lib\/csv"/.test(read(f)));
ok("each list exports what it shows, a file of its own", missing.length === 0, missing.map(([f]) => f));
ok("…and the ones whose file is named by what's open: Sales by its window, Reviews by its tab, the brew planner by its view, a drop by its date",
  /gt3-sales-/.test(read("components/Reports.tsx")) && /gt3-reviews-/.test(read("components/ReviewsAdmin.tsx")) && /gt3-brew-(schedule|log)|gt3-brew-\$\{/.test(read("components/BrewPlanner.tsx"))
    && /gt3-drop-/.test(read("components/DropOps.tsx")) && /downloadCsv\("gt3-reserves\.csv"/.test(fnBody(read("app/crew/page.tsx"), "ReservesAdmin")));
const enabled = Object.keys(EXPORTS).filter((f) => /Export CSV/.test(read(f)) && !/disabled=\{[^}]*(length|!)/.test(read(f).slice(read(f).indexOf("downloadCsv(") - 600, read(f).indexOf("downloadCsv(") + 1600)));
ok("an export with nothing to export is held still", enabled.length === 0, enabled);
ok("what isn't the list's stays out of its file: no photo address in the proofs', no pay in the offer letters'",
  !/storage_path|photo_url|image_url/.test(read("components/VipQueue.tsx").slice(read("components/VipQueue.tsx").indexOf("gt3-vip-proofs.csv") - 50, read("components/VipQueue.tsx").indexOf("gt3-vip-proofs.csv") + 900))
    && !/salary|pay_cents|rate_cents|wage/.test(read("components/OfferLetters.tsx").slice(read("components/OfferLetters.tsx").indexOf("gt3-offer-letters.csv") - 50, read("components/OfferLetters.tsx").indexOf("gt3-offer-letters.csv") + 900)));
ok("no new inline style objects came with them (the CSS audit holds the count)", Object.keys(EXPORTS).every((f) => !/style=\{\{[^}]*\}\}>Export CSV/.test(read(f))));

// ── 2 · search ───────────────────────────────────────────────────────────────────────────────────────────────────────
const SEARCH = ["components/LessonsManager.tsx", "components/GetPaid.tsx", "components/EventPnlReport.tsx", "components/SnapshotReport.tsx", "components/VipQueue.tsx",
  "components/BroadcastEditor.tsx", "components/OfferLetters.tsx", "components/ScheduleGaps.tsx", "components/DeliveryOps.tsx", "components/OfficeOrders.tsx"];
const searchless = [...SEARCH.map((f) => [f, read(f)]), ["ReservesAdmin", fnBody(read("app/crew/page.tsx"), "ReservesAdmin")]]
  .filter(([, src]) => !/type="search"/.test(src) || !/enterKeyHint="search"/.test(src) || !/\.split\(\/\\s\+\/\)\.filter\(Boolean\)/.test(src) || !/No matches/.test(src));
ok("eleven more lists are searched by typing — every word in the row — and say when nothing matches", searchless.length === 0, searchless.map(([f]) => f));
const longHints = [...SEARCH.map((f) => read(f)), fnBody(read("app/crew/page.tsx"), "ReservesAdmin")]
  .flatMap((src) => [...src.matchAll(/type="search"[^>]*?placeholder="([^"]+)"|placeholder="([^"]+)"[^>]*?type="search"/g)].map((m) => m[1] ?? m[2])).filter((p) => p.length > 18);
ok("a search's hint fits a phone's field (18 characters at most)", longHints.length === 0, longHints);

// ── 3 · the floor ────────────────────────────────────────────────────────────────────────────────────────────────────
const A = await import(join(ROOT, "scripts/console.audit.mjs"));
const F = A.FLOOR;
ok("the floor holds what R50 earned: the reports and the shop's orders whole, delivery 10/10, and every list whole or at 4 or more",
  F.shoporders === "5/5" && F.sales === "3/3" && F.pnl === "3/3" && F.snapshot === "3/3" && F.delivery === "10/10" && F.today === "9/10" && F.pay === "5/6"
    && Object.values(F).every((v) => { const [a, b] = v.split("/").map(Number); return a === b || a >= 4; }), F);
ok("this file runs with the rest", /node scripts\/r49\.test\.mjs && node scripts\/r50\.test\.mjs/.test(JSON.parse(read("package.json")).scripts.test));

console.log(`R50 — EVERY LIST, AS A FILE, AND FOUND BY TYPING: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
