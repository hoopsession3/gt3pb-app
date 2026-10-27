// GT3 Academy — training content, authored from the governed GT3 Brand Source of
// Truth (Notion). Content lives in code so it stays versioned and honest; per-user
// progress + certifications live in Supabase (0030). Roles, certifications and
// operational-readiness are all derived from the data below.
//
// HARD RULE (from the Source of Truth / Risk Register): no unsupported
// physiological/comparative health claims. Nutrition is "estimated" until lab-
// verified. Rise/Flow/Dusk share one spec and the SAME caffeine (~210 mg/10 oz).
// Tide (coconut + honey hydration) contains organic local honey; Nature's Aide is coconut water + lime juice with
// organic maple + sea salt. They're SEPARATE products — disclose the sweetener either way.

export type Role = "founder" | "admin" | "event_manager" | "operator" | "staff" | "contractor";
// The GT3 Academy is built as a university — phases that take someone from zero to "would make the
// same call an owner would." Existing keys are kept; new phases extend them. Order + labels live in SECTIONS.
export type Section =
  | "welcome" | "brand" | "nutrition" | "product" | "equipment"
  | "cx" | "ops" | "excellence" | "leadership" | "philosophy"
  | "playbook" | "cookbook";

export interface SectionMeta { key: Section; phase: string; label: string; blurb: string }
export const SECTIONS: SectionMeta[] = [
  { key: "welcome",    phase: "Phase 1",  label: "Welcome to GT3",        blurb: "Who we are, why GT3 exists, and why the details matter." },
  { key: "brand",      phase: "Phase 2",  label: "Brand DNA",             blurb: "The standard we never break — Pure Signal. No Noise." },
  { key: "nutrition",  phase: "Phase 3",  label: "The Science",           blurb: "Enough to educate a guest — never to overwhelm them." },
  { key: "product",    phase: "Phase 4",  label: "Product Mastery",       blurb: "Every product, ratio, note, and recommendation." },
  { key: "equipment",  phase: "Phase 5",  label: "Equipment Mastery",     blurb: "Run, clean, and troubleshoot every system in the field." },
  { key: "cx",         phase: "Phase 6",  label: "Hospitality Excellence",blurb: "Four-Seasons service at a performance bar." },
  { key: "ops",        phase: "Phase 7",  label: "Event Operations",      blurb: "Open, run, and break down a flawless service." },
  { key: "excellence", phase: "Phase 8",  label: "Operational Excellence",blurb: "Checklists, par, waste, cost, and the numbers." },
  { key: "leadership", phase: "Phase 9",  label: "Leadership",            blurb: "Think and decide like an owner. Steward the brand." },
  { key: "philosophy", phase: "Phase 10", label: "GT3 Philosophy",        blurb: "How to think — so you can solve what no SOP covered." },
  { key: "playbook",   phase: "Playbook", label: "The GT3 Playbook",      blurb: "Why every major decision was made, not just what it was." },
  { key: "cookbook",   phase: "Reference",label: "Cookbook",              blurb: "The recipes, ratios, and specs." },
];
export const sectionMeta = (k: Section): SectionMeta => SECTIONS.find((s) => s.key === k) ?? { key: k, phase: "", label: k, blurb: "" };

export const ROLES: { key: Role; label: string; blurb: string }[] = [
  { key: "founder", label: "Founder", blurb: "Owns the brand and the standard. Sees everything." },
  { key: "admin", label: "Administrator", blurb: "Runs the back office, money, and the team." },
  { key: "event_manager", label: "Event Manager", blurb: "Owns the event — trailer, run-of-show, crew." },
  { key: "operator", label: "Operator", blurb: "Runs the cart and the line. Serves with confidence." },
  { key: "staff", label: "Staff", blurb: "Front-of-house. Greets, makes, and serves." },
  { key: "contractor", label: "Contractor", blurb: "Short-term help for an event or activation." },
];

// The app's account roles (member/server/admin/owner…) map onto Academy roles. Event-manager and
// contractor are Academy-only paths until profiles carry them. One home (2026-10-07): the Academy
// page reads it, and so does the crew welcome letter, which names the path a new teammate starts on.
export const APP_TO_ACADEMY: Record<string, Role> = {
  owner: "founder", admin: "admin", event_manager: "event_manager",
  operator: "operator", server: "operator", contractor: "contractor", member: "staff",
};
export const toAcademyRole = (appRole: string): Role => APP_TO_ACADEMY[appRole] ?? "staff";
/** The Academy path an app role starts on — its label and its one line. */
export const trackFor = (appRole: string): { label: string; blurb: string } | null => {
  const r = ROLES.find((x) => x.key === toAcademyRole(appRole));
  return r ? { label: r.label, blurb: r.blurb } : null;
};

export interface QuizQ { q: string; options: string[]; correct: number; why?: string }
export interface ModuleSection { h: string; p: string }
export interface Scenario { situation: string; doThis: string }
/** A module's outline — what the Academy's lists, paths and progress need, and all a browser gets (IP0b). */
export interface Module {
  slug: string;
  section: Section;
  title: string;
  summary: string;
  estMin: number;
  /** How many questions its knowledge check has (0: none) — the questions and answers are the lesson's, server-side. */
  quizCount: number;
  pass?: number; // % needed to pass (default 80)
}
/** What a module teaches — served to staff by app/api/academy/lesson from lib/academyLessons (IP0b). */
export interface Lesson {
  body: ModuleSection[];
  // Academy Standards — every lesson earns the guest's trust the same way.
  whyItMatters?: string;          // the stakes, in one breath
  objectives?: string[];          // what you'll be able to do after this
  mistakes?: string[];            // the common ways this goes wrong
  founderInsight?: string;        // the owners' voice — the why behind the standard. Plural on
                                  // purpose: GT3 is owner-operated by two people, and a note in one
                                  // person's first person reads as a company with one operator.
  scenarios?: Scenario[];         // "a guest does X → you do Y"
  quiz?: QuizQ[];
}
/** A lesson's class (IP0b): internal — staff training; restricted — process specifics, the recipe audience (D1). */
export type LessonClass = "internal" | "restricted";

export const PASS_DEFAULT = 80;

