// NET+ menu — single source of truth, ported from gt3pb-app-v3.html.
// Categories: ACTIVATE (S1) · HYDRATE (S2) · REBUILD (S3).
// Descriptions are quality-attribute only — no supplier names. Base claim: "Nothing toxic."

export type DrinkId = "rise" | "flow" | "dusk" | "tide" | "forge" | "hunt" | "wild";

export interface DrinkDetail {
  n: string;
  px: string;
  grad: string;
  has: string[];
  no: string[];
  when: "BEFORE" | "DURING" | "AFTER";
  whenT: string;
}

export const DRINKS: Record<DrinkId, DrinkDetail> = {
  rise: { n: "RISE", px: "$7", grad: "linear-gradient(140deg,#7a5c3a,#caa46d)", has: ["Single-origin cold brew", "Mineral water base", "Organic coconut"], no: ["Sugar", "Dairy", "Syrups", "Preservatives"], when: "BEFORE", whenT: "Smooth, bright lift to start the work." },
  flow: { n: "FLOW", px: "$7", grad: "linear-gradient(140deg,#3a2418,#6b4429)", has: ["Single-origin cold brew", "Mineral water base", "Organic cacao nibs"], no: ["Sugar", "Dairy", "Syrups", "Preservatives"], when: "BEFORE", whenT: "Deep, focused energy for heads-down work." },
  dusk: { n: "DUSK", px: "$7", grad: "linear-gradient(140deg,#5a3826,#9c6b3f)", has: ["Single-origin cold brew", "Mineral water base", "Ceylon cinnamon", "Cardamom"], no: ["Sugar", "Dairy", "Syrups", "Preservatives"], when: "BEFORE", whenT: "Warm-spice cup for the back half of the day." },
  tide: { n: "TIDE", px: "$8", grad: "linear-gradient(140deg,#2f7d74,#79c7bb)", has: ["Organic young coconut water", "Organic young Thai coconut meat", "Fresh-blended to order"], no: ["Marine collagen", "Powders", "Added sugar", "Concentrate"], when: "DURING", whenT: "Whole-coconut hydration to keep you moving." },
  forge: { n: "FORGE", px: "$9", grad: "linear-gradient(140deg,#7a2420,#b8423c)", has: ["Slow-simmered beef bone broth", "Pasture-raised collagen base"], no: ["Bouillon", "Additives", "Powders", "Filler"], when: "AFTER", whenT: "Rich, grounding rebuild after the work." },
  hunt: { n: "HUNT", px: "$9", grad: "linear-gradient(140deg,#5c3a52,#8a5c7d)", has: ["Slow-simmered bison bone broth", "Pasture-raised collagen base"], no: ["Bouillon", "Additives", "Powders", "Filler"], when: "AFTER", whenT: "Lean, mineral-rich recovery." },
  wild: { n: "WILD", px: "$9", grad: "linear-gradient(140deg,#6b5a2f,#a89150)", has: ["Slow-simmered ostrich bone broth", "Pasture-raised collagen base"], no: ["Bouillon", "Additives", "Powders", "Filler"], when: "AFTER", whenT: "Clean, rare protein for a lighter rebuild." },
};

// Menu list rows (swatch label + short blurb) grouped by category.
export interface MenuRow { id: DrinkId; blurb: string }
export interface MenuCategory { sx: string; name: string; wn: string; rows: MenuRow[] }

export const MENU: MenuCategory[] = [
  { sx: "S1", name: "Activate", wn: "before the work", rows: [
    { id: "rise", blurb: "Organic coconut · smooth + bright" },
    { id: "flow", blurb: "Organic cacao nibs · deep + focused" },
    { id: "dusk", blurb: "Ceylon cinnamon + cardamom" },
  ]},
  { sx: "S2", name: "Hydrate", wn: "during the work", rows: [
    { id: "tide", blurb: "Young coconut · no marine collagen" },
  ]},
  { sx: "S3", name: "Rebuild", wn: "after the work", rows: [
    { id: "forge", blurb: "Pasture-raised beef · rich" },
    { id: "hunt", blurb: "Free-range bison · lean + mineral" },
    { id: "wild", blurb: "Free-range ostrich · clean + rare" },
  ]},
];
