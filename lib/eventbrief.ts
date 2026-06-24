import type { EventRow } from "./db";
import type { Projection } from "./economics";

// Event Brief — turns the event's config (menu + attendance + rig + crew) into
// real prep intelligence: how much to brew/pack, the ingredient pull, whether the
// crew can handle the volume, a readiness score, and live risk flags. Pure logic
// over the data already in the DB (event_economics + product_economics drive the
// projection). Yield/ingredient factors are honest ESTIMATES — refine them from
// the GT3 Brew Lab + Inventory databases as those sync in.

const THROUGHPUT_PER_CREW_HR = 35; // units one person can serve per hour at the bar

// per-line prep yield (how projected units become a brew/pack instruction)
const PREP: Record<string, (u: number) => string> = {
  nitro: (u) => `Charge ${Math.max(1, Math.ceil(u / 64))} keg${u > 64 ? "s" : ""} · ~${(u * 10 / 128).toFixed(1)} gal cold brew`,
  bottles: (u) => `Pack ${Math.ceil(u * 1.1)} bottles (units + 10% buffer)`,
  nature_aid: (u) => `~${u} servings · ${Math.ceil(u / 8)} case${u > 8 ? "s" : ""} coconut water + meat`,
  salted_maple: (u) => `${u} servings · cold-brew base + maple/salt build`,
  broth: (u) => `Simmer ${u} cups · ${Math.max(1, Math.ceil(u / 16))} batch${u > 16 ? "es" : ""}`,
};
const PREP_DEFAULT = (u: number) => `${u} servings`;

function ingredientNeeds(lines: { key: string; units: number }[]): IngredientNeed[] {
  const sum = (keys: string[]) => lines.filter((l) => keys.includes(l.key)).reduce((s, l) => s + l.units, 0);
  const out: IngredientNeed[] = [];
  const coffee = sum(["nitro", "salted_maple", "cold_extract"]);
  const coconut = sum(["nature_aid", "coconut_shake"]);
  const broth = sum(["broth"]);
  const bottles = sum(["bottles"]);
  if (coffee > 0) out.push({ name: "Coffee beans", qty: `~${(coffee * 0.045).toFixed(1)} lb · 1:13 cold extract` });
  if (coconut > 0) { out.push({ name: "Coconut water + meat", qty: `~${Math.ceil(coconut * 0.9)} servings` }); out.push({ name: "Raw honey", qty: `~${Math.max(1, Math.round(coconut * 0.3))} oz` }); }
  if (broth > 0) out.push({ name: "Bone broth", qty: `~${(broth * 8 / 128).toFixed(1)} gal slow-simmered` });
  if (bottles > 0) out.push({ name: "Empty bottles + caps", qty: `${Math.ceil(bottles * 1.1)} ea` });
  out.push({ name: "Bottles · lids · ice", qty: "per pack list" });
  return out;
}

export interface PrepLine { key: string; label: string; units: number; prep: string }
export interface IngredientNeed { name: string; qty: string }
export interface RiskFlag { level: "high" | "med" | "info"; text: string }
export interface EventBrief {
  projectedUnits: number;
  projectedGuests: number;
  prep: PrepLine[];
  ingredients: IngredientNeed[];
  crewNeeded: number;
  crewHave: number;
  crewOk: boolean;
  readiness: number; // 0-100
  risks: RiskFlag[];
}

export function buildBrief(e: EventRow, proj: Projection): EventBrief {
  const prep: PrepLine[] = proj.lines.map((l) => {
    const u = Math.round(l.units);
    return { key: l.key, label: l.label, units: u, prep: (PREP[l.key] ?? PREP_DEFAULT)(u) };
  });
  const ingredients = ingredientNeeds(prep);
  const hours = Math.max(0, e.duration_hrs ?? 0);
  const crewNeeded = hours > 0 ? Math.max(1, Math.ceil(proj.projectedUnits / (THROUGHPUT_PER_CREW_HR * hours))) : 0;
  const crewHave = Math.max(0, e.staff_count ?? 0);
  const crewOk = crewNeeded === 0 || crewHave >= crewNeeded;

  const risks: RiskFlag[] = [];
  if ((e.expected_attendance ?? 0) === 0 || hours === 0) risks.push({ level: "info", text: "Set expected attendance + hours to forecast demand and crew." });
  if (proj.enabledLines === 0) risks.push({ level: "info", text: "Turn on the menu lines you'll pour to build the prep list." });
  if (e.water_available === false) risks.push({ level: "high", text: "No water on site — handwash station is mandatory." });
  if (!crewOk && crewNeeded > 0) risks.push({ level: "high", text: `Understaffed: ~${crewNeeded} crew needed for ${Math.round(proj.projectedUnits)} units over ${hours}h, you have ${crewHave}.` });
  if (!e.state) risks.push({ level: "med", text: "No jurisdiction set — confirm the temporary food permit before the event." });
  if (e.rig === "trailer_plus_cart") risks.push({ level: "med", text: "Trailer rig — bring a COI naming the venue as additional insured." });

  // readiness = share of the gating checks that are resolved
  const checks = [
    proj.enabledLines > 0,
    !!e.state,
    crewOk && crewNeeded > 0,
    e.water_available !== false,
    (e.expected_attendance ?? 0) > 0 && hours > 0,
  ];
  const readiness = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  return {
    projectedUnits: Math.round(proj.projectedUnits),
    projectedGuests: Math.round(proj.projectedGuests),
    prep, ingredients, crewNeeded, crewHave, crewOk, readiness, risks,
  };
}