// ─────────────────────────── core modules ───────────────────────────
export const MODULES: Module[] = [
  {
    slug: "ingredient-science", quizCount: 6, section: "nutrition", title: "Ingredient Science — teach it, within the lines", estMin: 12,
    summary: "What every ingredient is, why we chose it, and the exact line between education and a claim you can't make.",
  },
  {
    slug: "the-craft", quizCount: 5, section: "brand", title: "The Craft — the process story, told straight", estMin: 10,
    summary: "How we make it — sourcing, cold extraction, glass & steel — and the exact line between a proud process story and a claim we can't make.",
  },
  {
    slug: "welcome-gt3", quizCount: 3, section: "welcome", title: "Welcome to GT3", estMin: 8,
    summary: "Who we are, why we exist, and what we believe.",
  },
  {
    slug: "brand-pure-signal", quizCount: 3, section: "brand", title: "Brand Standards — Pure Signal. No Noise.", estMin: 7,
    summary: "Our north-star standard and how it drives every decision.",
  },
  {
    slug: "design-the-gt3-grid", quizCount: 4, section: "brand", title: "The GT3 Grid — Visual Design Standards", estMin: 9,
    summary: "The locked system that makes every flyer, post, and story a 9–10 — the same way, every time.",
  },
  {
    slug: "customer-experience", quizCount: 3, section: "cx", title: "Customer Experience", estMin: 9,
    summary: "How we greet, educate, explain, and create a memorable bar.",
  },
  {
    slug: "primal-nutrition", quizCount: 4, section: "nutrition", title: "Primal Nutrition — the why behind the ingredients", estMin: 10,
    summary: "Why our ingredients, sourcing, prep and process matter — without medical claims.",
  },
  {
    slug: "product-knowledge", quizCount: 3, section: "product", title: "Product Knowledge — the full lineup", estMin: 12,
    summary: "Know every product cold: what it is, who it's for, and how to talk about it.",
  },
  {
    slug: "event-ops", quizCount: 3, section: "ops", title: "Event Operations", estMin: 11,
    summary: "Run an event end to end: setup, run-of-show, compliance, breakdown.",
  },
  {
    slug: "inventory-ops", quizCount: 2, section: "ops", title: "Inventory & Par", estMin: 7,
    summary: "Keep the bar stocked and the books clean.",
  },
  {
    slug: "cart-ops", quizCount: 2, section: "ops", title: "Run the Cart", estMin: 8,
    summary: "Cart-only service: setup, flow, and safety.",
  },
  {
    slug: "trailer-ops", quizCount: 2, section: "ops", title: "Run the Trailer", estMin: 9,
    summary: "Full trailer-plus-cart service for larger activations.",
  },

  // ═══════════════ Phase 3 — The Science ═══════════════
  {
    slug: "coffee-science", quizCount: 3, section: "nutrition", title: "Coffee Science — why cold extraction tastes the way it does", estMin: 12,
    summary: "The real chemistry behind cold extraction, single-origin, and mineral water — enough to explain it honestly.",
  },
  {
    slug: "functional-ingredients", quizCount: 3, section: "nutrition", title: "Functional Ingredients — the why behind every addition (claim-safe)", estMin: 11,
    summary: "Coconut water, electrolytes, cacao, spice, maple, bone broth — what each one is and how to talk about it without inventing a benefit.",
  },

  // ═══════════════ Phase 5 — Equipment Mastery ═══════════════
  {
    slug: "nitro-mastery", quizCount: 4, section: "equipment", title: "Nitro System Mastery — charge it, pour it, explain it, fix it", estMin: 14,
    summary: "Set the keg up by the numbers (35 PSI, cold, rested), pour a perfect cascade, explain nitro in the guest's language, and diagnose a bad pour.",
  },
  {
    slug: "coldbrew-power-mastery", quizCount: 3, section: "equipment", title: "Cold-Brew, Grinder & Power — keep the line running off-grid", estMin: 11,
    summary: "The grinder, the brewing vessels, and the power chain (EcoFlow / generator) — run them, clean them, and never go dark.",
  },

  // ═══════════════ Phase 6 — Hospitality Excellence ═══════════════
  {
    slug: "hospitality-excellence", quizCount: 3, section: "cx", title: "Hospitality Excellence — Four-Seasons service at a beverage bar", estMin: 12,
    summary: "Greet, read, educate, and create a memorable moment — luxury hospitality without arrogance.",
  },

  // ═══════════════ Phase 8 — Operational Excellence ═══════════════
  {
    slug: "operating-cadence", quizCount: 3, section: "excellence", title: "The Operating Cadence — checklists, par, waste & the numbers", estMin: 11,
    summary: "Daily, weekly, and monthly rhythms that keep quality and margin from drifting — and the few numbers every operator watches.",
  },

  // ═══════════════ Phase 9 — Leadership ═══════════════
  {
    slug: "think-like-owner", quizCount: 3, section: "leadership", title: "Think Like an Owner — decisions, accountability, brand stewardship", estMin: 10,
    summary: "How to make the call the founder would make when no SOP covers it, own the outcome, and protect the brand.",
  },

  // ═══════════════ Phase 10 — GT3 Philosophy ═══════════════
  {
    slug: "how-gt3-thinks", quizCount: 3, section: "philosophy", title: "How GT3 Thinks — the principles you solve problems with", estMin: 9,
    summary: "The handful of principles that, once you hold them, let you handle anything the manual didn't cover.",
  },

  // ═══════════════ The GT3 Playbook ═══════════════
  {
    slug: "founders-playbook", quizCount: 3, section: "playbook", title: "The Founder's Playbook — why we built it this way", estMin: 10,
    summary: "The institutional memory: the reasoning behind GT3's biggest decisions, so the brand is bigger than any one founder.",
  },

  // ═══════════════ Phase 1 depth — Welcome ═══════════════
  {
    slug: "why-details-matter", quizCount: 3, section: "welcome", title: "Why the Details Matter — the founder's philosophy", estMin: 8,
    summary: "Before any SOP: why GT3 exists, and why we sweat things nobody asked us to.",
  },

  // ═══════════════ Phase 2 depth — Brand DNA ═══════════════
  {
    slug: "brand-dna", quizCount: 3, section: "brand", title: "Brand DNA — mission, values & voice", estMin: 9,
    summary: "Who GT3 is at the core: mission, vision, the values we won't trade, and how we talk.",
  },

  // ═══════════════ Phase 4 depth — Product Mastery ═══════════════
  {
    slug: "recommend-upsell", quizCount: 3, section: "product", title: "Recommend & Upsell — match the guest to the pour", estMin: 9,
    summary: "A simple decision tree for recommending the right drink, plus upselling as genuine care.",
  },

  // ═══════════════ Phase 7 depth — Event Operations ═══════════════
  {
    slug: "food-safety", quizCount: 3, section: "ops", title: "Food Safety & Health Code — the non-negotiables", estMin: 11,
    summary: "The food-safety rules that keep guests safe and keep us legal — these are never optional.",
  },
  {
    slug: "pos-cash", quizCount: 3, section: "ops", title: "POS, Cash & Payments — get paid, balance out, never lose a sale", estMin: 8,
    summary: "Run the register, handle cash cleanly, survive a dead signal, and reconcile at close.",
  },
  {
    slug: "peak-volume", quizCount: 3, section: "ops", title: "Peak Volume & the Line — flow under pressure", estMin: 9,
    summary: "How to run a rush without dropping quality: pre-batch, station discipline, and reading the line.",
  },

  // ═══════════════ Phase 6 depth — Hospitality ═══════════════
  {
    slug: "objections", quizCount: 3, section: "cx", title: "Objections & Hard Moments — turn friction into trust", estMin: 8,
    summary: "How to handle the price pushback, the skeptic, the complaint, and the upset guest — without losing the standard or the relationship.",
  },

  // ═══════════════ Phase 9 depth — Leadership ═══════════════
  {
    slug: "training-feedback", quizCount: 3, section: "leadership", title: "Train Others & Give Feedback — multiply the standard", estMin: 9,
    summary: "How to bring a new person to the GT3 bar and give feedback that actually sticks — so the standard scales past you.",
  },
  {
    slug: "sunday-delivery-ops", quizCount: 2, section: "ops", title: "Sunday Delivery — the porch run", estMin: 8,
    summary: "Order by Friday 6 PM, brew Saturday, porch drop Sunday 5–8 AM. The swap is the whole mechanic: empties out, fresh in, Loop price earned.",
  },
];

