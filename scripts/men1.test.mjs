// MEN1 — MENU & ECONOMICS: the arithmetic and the rules, tested on their own (the database's part in db.men1.test).
import { loadTs } from "./search.read.mjs";
const M = loadTs("lib/menuEconomics.ts");
let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}${got !== undefined ? ` → ${JSON.stringify(got)}` : ""}`); } };
const A = (o = {}) => ({ ...M.NO_ASSUMPTIONS, ...o });

// contribution
const full = M.contribution({ priceCents: 1000, ingredients: { cents: 180, uncosted: 0, hasRecipe: true }, a: A({ packaging_cents: 60, packaging_basis: "estimated", waste_pct: 10, waste_basis: "estimated", service_seconds: 90, service_basis: "estimated" }), cardFeePct: 3, labourCentsPerHour: 2400 });
ok("contribution = price − ingredients − packaging − waste − fees − labour", full.contributionCents === 1000 - 180 - 60 - 18 - 30 - 60, full.contributionCents);
ok("…margin to a tenth of a percent", full.marginPct === 65.2, full.marginPct);
ok("…complete when every line is known", full.complete && full.missing.length === 0, full.missing);
const noRecipe = M.contribution({ priceCents: 1000, ingredients: { cents: 0, uncosted: 0, hasRecipe: false }, a: A({ packaging_cents: 60, packaging_basis: "actual" }), cardFeePct: 3 });
ok("no bill of materials → no contribution figure, and says why", noRecipe.contributionCents === null && noRecipe.missing.some((m) => /ingredients/.test(m)), noRecipe.missing);
const uncosted = M.contribution({ priceCents: 1000, ingredients: { cents: 120, uncosted: 2, hasRecipe: true }, a: A({ packaging_cents: 60, packaging_basis: "actual" }), cardFeePct: 3 });
ok("an ingredient without a cost → ingredients unknown (never zeroed)", uncosted.contributionCents === null && uncosted.lines[0].cents === null && uncosted.missing.includes("ingredients (2 without a cost)"), uncosted);
const noPack = M.contribution({ priceCents: 1000, ingredients: { cents: 180, uncosted: 0, hasRecipe: true }, a: A(), cardFeePct: 3 });
ok("packaging unknown → no figure", noPack.contributionCents === null && noPack.missing.includes("packaging and vessel"));
const noLabour = M.contribution({ priceCents: 1000, ingredients: { cents: 180, uncosted: 0, hasRecipe: true }, a: A({ packaging_cents: 60, packaging_basis: "actual" }), cardFeePct: null });
ok("labour, waste and fees unknown → a figure before them, each named missing", noLabour.contributionCents === 760 && ["waste", "card fees", "service labour"].every((m) => noLabour.missing.includes(m)) && !noLabour.complete, noLabour);
ok("an incomplete figure is never called complete", !noLabour.complete);

// reusable glass
ok("a reusable glass per use = wash + price × loss", M.reusablePerUse({ wash_cents: 12, loss_pct: 5, vessel_cents: 600 }) === 42);
ok("…unknown if any part is", M.reusablePerUse({ wash_cents: 12, loss_pct: null, vessel_cents: 600 }) === null);
const glass = M.contribution({ priceCents: 1000, ingredients: { cents: 180, uncosted: 0, hasRecipe: true }, a: A({ reusable: true, wash_cents: 12, loss_pct: 5, vessel_cents: 600 }), cardFeePct: 0 });
ok("…and is the vessel line for a reusable product", glass.lines[1].cents === 42 && /Reusable/.test(glass.lines[1].label));

// per 10 oz pour
ok("per 10 oz: a 16 oz serving's 320¢ is 200¢ a pour", M.perPour(320, 16) === 200);
ok("…a 10 oz serving is itself", M.perPour(180, 10) === 180);
ok("…unknown size, unknown figure (never assumed 10 oz)", M.perPour(180, null) === null);

// the standard's aggregation rule
const C = [{ id: "a", code: "F-1", mandatory: true }, { id: "b", code: "F-2", mandatory: true }, { id: "c", code: "F-9", mandatory: false }];
const as = (id, outcome, o = {}) => ({ criterion_id: id, outcome, stale_at: null, verification: "independent", ...o });
ok("nothing judged → Not assessed", M.standardStatus(C, []).status === "not_assessed");
ok("a mandatory fail → Does not meet, whatever else passed", M.standardStatus(C, [as("a", "fail"), as("b", "pass")]).status === "does_not_meet");
ok("one mandatory judged, one not → Conditional (never green)", M.standardStatus(C, [as("a", "pass")]).status === "conditional");
ok("…and names the unjudged one", M.standardStatus(C, [as("a", "pass")]).open.includes("F-2: not judged"));
ok("a stale pass → Conditional", M.standardStatus(C, [as("a", "pass"), as("b", "pass", { stale_at: "2026-10-30" })]).status === "conditional");
ok("a proposed (unverified) pass → Conditional", M.standardStatus(C, [as("a", "pass"), as("b", "pass", { verification: "proposed" })]).status === "conditional");
ok("an unknown outcome → Conditional", M.standardStatus(C, [as("a", "pass"), as("b", "unknown")]).status === "conditional");
ok("all mandatory passed, current, verified → Meets", M.standardStatus(C, [as("a", "pass"), as("b", "pass")]).status === "meets");
ok("an optional fail doesn't lower it — but it is listed", (() => { const r = M.standardStatus(C, [as("a", "pass"), as("b", "pass"), as("c", "fail")]); return r.status === "meets" && r.failed.includes("F-9"); })());
ok("not applicable counts as judged, not as a pass of something else", M.standardStatus(C, [as("a", "pass"), as("b", "not_applicable")]).status === "meets");
ok("no mandatory criteria at all → Not assessed (never green by default)", M.standardStatus([{ id: "c", code: "F-9", mandatory: false }], [as("c", "pass")]).status === "not_assessed");

// readiness
const r = M.readiness(["cold_dispense", "cold_storage", "dish_wash"], ["tap_tower", "reach_in"], "conditional");
ok("readiness: what the room provides, by explicit capability", r.drawn.includes("cold_dispense") && r.drawn.includes("cold_storage"));
ok("…the gap, in words", r.gaps.length === 1 && /ware washing/.test(r.gaps[0]), r.gaps);
ok("…and the gates a drawing can't answer, named", r.otherGates.some((g) => /qualification/.test(g)) && r.otherGates.some((g) => /Permits/.test(g)));
ok("a label doesn't provide a capability (only the kind does)", M.capabilitiesOf(["community"]).size === 0);
ok("removing the object removes the capability", M.readiness(["cold_dispense"], [], "meets").gaps.length === 1);

// scenarios
const mix = [{ productId: "r", sharePct: 60, priceCents: 1000, contributionCents: 600, serviceSeconds: 60 }, { productId: "t", sharePct: 40, priceCents: 1200, contributionCents: 700, serviceSeconds: 90 }];
const day = M.dayOf(mix, 100, 3);
ok("a day: revenue and contribution from the mix", day.revenueCents === 108000 && day.contributionCents === 64000, day);
ok("…crew hours used, and no problem when it fits", day.busyHours === 2 && !day.overCapacity && day.problems.length === 0, day);
ok("demand the crew can't make is flagged", M.dayOf(mix, 300, 3).overCapacity);
ok("a mix that doesn't add to 100 is a problem", M.dayOf([{ ...mix[0], sharePct: 70 }, mix[1]], 100, 8).problems.some((p) => /adds to 110/.test(p)));
ok("an unknown contribution leaves the day's contribution unknown", M.dayOf([{ ...mix[0], contributionCents: null }, mix[1]], 100, 8).contributionCents === null);
ok("an unknown service time leaves capacity unknown (not assumed)", M.dayOf([{ ...mix[0], serviceSeconds: null }, mix[1]], 100, 8).busyHours === null);

console.log(`MEN1 — MENU & ECONOMICS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
