// GT3 menu — single source of truth.
// Pillars: ACTIVATION (before) · HYDRATION (during) · FUEL (after).
// Copy is ingredient-led: name → what it is (extraction + whole-food input) → why it exists.

export type DrinkId = "rise" | "flow" | "dusk" | "kingme" | "maple" | "tide" | "aide" | "forge" | "hunt" | "wild";

export interface DrinkDetail {
  n: string;
  px: string;             // last-resort fallback only — products.price_cents is the price authority (0062);
                           // every live price display/charge reads that first, via /api/menu or a direct query
  grad: string;          // retained for swatches elsewhere (Today / generator)
  dot: string;           // tasting-dot color — the only color in the menu list
  lines: string[];       // what it is: extraction + whole-food input
  why: string;           // why it exists — one line, no hype
  tag?: string;          // optional editorial anchor for newcomers, e.g. "Start here"
  has: string[];
  no: string[];
  when: "BEFORE" | "DURING" | "AFTER";
  whenT: string;
}

export const DRINKS: Record<DrinkId, DrinkDetail> = {
  rise: {
    n: "RISE", px: "$10", grad: "linear-gradient(140deg,#7a5c3a,#caa46d)", dot: "#C49A5E",
    lines: ["Cold-extracted coffee in mineral water","Finished with Organic Coconut Water"],
    why: "A clean, even lift to start the morning.",
    tag: "Order here",
    has: ["Single-origin cold extraction", "Mineral water base", "Organic coconut water"],
    no: ["Sugar", "Dairy", "Syrups", "Preservatives"],
    when: "BEFORE", whenT: "Morning, before the first task.",
  },
  flow: {
    n: "FLOW", px: "$10", grad: "linear-gradient(140deg,#3a2418,#6b4429)", dot: "#6B4429",
    lines: ["Cold-extracted coffee in mineral water","Infused with Organic Cacao Nibs"],
    why: "Cacao to keep the focus going a little longer.",
    has: ["Single-origin cold extraction", "Mineral water base", "Organic cacao nibs"],
    no: ["Sugar", "Dairy", "Syrups", "Preservatives"],
    when: "BEFORE", whenT: "Before deep, heads-down work.",
  },
  dusk: {
    n: "DUSK", px: "$10", grad: "linear-gradient(140deg,#5a3826,#9c6b3f)", dot: "#9C6B3F",
    lines: ["Cold-extracted coffee in mineral water","Ceylon Cinnamon · Green Cardamom"],
    why: "Cinnamon and cardamom for a warmer, spiced cup.",
    has: ["Single-origin cold extraction", "Mineral water base", "Ceylon cinnamon", "Green cardamom"],
    no: ["Sugar", "Dairy", "Syrups", "Preservatives"],
    when: "BEFORE", whenT: "Afternoon, when you want a warmer cup with the same lift.",
  },
  kingme: {
    n: "KING ME", px: "$14", grad: "linear-gradient(140deg,#2b1c12,#5c4632)", dot: "#6B4429",
    lines: ["FLOW brew served on nitrogen","Velvety, naturally creamy, subtly sweet"],
    why: "A sensory phenomenon — texture and microbubbles, nothing added.",
    tag: "Nitro",
    has: ["FLOW cold-extraction", "Nitrogen infusion"],
    no: ["Sugar", "Dairy", "Syrups", "Preservatives"],
    when: "BEFORE", whenT: "The same clean lift, with a creamy nitro texture.",
  },
  maple: {
    n: "SALTED MAPLE LATTE", px: "$14", grad: "linear-gradient(140deg,#5a3826,#b8902f)", dot: "#B8902F",
    lines: ["Organic A2 grass-fed goat milk","Organic maple · Sea salt"],
    why: "Rich, naturally sweet and smooth.",
    has: ["Organic A2 grass-fed goat milk", "Organic maple syrup", "Sea salt"],
    no: ["Refined sugar", "Seed oils", "Preservatives"],
    when: "BEFORE", whenT: "An afternoon treat that still eats clean.",
  },
  tide: {
    n: "TIDE", px: "$12", grad: "linear-gradient(140deg,#2f7d74,#79c7bb)", dot: "#2F7D74",
    lines: ["Young coconut water + young organic Thai coconut meat", "Finished with organic local honey"],
    why: "Real hydration that goes down easy.",
    has: ["Organic young coconut water", "Young organic Thai coconut meat", "Organic local honey", "Blended to order"],
    no: ["Marine collagen", "Powders", "Concentrate"],
    when: "DURING", whenT: "During work or training.",
  },
  aide: {
    n: "NATURE'S AIDE", px: "$10", grad: "linear-gradient(140deg,#a97c3f,#c8a661)", dot: "#A97C3F",
    lines: ["Coconut water + mineral water", "Organic maple · Sea salt"],
    why: "Light, balanced hydration for the middle of the work.",
    has: ["Coconut water", "Mineral water", "Organic maple syrup", "Sea salt"],
    no: ["Powders", "Concentrate", "Dyes"],
    when: "DURING", whenT: "During work or training.",
  },
  forge: {
    n: "FORGE", px: "$10", grad: "linear-gradient(140deg,#7a2420,#b8423c)", dot: "#B8423C",
    lines: ["Slow-Simmered Beef Bone Broth", "Pasture-Raised"],
    why: "Deep and rich, full of minerals for the rebuild.",
    has: ["Slow-simmered beef bone broth", "Pasture-raised"],
    no: ["Bouillon", "Additives", "Powders", "Filler"],
    when: "AFTER", whenT: "After training, within the hour.",
  },
  hunt: {
    n: "HUNT", px: "$10", grad: "linear-gradient(140deg,#5c3a52,#8a5c7d)", dot: "#8A5C7D",
    lines: ["Slow-Simmered Bison Bone Broth", "Pasture-Raised"],
    why: "Leaner than beef, with a little more iron and zinc.",
    has: ["Slow-simmered bison bone broth", "Pasture-raised"],
    no: ["Bouillon", "Additives", "Powders", "Filler"],
    when: "AFTER", whenT: "After training, within the hour.",
  },
  wild: {
    n: "WILD", px: "$10", grad: "linear-gradient(140deg,#6b5a2f,#a89150)", dot: "#A89150",
    lines: ["Slow-Simmered Ostrich Bone Broth", "Pasture-Raised"],
    why: "A lighter, leaner broth for an easy rebuild.",
    has: ["Slow-simmered ostrich bone broth", "Pasture-raised"],
    no: ["Bouillon", "Additives", "Powders", "Filler"],
    when: "AFTER", whenT: "After a lighter session, or in the evening.",
  },
};

// Menu pillars — permanent brand architecture.
export interface MenuCategory { name: string; wn: string; rows: DrinkId[] }

// Full standard line: Activate coffees + specialties, the two hydrations, and the Fuel broths.
export const MENU: MenuCategory[] = [
  { name: "Activation", wn: "Before the work", rows: ["rise", "flow", "dusk", "kingme", "maple"] },
  { name: "Hydration", wn: "During the work", rows: ["tide", "aide"] },
  { name: "Fuel", wn: "After the work", rows: ["forge", "hunt", "wild"] },
];