// ─────────────────────────── product education + cookbook ───────────────────────────
export interface Product {
  key: string; name: string; line: string; price?: string;
  what: string; why: string; ingredients: string[]; benefits: string[];
  customer: string; talking: string[]; faqs: { q: string; a: string }[];
  // Three voices to explain it — match the guest: Simple (rushed), GT3 (curious), Founders (the deeper why).
  voices?: { simple: string; gt3: string; founder: string };
}

/** A product's cookbook — its operating spec. The data is confidential and lives server-side in lib/academyCookbook
 *  (IP0); this is only its shape, so the Academy page can draw what the authed route returns. */
export interface Cookbook {
    batch?: string; brew?: string[]; serve?: string[]; storage?: string; quality?: string;
    troubleshoot?: { issue: string; fix: string }[];
    // ── DOES THIS PROCEDURE PUT SOMETHING ON A SCALE? (2026-10-01) ────────────────────────────
    // A new operator is joining who will be cooking, so the Cookbook now carries the levelling
    // rule. This is a FLAG and not a regex over the procedure text, on purpose.
    //
    // 0336 shipped last night for exactly this mistake: an alert guard that decided "have I
    // already warned about this?" by searching for its own wording, so editing the copy — even
    // just to read better — silently broke it. A safety band whose presence depends on the word
    // "Weigh" surviving in a sentence is that bug with worse consequences: rewrite "Weigh beans
    // 1:13" as "Measure out beans 1:13" and the scale rule vanishes with no error anywhere.
    //
    // Prose-sniffing is fine in a TEST, which fails loudly at build time, and scripts/smoke.cjs
    // does precisely that: it reads these procedures and fails if one talks about weighing with
    // this flag unset. It is not fine in a render path, which fails silently in a kitchen.
    weighs?: boolean;
    // ── …OR IS EVERY AMOUNT A CUP OR A SPOON? (2026-10-09) ─────────────────────────────────────
    // Ask GT3's first answer for the Salted Maple Latte — fluid ounces and tablespoons throughout —
    // told the cook to tare a scale. A fluid ounce is a volume, measured in a cup. Set only where
    // every amount is written and none is weighed; lib/operatorKb.ts tells the assistant, and smoke
    // holds the flag to that.
    byVolume?: boolean;
}

