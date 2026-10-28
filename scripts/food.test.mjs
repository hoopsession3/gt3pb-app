// PF1 — PRIMAL FOOD, PLANNED (2026-10-28 — Ryan: "Primal Food is a planned future expansion targeted for Q2–Q3 2027… Do
// not implement food as an active menu item… Plan it, model it, and make it interoperable"). The database (0459,
// db.food.test) is the judge; this works a portion's cost by hand and reads that the screen says what is true.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const F = loadTs("lib/food.ts");

// ── a portion, by hand ──────────────────────────────────────────────────────────────────────────────────────────────
// 170 g beef at $12.00/kg = 204¢; 200 g sweet potato at $3.00/kg = 60¢ → 264¢. 370 g raw, 15% cook loss → 314.5 g cooked.
const r = { portion_g: 320, cook_loss_pct: 15, components: [
  { name: "Beef", raw_g: 170, cost_cents_per_kg: 1200, cost_source: "test figure" },
  { name: "Sweet potato", raw_g: 200, cost_cents_per_kg: 300, cost_source: "test figure", allergens: [] },
] };
const c = F.portionCost(r);
ok("ingredients per portion, by hand: 204¢ + 60¢ = 264¢", c.ingredientCents === 264, c);
ok("raw and cooked weight: 370 g → 314.5 g at 15% loss", c.rawG === 370 && c.cookedG === 314.5, c);
ok("cooked vs the portion: 1.7% under — within a tenth, so not flagged by the screen", c.yieldGap === -1.7, c.yieldGap);
const noCost = F.portionCost({ ...r, components: [r.components[0], { name: "Salt", raw_g: 2 }] });
ok("a component with no cost makes the cost unknown — never smaller — and is named", noCost.ingredientCents === null && noCost.missing.includes("Salt"), noCost);
const noSource = F.portionCost({ ...r, components: [{ name: "Beef", raw_g: 170, cost_cents_per_kg: 1200 }] });
ok("a cost without its source doesn't count", noSource.ingredientCents === null && noSource.missing.includes("Beef"));
ok("what a $14 price leaves after ingredients: 1136¢, 81.1%", JSON.stringify(F.ingredientMargin(1400, 264)) === JSON.stringify({ leftCents: 1136, pct: 81.1 }));
ok("…and nothing when the cost or the price isn't known", F.ingredientMargin(null, 264) === null && F.ingredientMargin(1400, null) === null);
const sesame = F.portionCost({ ...r, components: [...r.components, { name: "Sesame seeds", raw_g: 3, cost_cents_per_kg: 1000, cost_source: "test", allergens: ["sesame"] }] });
ok("an allergen in a component the item doesn't declare is caught", F.undeclared({ allergens: [] }, sesame).includes("sesame") && F.undeclared({ allergens: ["sesame"] }, sesame).length === 0);
ok("the nine major allergens, and only them", F.ALLERGENS.length === 9 && F.ALLERGENS.includes("sesame") && F.ALLERGENS.includes("shellfish"));

// ── the screen says what is true ────────────────────────────────────────────────────────────────────────────────────
const lab = read("components/vision/FoodLab.tsx"), app = read("components/vision/VisionApp.tsx"), sql = read("supabase/migrations/0459_food_is_planned_before_it_is_sold.sql");
ok("it says food is planned, not on the menu, and every figure a projection", /a planned expansion, not on the menu/.test(lab) && /Every figure is a projection until an owner approves it/.test(lab));
ok("the margin says it's ingredients only", /left after ingredients/.test(lab) && /ingredients only: packaging, labor, fees and waste are not in it yet/.test(read("lib/food.ts")));
ok("food never reaches the menu from this screen — no write to products, no 'live' button", !/from\("products"\)/.test(lab) && !/status: "live"/.test(lab) && /Going on the menu is a separate step/.test(lab));
ok("owners and admins only: the Food tab sits with Standard, behind canEdit", /\{ key: "food" as const, label: "Food" \}\] : \[\]\)/.test(app) && /\{tab === "food" && canEdit && <FoodLab isOwner=\{isOwner\} \/>\}/.test(app));
ok("only owners are offered approval", /isOwner && it\.status === "proposed"/.test(lab) && /isOwner && r\.status === "draft"/.test(lab));
ok("a price and a cost each say where they came from", /Where that price came from/.test(lab) && /Where that cost came from/.test(lab) && /food_items_price_said/.test(sql));
ok("the migration sets no temperature rule of its own", !/(135|140|41|165)\s*°?\s*F/i.test(sql.replace(/^--.*$/gm, "")) && /this file sets none/.test(sql));
ok("recipes are owners' and admins' only in the database", /create policy "food recipes admin" on public\.food_recipes for all using \(\(select public\.is_admin\(\)\)\)/.test(sql));
const pkg = JSON.parse(read("package.json"));
ok("this file runs with every test, and its database half with the database's", /node scripts\/food\.test\.mjs/.test(pkg.scripts.test) && /node scripts\/db\.food\.test\.mjs/.test(pkg.scripts["db:test"]));

console.log(`PF1 — PRIMAL FOOD, PLANNED: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
