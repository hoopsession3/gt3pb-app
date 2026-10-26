// R62 — WHAT SELLS DRIVES THE MARGIN, AND ONE CAPITAL PICTURE (2026-10-25 — the traceability audit's gaps 7 and 4: "Gross
// margin → product sales → ingredient costs → packaging → other direct costs → gross profit → gross margin"; the
// roadmap's asks and the plan's funding were two lists).
//
//   1 · The mix by hand: average order and cost of goods from each product's share, price, ingredients and packing.
//   2 · It drives the 36 months live, and traces product by product; incomplete, it's named as missing — never guessed.
//   3 · The wiring: the mix editor beside the money; the roadmap's ask set from the plan's funding required, asked first.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const M = loadTs("lib/visionMoney.ts");

const mix = [{ key: "cold", label: "Cold brew", sharePct: 60, priceCents: 600, unitCostCents: 120, packagingCents: 30 },
  { key: "broth", label: "Bone broth", sharePct: 40, priceCents: 800, unitCostCents: 250, packagingCents: 50 }];
const base = M.toInputs({ ordersPerDay: 100, avgOrderCents: 900, daysOpenPerMonth: 30, cogsPct: 25, staffHoursPerDay: 20, wageCents: 1500, mix, itemsPerOrder: 1.5 });
{
  const x = M.mixOf(base);
  ok("per item: 60% × $6 + 40% × $8 = $6.80; an order of 1.5 items = $10.20", x.aovCents === 1020 && x.problems.length === 0, x);
  ok("cost of goods: (60% × $1.50 + 40% × $3.00) ÷ $6.80 = 30.88%", near(x.cogsPct, (210 / 680) * 100), x.cogsPct);
  ok("shares that don't add to 100 are named", M.mixOf({ mix: [{ ...mix[0], sharePct: 50 }, mix[1]], itemsPerOrder: 1 }).problems[0].includes("90%"));
  ok("a product without its cost is named — nothing is filled in", /Bone broth needs a price and a cost/.test(M.mixOf({ mix: [mix[0], { ...mix[1], unitCostCents: null }], itemsPerOrder: 1 }).problems.join()));
}
{
  const typed = M.project(base), driven = M.project({ ...base, mixDrives: true });
  ok("typed: the typed $9 and 25% run the money", typed.months[0].revenue === 3000 * 900 && typed.grossMarginPct === 75);
  ok("from the mix: $10.20 an order and 30.88% goods run it, live", driven.months[0].revenue === 3000 * 1020 && near(driven.grossMarginPct, 100 - (210 / 680) * 100, 1e-9), [driven.months[0].revenue, driven.grossMarginPct]);
  const cheaper = M.project({ ...base, mixDrives: true, mix: [{ ...mix[0], unitCostCents: 100 }, mix[1]] });
  ok("change an ingredient cost: the margin follows, no button", cheaper.grossMarginPct > driven.grossMarginPct);
  ok("an incomplete mix that drives: the money says what's missing", !M.project({ ...base, mixDrives: true, mix: [mix[0]] }).ok && M.missing({ ...base, mixDrives: true, mix: [mix[0]] }).some((w) => /the mix \(the shares add to 60%/.test(w)));
  const t = M.trace({ ...base, mixDrives: true }, { kind: "none" }, driven);
  ok("gross margin drills product by product: price, ingredients, packing, margin", t.grossMargin.path.some((p) => /Cold brew \(60%\)/.test(p.label) && /ingredients \$1 · packing \$0/.test(p.value)) && t.grossMargin.path.some((p) => /from the mix/.test(p.label)), t.grossMargin.path);
  ok("sales drills to the mix", t.revenue.path.some((p) => /Bone broth · 40% of items/.test(p.label)));
  ok("on the one map: the mix feeds sales and cost of goods", M.DEPS.revenue.includes("mix") && M.DEPS.cogs.includes("mix") && M.upstreamInputs("roiBusiness").includes("mix"));
  ok("the what-if names the mix when it starts to drive", M.changedInputs(base, { ...base, mixDrives: true }, { kind: "none" }, { kind: "none" }).includes("mix"));
  ok("what moves it most still swings the average order under the mix", M.sensitivity({ ...base, mixDrives: true }).some((s) => s.driver === "Average order" && s.span > 0));
  ok("the R54 money is unchanged when no mix is set", M.project(M.toInputs({ ...base, mix: [] })).months[0].revenue === typed.months[0].revenue);
}
{
  const panel = read("components/vision/MoneyPanel.tsx"), mixUi = read("components/vision/Mix.tsx");
  ok("the mix sits beside the money, picked from the catalog or typed", /<MixEditor i=\{i\} set=\{set\} \/>/.test(panel) && /product_economics_live/.test(mixUi) && /A product we&apos;d add \(typed\)/.test(mixUi));
  ok("one capital picture: the roadmap's ask set from the funding required, asked first, one ask only", /const syncAsk = async/.test(panel) && /Make the roadmap's ask \$\{dollars\(m\.requiredFunding\)\}\?/.test(panel) && /several asks/.test(panel));
}
console.log(`R62 — THE MIX AND ONE CAPITAL PICTURE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