export const PRODUCTS: Product[] = [
  {
    key: "rise", name: "Rise", line: "Activation", price: "$10",
    what: "Cold-extracted single-origin coffee in mineral water, finished with organic coconut water.",
    why: "A clean, even lift to start the morning.",
    ingredients: ["Single-origin cold extraction", "Mineral water base", "Organic coconut water"],
    benefits: ["Clean morning lift", "Smooth, low-bitterness bottle", "Made to order"],
    customer: "The morning regular who wants real coffee without the burnt bite.",
    talking: ["Our clean cold-brew to start the day", "Cold-extracted over hours, so it's rounder and less bitter", "Same caffeine as Flow and Dusk (~210 mg/10 oz)"],
    faqs: [
      { q: "How much caffeine?", a: "About 210 mg per 10 oz — the same as Flow and Dusk. (Estimated until lab-verified.)" },
      { q: "Is it sweet?", a: "No added sugar — the coconut water gives a light natural roundness." },
    ],
    voices: {
      simple: "Clean cold-brew coffee with a splash of coconut water. Smooth, not bitter, made to order.",
      gt3: "Rise is our morning bottle — single-origin coffee cold-extracted over ~18 hours so it comes out rounder and less bitter than hot coffee, then finished with organic coconut water for a light, clean lift.",
      founder: "We cold-extract instead of brewing hot out of respect for the coffee — heat rips out bitterness and acid in minutes; cold draws it gently over hours. The coconut water isn't a gimmick, it's GT3's whole-coconut hydration thread carried into the first cup of the day. Rise is the handshake: real coffee, no burnt bite, nothing to hide.",
    },
  },
  {
    key: "flow", name: "Flow", line: "Activation", price: "$10",
    what: "Cold-extracted single-origin coffee in mineral water, infused with organic cacao nibs.",
    why: "Cacao to keep the focus going a little longer.",
    ingredients: ["Single-origin cold extraction", "Mineral water base", "Organic cacao nibs"],
    benefits: ["Longer, even focus arc", "Rich cacao note", "Made to order"],
    customer: "The deep-work drinker who wants a smoother, longer ride than a hot coffee.",
    talking: ["Cold-brew infused with real cacao nibs", "A richer, longer-feeling bottle", "Same caffeine as Rise and Dusk"],
    faqs: [
      { q: "Is there chocolate sugar in it?", a: "No — it's whole cacao nibs infused in the brew, not a sweetened syrup." },
      { q: "More caffeine than Rise?", a: "No, about the same (~210 mg/10 oz, estimated)." },
    ],
    voices: {
      simple: "Cold-brew with real cacao nibs infused in. Rich, smooth, no added sugar.",
      gt3: "Flow takes the same cold-extracted base as Rise and infuses whole organic cacao nibs — so you get a richer, longer-feeling cup without a sweetened chocolate syrup. Same caffeine as the rest of the line.",
      founder: "Flow is the deep-work bottle. The cacao note isn't dessert — it's whole nibs steeped into the brew, the bitterness reading as depth instead of sugar. It's the same coffee as Rise; the difference is the ride. When someone's locking in for hours, this is the one to point them to.",
    },
  },
  {
    key: "dusk", name: "Dusk", line: "Activation", price: "$10",
    what: "Cold-extracted single-origin coffee in mineral water with Ceylon cinnamon and green cardamom.",
    why: "A warmer, spiced bottle for the back half of the day.",
    ingredients: ["Single-origin cold extraction", "Mineral water base", "Ceylon cinnamon", "Green cardamom"],
    benefits: ["Warm baking-spice flavor", "Same clean cold-brew base", "Made to order"],
    customer: "Someone who wants a cozier, spiced coffee in the afternoon.",
    talking: ["A warm cinnamon-and-cardamom cold-brew", "Same coffee and caffeine as Rise/Flow, just spiced", "NOT a low-caffeine or decaf option"],
    faqs: [
      { q: "Is Dusk less caffeinated / a wind-down?", a: "No. It's the same spec and caffeine (~210 mg/10 oz) as Rise and Flow — the difference is the spice, not the lift." },
      { q: "Is it sweet?", a: "No added sugar; the spice reads warm without sweetness." },
    ],
    voices: {
      simple: "Cold-brew with Ceylon cinnamon and cardamom. Warm and spiced, no sugar. Same caffeine as the others.",
      gt3: "Dusk is the same clean cold-brew base spiced with Ceylon cinnamon and green cardamom. It reads warm and cozy for the back half of the day — but it's not a decaf or wind-down; the lift is identical to Rise and Flow.",
      founder: "People assume 'evening spice' means less caffeine — it doesn't, and that's the one thing we'll always correct. Dusk is the same coffee, same lift, just dressed in baking spice instead of cacao. The cinnamon and cardamom are real, infused, never gritty. It's comfort without a single gram of added sugar.",
    },
  },
  {
    key: "nature_aid", name: "Nature's Aide", line: "Hydration", price: "$10",
    what: "A light electrolyte hydration — organic coconut water and organic lime juice with organic maple syrup, finished with sea salt.",
    why: "Clean, balanced hydration that goes down easy during the work.",
    // Ryan, 2026-10-13: coconut water and lime juice — no mineral water (R2, the Catalog round).
    ingredients: ["Organic coconut water", "Organic lime juice", "Organic maple syrup", "Sea salt"],
    benefits: ["Light electrolyte hydration", "Real maple, not a powder or isolate", "Balanced sweet-and-salt, easy to drink"],
    customer: "The active guest mid-work or mid-training who wants clean hydration, not a neon sports drink.",
    talking: ["Coconut water and lime juice with organic maple and a pinch of sea salt", "Real ingredients, not a powder or concentrate", "Disclose the maple if asked about sugar"],
    faqs: [
      { q: "Is there added sugar?", a: "Yes — organic maple syrup is the sweetener, balanced with a little sea salt. We disclose it; we don't claim 'no added sugar.'" },
      { q: "Is it a sports drink?", a: "No — it's real coconut water and lime juice with maple and sea salt, not a powdered electrolyte mix." },
    ],
    voices: {
      simple: "Coconut water and lime juice with a little organic maple and sea salt. Clean hydration, no powder.",
      gt3: "Nature's Aide is our light hydration — coconut water and lime juice with organic maple syrup and a pinch of sea salt. The maple and salt balance each other; it's real ingredients, not a powdered sports drink.",
      founder: "Hydration doesn't need a lab. Coconut water and lime carry what the body's after, organic maple gives it just enough, and sea salt rounds it out. The maple is the sweetener and we always name it — we disclose, we never hide behind 'no added sugar.' Simple, real, and it goes down easy in the middle of the work.",
    },
  },
  {
    key: "tide", name: "Tide", line: "Hydration", price: "$12",
    what: "Whole-coconut hydration — young coconut water blended with young organic Thai coconut meat, finished with organic local honey.",
    why: "Real hydration that goes down easy during the work.",
    ingredients: ["Organic young coconut water", "Young organic Thai coconut meat", "Organic local honey", "Blended to order"],
    benefits: ["Whole-food hydration base", "Naturally smooth and easy to drink", "No powders, concentrate, or isolates"],
    customer: "The active guest mid-work or mid-training who wants whole-food hydration, not a sports drink.",
    talking: ["Whole-coconut hydration with a touch of organic local honey", "Blended to order from real coconut, not a powder", "Always name the honey if asked about sugar (allergen, not for infants)"],
    faqs: [
      { q: "Is there added sugar?", a: "Yes — a touch of organic local honey. The rest is coconut water and coconut meat. We disclose it; we don't claim 'no added sugar.'" },
      { q: "How is it different from Nature's Aide?", a: "Tide is whole-coconut (water + meat) sweetened with organic local honey. Nature's Aide is a lighter coconut + mineral-water blend with organic maple and sea salt. Separate drinks." },
    ],
    voices: {
      simple: "Fresh-blended coconut water and coconut meat with a touch of local honey. Real hydration, no powder.",
      gt3: "Tide is whole-coconut hydration — young coconut water blended with young organic Thai coconut meat and finished with organic local honey. Blended to order from real coconut, not mixed from a powder or concentrate.",
      founder: "Tide is the whole coconut, not an electrolyte isolate — the water and the meat blended together, the way the body actually wants it. The honey is local and it's the one sweetener; we always name it, allergen and all. We disclose, we never hide behind 'no added sugar.'",
    },
  },
  {
    key: "nitro", name: "King Me (Nitro)", line: "Activation", price: "$14",
    what: "Cold-extracted coffee charged with nitrogen for a smooth, cascading pour from the tap.",
    why: "The same clean cold-brew, served silky and creamy without dairy.",
    ingredients: ["Single-origin cold extraction", "Nitrogen charge"],
    benefits: ["Silky, creamy texture — no dairy", "Cascade pour, great for events", "Made fresh from the keg"],
    customer: "The event guest who wants a smooth, impressive pour.",
    talking: ["Cold-brew on nitro — creamy with no milk", "Same clean coffee, charged with nitrogen", "Best straight, no ice needed"],
    faqs: [
      { q: "Is there dairy?", a: "No — the creaminess comes from the nitrogen, not milk." },
      { q: "More caffeine?", a: "It's our cold-brew base; treat it like the Activation line (~210 mg/10 oz, estimated)." },
    ],
    voices: {
      simple: "Cold-brew on tap, charged with nitrogen so it pours creamy with no milk. Best straight, no ice.",
      gt3: "Nitro is our cold-brew charged with pure nitrogen and poured from a stout faucet — the nitrogen breaks into tiny bubbles that cascade and settle into a silky, creamy head. No dairy, no sugar, just the same clean coffee with a texture that turns heads at events.",
      founder: "The cascade is half the product — people drink with their eyes first. We charge with pure N₂ around 35 PSI, keep the keg cold at 34–40°F, and let it rest before it ever pours, because a rushed keg pours flat and a flat nitro isn't GT3. When it's done right and that creamy head settles tight, you've sold the next three before you've said a word.",
    },
  },
  {
    key: "cold_extract", name: "Cold Extracted Coffee", line: "Foundation", price: "—",
    what: "The base behind the whole Activation line — single-origin coffee drawn cold over ~18 hours.",
    why: "Cold extraction is gentler than heat: rounder and less bitter.",
    ingredients: ["Single-origin coffee", "Mineral water"],
    benefits: ["Smooth, low-bitterness base", "Consistent spec across every cart and trailer", "The foundation of Rise, Flow, Dusk, Nitro"],
    customer: "Every coffee guest — this is the foundation, not a menu item itself.",
    talking: ["Cold-extracted over ~18 hours, 1:13 to mineral water", "We do it 'out of respect for the coffee'", "It's the base for everything in Activation"],
    faqs: [
      { q: "Why cold and not hot?", a: "Heat pulls bitterness and acidity fast; cold draws the coffee gently over hours for a rounder brew." },
    ],
    voices: {
      simple: "The base for everything — single-origin coffee drawn cold over ~18 hours. Smoother and less bitter than hot.",
      gt3: "Cold extraction is the foundation of the whole Activation line: single-origin beans at 1:13 to mineral water, drawn cold over ~18 hours, then filtered. Heat rips bitterness out in minutes; cold draws the coffee gently, so what's left is round and smooth — extracted, not sweetened.",
      founder: "We built the entire base on cold extraction for one reason: when you taste the difference, you stop needing anyone to sell it. One great base under Rise, Flow, Dusk and Nitro means the cup is the same in every city. That's not a shortcut — it's the whole point.",
    },
  },
  {
    key: "salted_maple", name: "Salted Maple Latte", line: "Specialty", price: "$14",
    what: "Cold-extracted coffee with real maple and a pinch of salt, balanced — not a sugar bomb.",
    why: "A touch of comfort and sweetness done with a real ingredient.",
    // The build is Ryan's recipe card (2026-10-07). It had no amounts until 2026-10-09, so Ask GT3 — which answers
    // a recipe only from what is written here — could not tell a new cook how to make it. The coffee is DUSK, as
    // the menu builds this latte (lib/menu.ts).
    ingredients: ["DUSK cold-extracted coffee (Ceylon cinnamon · green cardamom)", "Organic A2 grass-fed goat milk", "Salted Maple Syrup — organic maple syrup and sea salt, made in-house"],
    benefits: ["Balanced sweet-salty flavor", "Real maple, not flavored syrup", "Made to order"],
    customer: "The guest who wants a treat-leaning coffee but still real ingredients.",
    talking: ["Real maple and a pinch of salt — balanced, not a syrup bomb", "Disclose the maple as a sweetener", "Built on the DUSK brew — the same cold-extraction base, with Ceylon cinnamon and green cardamom"],
    faqs: [
      { q: "Is it very sweet?", a: "It's balanced — real maple with salt to round it. Maple is the sweetener; we disclose it." },
    ],
    voices: {
      simple: "Cold-brew with A2 grass-fed goat milk, real maple, and a pinch of sea salt. Rich and smooth, not a sugar bomb.",
      gt3: "Salted Maple Latte is built on the cold-brew base with organic A2 grass-fed goat milk, real organic maple, and a pinch of sea salt. The salt balances the maple so it reads rich and smooth — maple-forward, never cloying. Maple's the sweetener and we name it.",
      founder: "This is the one that proves 'treat' and 'clean' aren't opposites. Real maple instead of flavored syrup, A2 goat milk instead of a mystery barista blend, a pinch of salt to keep it honest — indulgent without a single ingredient we'd have to hide.",
    },
  },
  {
    key: "bone_broth", name: "Bone Broth", line: "Fuel", price: "$10",
    what: "Pasture-raised bone broth (beef / bison / ostrich variants).",
    why: "A warm, savory rebuild for after the work.",
    ingredients: ["Bone broth", "Pasture-raised bones"],
    benefits: ["Warm, savory, real", "Cooked for hours", "No bouillon, additives, or filler"],
    customer: "The post-training or cold-day guest who wants real food in a cup.",
    talking: ["Made from pasture-raised bones", "Real broth, not bouillon", "Describe it as warm fuel — never make a medical claim"],
    faqs: [
      { q: "Is it like a soup?", a: "It's a sippable broth — savory, warm, made from real bones cooked for hours." },
    ],
    voices: {
      simple: "Bone broth from pasture-raised bones. Warm, savory, real — sip it like a drink.",
      gt3: "Bone Broth is cooked for hours from pasture-raised bones (beef, bison, or ostrich), strained and seasoned — no bouillon, no additives. Served hot as a savory, protein-forward option for the rebuild after the work.",
      founder: "Broth is the oldest 'functional' food there is, and it needs no marketing — just hours on the stove and real bones. We call it warm, savory fuel and stop there; we won't promise your joints anything. The honesty is the product.",
    },
  },
  {
    key: "coconut_shake", name: "Coconut Shake", line: "Hydration", price: "$8",
    what: "A thicker whole-coconut blend — coconut water and meat blended rich, lightly sweetened with honey.",
    why: "A richer, creamier take on whole-coconut hydration.",
    ingredients: ["Organic young coconut water", "Organic coconut meat", "Raw honey", "Blended to order"],
    benefits: ["Rich, creamy, whole-food", "No dairy", "Blended fresh"],
    customer: "The guest who wants Nature's Aide but creamier and more filling.",
    talking: ["A creamier whole-coconut blend, no dairy", "Sweetened with a touch of honey — disclose it", "Blended to order"],
    faqs: [
      { q: "Dairy?", a: "None — the creaminess is the coconut meat." },
      { q: "Sugar?", a: "A touch of raw honey; the rest is coconut. We disclose the honey." },
    ],
    voices: {
      simple: "A creamier whole-coconut blend — coconut water and meat with a touch of honey. No dairy, blended to order.",
      gt3: "Coconut Shake is our richer take on whole-coconut hydration — young coconut water blended with extra coconut meat for body, lightly sweetened with organic local honey. Creamy with zero dairy; the honey's the sweetener and we disclose it.",
      founder: "Same idea as Tide, just fuller — the coconut meat does what dairy would, so it's creamy without any milk. The honey is local and named, always. Proof you can make something that feels like a shake out of nothing but real food.",
    },
  },
];

// ─────────────────────────── certifications ───────────────────────────
export interface Cert { key: string; title: string; blurb: string; modules: string[] }
export const CERTS: Cert[] = [
  { key: "brand", title: "Brand Certified", blurb: "Knows who GT3 is and the Pure Signal standard.", modules: ["welcome-gt3", "why-details-matter", "brand-pure-signal", "brand-dna"] },
  { key: "cx", title: "Hospitality Certified", blurb: "Greets, reads, educates, and recovers to standard.", modules: ["customer-experience", "hospitality-excellence", "objections"] },
  { key: "product", title: "Product Certified", blurb: "Knows the lineup and recommends honestly.", modules: ["primal-nutrition", "product-knowledge", "recommend-upsell"] },
  { key: "science", title: "Science Certified", blurb: "Explains the why behind the cup — claim-safe.", modules: ["coffee-science", "functional-ingredients"] },
  { key: "equipment", title: "Equipment Certified", blurb: "Runs, cleans, and troubleshoots every system.", modules: ["nitro-mastery", "coldbrew-power-mastery"] },
  { key: "event", title: "Event Certified", blurb: "Runs an event end to end, safely.", modules: ["event-ops", "food-safety", "pos-cash", "peak-volume"] },
  { key: "inventory", title: "Inventory Certified", blurb: "Keeps the bar stocked and the books clean.", modules: ["inventory-ops"] },
  { key: "ops", title: "Operations (Cart) Certified", blurb: "Can run the cart and the line.", modules: ["cart-ops"] },
  { key: "trailer", title: "Trailer Certified", blurb: "Can run the full trailer activation.", modules: ["trailer-ops"] },
  { key: "excellence", title: "Operational Excellence Certified", blurb: "Runs the cadence, par, waste, and the numbers.", modules: ["operating-cadence"] },
  { key: "leadership", title: "Leadership Certified", blurb: "Thinks like an owner; trains and develops the crew.", modules: ["think-like-owner", "training-feedback"] },
  { key: "philosophy", title: "GT3 Philosophy Certified", blurb: "Carries the principles and the founder's playbook.", modules: ["how-gt3-thinks", "founders-playbook"] },
];

// ─────────────────────────── role learning paths ───────────────────────────
export interface RolePath { role: Role; certs: string[] }
const ROLE_PATHS: RolePath[] = [
  { role: "contractor", certs: ["brand", "cx", "event"] },
  { role: "staff", certs: ["brand", "cx", "product", "science"] },
  { role: "operator", certs: ["brand", "cx", "product", "science", "equipment", "ops", "inventory", "event"] },
  { role: "event_manager", certs: ["brand", "cx", "product", "science", "equipment", "event", "ops", "trailer", "inventory", "excellence", "leadership"] },
  { role: "admin", certs: ["brand", "cx", "product", "science", "equipment", "event", "ops", "trailer", "inventory", "excellence", "leadership", "philosophy"] },
  { role: "founder", certs: ["brand", "cx", "product", "science", "equipment", "event", "ops", "trailer", "inventory", "excellence", "leadership", "philosophy"] },
];

// ─────────────────────────── operating expectations by level ───────────────────────────
// The certs above answer "what have you been taught". These answer "what are you held to" — which
// nothing in the Academy said until now. A learning path without a standard attached teaches people
// the material and leaves them guessing about the job.
//
// Deliberately written as four different things, because they get confused with each other:
//   owns      — the one sentence that defines the role. If it's true of two roles, one is wrong.
//   standards — non-negotiables. Breaking one is a conversation, not a coaching note.
//   cadence   — what the role does on a rhythm, whether or not anyone asks.
//   judgedOn  — how the role is actually assessed. Stated out loud so nobody has to infer it.
export interface RoleExpectations {
  role: Role;
  owns: string;
  standards: string[];
  cadence: string[];
  judgedOn: string[];
}

export const EXPECTATIONS: Record<Role, RoleExpectations> = {
  contractor: {
    role: "contractor",
    owns: "One shift, run to standard, without needing supervision.",
    standards: [
      "Arrive in brand standard and on time — the truck opens when it says it opens.",
      "Never make a health claim. If you're unsure whether a sentence is allowed, don't say it.",
      "Never improvise a recipe. Spec exists so the tenth cup matches the first.",
      "Log what you use before you leave. Unlogged stock is stock nobody can reorder.",
    ],
    cadence: ["Pre-shift checklist before service", "Close-out count before you leave"],
    judgedOn: ["Cups made to spec", "Whether the station closes clean", "Whether you had to be chased"],
  },
  staff: {
    role: "staff",
    owns: "Every cup that leaves the window, and the guest who takes it.",
    standards: [
      "Recipe to spec every time — not close, the same.",
      "Claim-safe language. Describe what's in it and how it's made, never what it cures.",
      "Never sell something you can't explain. Ask, then sell it properly next time.",
      "Sold-out beats substituted. Marking an item 86'd is a service, not a failure.",
    ],
    cadence: ["Open checks", "Par check mid-service", "Close count"],
    judgedOn: ["Consistency across a whole service", "Holding the line at peak", "Guests who come back and ask for you"],
  },
  operator: {
    role: "operator",
    owns: "The service day: the rig, the crew on it, and the numbers it produces.",
    standards: [
      "The rig is safe and legal before it moves. Tow limits and load-out are checked, not assumed.",
      "Par is honoured. Going out short is a decision you make in advance, out loud, not one you discover.",
      "Incidents get logged the same day, including the ones that ended fine.",
      "Equipment gets retired, never deleted — its service history is how the next one gets fixed faster.",
    ],
    cadence: ["Readiness check before every service day", "Load-out signed off", "End-of-day numbers in the same night"],
    judgedOn: ["Days that run without escalation", "Waste against par", "Equipment kept in service rather than replaced"],
  },
  event_manager: {
    role: "event_manager",
    owns: "The promise made to a venue, and the delivery of it.",
    standards: [
      "Nothing is confirmed that can't be served. Capacity is checked before the yes, not after.",
      "Compliance is confirmed for that jurisdiction — the app will tell you when it doesn't know a county. Believe it.",
      "Staffing is locked 72 hours out. A crew found on the morning is not a crew.",
      "Every event gets a debrief, including the ones that went well.",
    ],
    cadence: ["Weekly pipeline review", "Debrief within 48 hours of every event"],
    judgedOn: ["Events delivered as they were sold", "Margin per event, not revenue per event", "Venues that book again"],
  },
  admin: {
    role: "admin",
    owns: "A market's health: its crew, its equipment, its pipeline and its numbers.",
    standards: [
      "Goals are current and honestly rated. An at-risk goal marked on-track is worse than no goal.",
      "Corporate quotes go out at approved pricing. Discounts are a decision above this level.",
      "Nobody is made staff who hasn't been told what they're held to — this page, for their level.",
      "What the market spends is visible before it's spent, not explained after.",
    ],
    cadence: ["Monday workstream audit", "Weekly operating review", "Month-end close"],
    judgedOn: ["What the market contributes", "Pipeline that moves rather than ages", "Whether the market runs correctly when you're away"],
  },
  founder: {
    role: "founder",
    owns: "The standard, the money, and who else gets to carry the name.",
    standards: [
      "The claim rules are not negotiable, in any market, for any account, at any size.",
      "No market opens before its jurisdiction is seeded and its operator's agreement is signed.",
      "Agreements are written down. What was agreed is a record, not a recollection.",
      "Anything that touches customer money is server-authoritative. No exceptions for speed.",
    ],
    cadence: ["Weekly operating review", "Quarterly strategy session", "Agreement review at every tier change"],
    judgedOn: ["Markets that survive without you", "Operators who outgrow their first agreement", "Whether the standard held while you weren't looking"],
  },
};

/** Expectations for a role, tolerant of the app's own role strings (see APP_TO_ACADEMY). */
export function expectationsFor(role: Role | string): RoleExpectations {
  const r = (role in EXPECTATIONS ? role : "staff") as Role;
  return EXPECTATIONS[r];
}

// ─────────────────────────── operational readiness ───────────────────────────
// Each question is answered by holding the listed certs.
export interface Readiness { q: string; need: string[]; ack?: string }
export const READINESS: Readiness[] = [
  { q: "Can serve customers", need: ["cx", "product"], ack: "food-safety" },
  { q: "Can work an event", need: ["brand", "cx", "event"], ack: "food-safety" },
  { q: "Can run a cart", need: ["ops", "product"], ack: "food-safety" },
  { q: "Can run a trailer", need: ["trailer", "ops", "event"], ack: "food-safety" },
  { q: "Can train others", need: ["brand", "cx", "product", "event", "ops", "trailer", "inventory"], ack: "food-safety" },
];

// ─────────────────────────── certification expiry ───────────────────────────
// Food-safety-adjacent certs expire and must be renewed. 0 = no expiry.
const CERT_EXPIRY_DAYS: Record<string, number> = {
  brand: 0, cx: 365, product: 730, science: 0, equipment: 365, event: 365,
  inventory: 365, ops: 365, trailer: 365, excellence: 365, leadership: 0, philosophy: 0,
};
export const certExpiryDays = (key: string) => CERT_EXPIRY_DAYS[key] ?? 0;

// ─────────────────────────── acknowledgements (e-sign) ───────────────────────────
export interface Ack { key: string; title: string; required: boolean; body: string[]; statement: string }
export const ACKS: Ack[] = [
  {
    key: "food-safety", title: "Food Safety & Handling", required: true,
    body: [
      "Wash hands before service, after breaks, and any time they're soiled. The handwash station must be set up and working — no water on site means no service.",
      "Hold cold items cold and hot items hot. If you can't hold something safely, don't serve it.",
      "Clean and sanitize surfaces and tools between rushes. Keep raw and ready-to-drink separate.",
      "Never serve past a safe hold window. When in doubt, throw it out — and log the waste.",
      "Report any illness before your shift. Do not work the bar while sick.",
    ],
    statement: "I have read GT3's food-safety standards and agree to follow them on every shift.",
  },
];
export const ackByKey = (key: string) => ACKS.find((a) => a.key === key);

// ─────────────────────────── helpers ───────────────────────────
export const moduleBySlug = (slug: string) => MODULES.find((m) => m.slug === slug);
export const certByKey = (key: string) => CERTS.find((c) => c.key === key);
export const pathForRole = (role: Role | string): string[] =>
  ROLE_PATHS.find((p) => p.role === role)?.certs ?? ROLE_PATHS.find((p) => p.role === "staff")!.certs;

// a cert is earned when every module it requires is complete
export function certEarned(cert: Cert, completed: Set<string>): boolean {
  return cert.modules.every((m) => completed.has(m));
}
// modules a role must complete = union of its certs' modules (dedup, in MODULES order)
export function requiredModules(role: Role | string): Module[] {
  const want = new Set(pathForRole(role).flatMap((k) => certByKey(k)?.modules ?? []));
  return MODULES.filter((m) => want.has(m.slug));
}

// ─────────────────────────── where one person stands ───────────────────────────
// The Academy has 30 modules and 12 certifications, and every role already declares which
// certifications it requires (ROLE_PATHS). None of that was visible anywhere outside the Academy
// itself: the crew console linked to it with a flat label and no state, so the one place that says
// "you are 0 of 8 certifications into being an Operator" was behind a link nobody had a reason to
// open. This is that sentence, derived from what the app already knows.
//
// Pure and deterministic on purpose — the caller passes the set of completed module slugs, so this
// is unit-tested rather than mocked.
export interface PathProgress {
  role: Role | string;
  roleLabel: string;
  certsTotal: number;
  certsEarned: number;
  modulesTotal: number;
  modulesDone: number;
  modulesLeft: number;
  minutesLeft: number;
  nextModule: Module | null;   // the first required module not yet complete
  nextCert: Cert | null;       // the cert that module counts toward
  complete: boolean;
}

export function pathProgress(role: Role | string, completed: Set<string>): PathProgress {
  const required = requiredModules(role);
  const certKeys = pathForRole(role);
  const certs = certKeys.map((k) => certByKey(k)).filter((c): c is Cert => !!c);
  const done = required.filter((m) => completed.has(m.slug));
  const next = required.find((m) => !completed.has(m.slug)) ?? null;
  // The cert the next module counts toward — the nearest finish line, not just the next task.
  const nextCert = next ? (certs.find((c) => c.modules.includes(next.slug) && !certEarned(c, completed)) ?? null) : null;
  const left = required.filter((m) => !completed.has(m.slug));
  return {
    role,
    roleLabel: ROLES.find((r) => r.key === role)?.label ?? String(role),
    certsTotal: certs.length,
    certsEarned: certs.filter((c) => certEarned(c, completed)).length,
    modulesTotal: required.length,
    modulesDone: done.length,
    modulesLeft: left.length,
    minutesLeft: left.reduce((n, m) => n + (Number(m.estMin) || 0), 0),
    nextModule: next,
    nextCert,
    complete: left.length === 0,
  };
}

// One line for a card: what this person should do next, or that they are done.
export function pathHeadline(p: PathProgress): string {
  if (p.complete) return `${p.roleLabel} path complete — all ${p.certsTotal} certifications earned.`;
  if (p.modulesDone === 0) return `${p.roleLabel} path — not started. ${p.modulesTotal} modules, about ${Math.round(p.minutesLeft / 60)}h.`;
  return `${p.roleLabel} path — ${p.certsEarned} of ${p.certsTotal} certifications, ${p.modulesLeft} module${p.modulesLeft === 1 ? "" : "s"} to go.`;
}

// ─────────────────────────── readiness, said as what is left ───────────────────────────
// Ryan's Academy screenshot, 2026-10-04: OPERATIONAL READINESS — five rows ("Can serve customers",
// "Can work an event"…) each led by a dash. Not ready, plainly, but not why, not how far, and not a
// thing to tap: the list described five doors and opened none of them. The data to say all three was
// already here — each row names the certifications and the sign-off it needs.
//
// A certification is held when it is earned and in date. Eight of the twelve expire, after one or
// two years (CERT_EXPIRY_DAYS), and until this there was no way to renew one: completeModule only ever awarded certs that had never
// been earned, so an expired cert stayed expired for ever and every readiness row that needed it
// read "—" for ever. A cert now renews when every one of its modules has been RETAKEN since it
// expired — `retakenSince` is how the caller says which (module completed_at after the expiry).
export type CertStatus = "none" | "active" | "expiring" | "expired";
export type ReadinessStep = { k: "ack"; key: string } | { k: "module"; slug: string };
export interface ReadinessState {
  certStatus: (key: string) => CertStatus;
  completed: ReadonlySet<string>;
  acked: ReadonlySet<string>;
  /** Has this module been completed since this cert expired? Absent = never. */
  retakenSince?: (slug: string, certKey: string) => boolean;
}
export interface ReadinessGap {
  ok: boolean;
  modulesLeft: number;
  needsAck: boolean;
  expired: string[];          // titles of needed certs that have lapsed
  next: ReadinessStep | null; // the one thing to open next
  line: string;               // what is left, in a sentence
}

const certHeld = (st: CertStatus) => st === "active" || st === "expiring";

/** The modules a lapsed cert still needs retaken before it renews, in its own order. */
export function renewalLeft(cert: Cert, retakenSince: ((slug: string, certKey: string) => boolean) | undefined): string[] {
  return cert.modules.filter((m) => !(retakenSince?.(m, cert.key) ?? false));
}

export function readinessGap(r: Readiness, s: ReadinessState): ReadinessGap {
  const needsAck = !!r.ack && !s.acked.has(r.ack);
  const left: string[] = [];
  const expired: string[] = [];
  for (const key of r.need) {
    const cert = certByKey(key);
    if (!cert) continue;
    const st = s.certStatus(key);
    if (certHeld(st)) continue;
    if (st === "expired") {
      expired.push(cert.title.replace(/ Certified$/, ""));
      left.push(...renewalLeft(cert, s.retakenSince));
    } else {
      left.push(...cert.modules.filter((m) => !s.completed.has(m)));
    }
  }
  const modules = [...new Set(left)];
  const ok = !needsAck && modules.length === 0 && expired.length === 0;
  // A lapsed cert whose modules have all been retaken renews on the next completion — so even then
  // there is a door: the cert's first module.
  const lapsedFirst = r.need.map((k) => certByKey(k)).find((c) => c && s.certStatus(c.key) === "expired")?.modules[0];
  // The sign-off comes first: it is the one thing marked "required before serving".
  const next: ReadinessStep | null = needsAck && r.ack ? { k: "ack", key: r.ack }
    : modules[0] ? { k: "module", slug: modules[0] }
    : lapsedFirst ? { k: "module", slug: lapsedFirst } : null;
  const parts: string[] = [];
  if (modules.length) parts.push(`${modules.length} module${modules.length === 1 ? "" : "s"}`);
  if (needsAck && r.ack) parts.push(`the ${ackByKey(r.ack)?.title ?? r.ack} sign-off`);
  const lapsed = expired.length ? `${expired.join(", ")} expired — retake to renew` : "";
  const line = ok ? "Ready"
    : parts.length ? `${parts.join(" and ")} to go${lapsed ? ` · ${lapsed}` : ""}`
    : lapsed;
  return { ok, modulesLeft: modules.length, needsAck, expired, next, line };
}

// ─────────────────────────── one answer to "is this assignment done?" ───────────────────────────
// The Academy page and the admin's team board each answered it, differently (2026-10-04). The board
// had no case for a whole-path assignment, so a path assigned with a due date read "overdue" for
// ever once the date passed — finished or not. It counted a lapsed certification as held. And it
// scored a person by every module they had ever finished over the modules their role requires, so
// someone who took extra modules read 120% and the bar ran out of its track.
export type AssignmentLike = { target_type: string; target_key: string; due_at: string | null };

/** A recorded certification is held while it is in date. `null` expiry = it does not expire. */
export const certInDate = (expiresAt: string | null | undefined, nowMs: number): boolean =>
  expiresAt === null || (typeof expiresAt === "string" && Date.parse(expiresAt) >= nowMs);

export function assignmentDone(a: AssignmentLike, role: Role | string, completed: ReadonlySet<string>, held: (certKey: string) => boolean): boolean {
  if (a.target_type === "module") return completed.has(a.target_key);
  if (a.target_type === "cert") return held(a.target_key);
  return requiredModules(role).every((m) => completed.has(m.slug)); // "path": the role's whole path
}

export function assignmentOverdue(a: AssignmentLike, role: Role | string, completed: ReadonlySet<string>, held: (certKey: string) => boolean, nowMs: number): boolean {
  return !!a.due_at && Date.parse(a.due_at) < nowMs && !assignmentDone(a, role, completed, held);
}

export interface TeamMemberRow { pct: number; held: number; overdue: number }

/** One row of the team board: share of the role's REQUIRED modules done, certs held, overdue work. */
export function teamMemberRow(m: {
  role: Role | string;
  completed: ReadonlySet<string>;
  certExpiry: Readonly<Record<string, string | null>>; // recorded certs → expires_at
  assignments: readonly AssignmentLike[];
}, nowMs: number): TeamMemberRow {
  const need = requiredModules(m.role);
  const done = need.filter((x) => m.completed.has(x.slug)).length;
  const held = (k: string) => Object.prototype.hasOwnProperty.call(m.certExpiry, k) && certInDate(m.certExpiry[k], nowMs);
  return {
    pct: need.length ? Math.round((done / need.length) * 100) : 0,
    held: Object.keys(m.certExpiry).filter(held).length,
    overdue: m.assignments.filter((a) => assignmentOverdue(a, m.role, m.completed, held, nowMs)).length,
  };
}
