// GT3 Academy — training content, authored from the governed GT3 Brand Source of
// Truth (Notion). Content lives in code so it stays versioned and honest; per-user
// progress + certifications live in Supabase (0030). Roles, certifications and
// operational-readiness are all derived from the data below.
//
// HARD RULE (from the Source of Truth / Risk Register): no unsupported
// physiological/comparative health claims. Nutrition is "estimated" until lab-
// verified. Rise/Flow/Dusk share one spec and the SAME caffeine (~210 mg/10 oz).
// Nature Aid (coconut hydration) contains raw honey — disclose it.

export type Role = "founder" | "admin" | "event_manager" | "operator" | "staff" | "contractor";
// The GT3 Academy is built as a university — phases that take someone from zero to "would make the
// same call Ryan would." Existing keys are kept; new phases extend them. Order + labels live in SECTIONS.
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

export interface QuizQ { q: string; options: string[]; correct: number; why?: string }
export interface ModuleSection { h: string; p: string }
export interface Scenario { situation: string; doThis: string }
export interface Module {
  slug: string;
  section: Section;
  title: string;
  summary: string;
  estMin: number;
  body: ModuleSection[];
  // Academy Standards — every lesson earns the guest's trust the same way.
  whyItMatters?: string;          // the stakes, in one breath
  objectives?: string[];          // what you'll be able to do after this
  mistakes?: string[];            // the common ways this goes wrong
  founderInsight?: string;        // Ryan's voice — the why behind the standard
  scenarios?: Scenario[];         // "a guest does X → you do Y"
  quiz?: QuizQ[];
  pass?: number; // % needed to pass (default 80)
}

export const PASS_DEFAULT = 80;

// ─────────────────────────── core modules ───────────────────────────
export const MODULES: Module[] = [
  {
    slug: "welcome-gt3", section: "welcome", title: "Welcome to GT3", estMin: 8,
    summary: "Who we are, why we exist, and what we believe.",
    body: [
      { h: "The company", p: "GT3 is a portfolio of premium, performance-oriented consumer brands — built lean, scalable, and structured to last. Two brands run off one shared backbone: GT3 Brew (functional coffee) and GT3 Performance Bar (the mobile bar you work)." },
      { h: "Founder story", p: "GT3 is owner-operated by Ryan and Kayla Thompkins. It started with a simple refusal: not to serve anything we wouldn't drink ourselves. Every recipe, vendor, and standard traces back to that." },
      { h: "Mission", p: "Make the cleanest, most honest performance beverages — every input a named whole food, every claim something we can stand behind — and serve them at the moments people actually need them." },
      { h: "Vision", p: "Grow GT3 from one owner-operated bar into a multi-city, multi-brand operation that anyone can run to the same standard — because the standard is written down, not in someone's head." },
      { h: "Brand pillars", p: "1) Signal over noise — measured, not hyped. 2) Whole-food, made to order. 3) Premium experiential. 4) Due-diligence-ready: clean and transferable." },
      { h: "Core values", p: "Honesty in the bottle. Respect for the ingredient. Lean and repeatable. Best-for-you — the customer's outcome leads." },
    ],
    quiz: [
      { q: "What are GT3's two brands?", options: ["GT3 Brew & GT3 Performance Bar", "GT3 Coffee & GT3 Juice", "GT3 Brew & GT3 Energy"], correct: 0 },
      { q: "Which best states the mission?", options: ["Sell the most coffee in Atlanta", "Clean, honest performance beverages we can stand behind, served when people need them", "Be the cheapest option at every event"], correct: 1 },
      { q: "\"Signal over noise\" means we…", options: ["Market loudly", "Measure and stand behind what we serve, without hype", "Avoid talking to customers"], correct: 1, why: "We lead with measured substance, not hype." },
    ],
  },
  {
    slug: "brand-pure-signal", section: "brand", title: "Brand Standards — Pure Signal. No Noise.", estMin: 7,
    summary: "Our north-star standard and how it drives every decision.",
    body: [
      { h: "What it means", p: "\"Pure Signal. No Noise.\" is the GT3 Brew brand line. Signal is the real, felt effect of a clean product made from whole food. Noise is everything fake that gets in the way — additives, shortcuts, hype, and claims we can't back up." },
      { h: "How it drives product decisions", p: "If an ingredient or step doesn't add signal, it doesn't go in. Whole-food inputs, cold extraction, made to order. We would rather have a shorter menu we can stand behind than a long one we can't." },
      { h: "How it drives customer interactions", p: "We educate, we don't oversell. We explain what something is and why it exists in plain language. We never invent a health benefit to close a sale." },
      { h: "How it drives operational decisions", p: "Same standard every time, written down. A cart in Greenville pours the same Rise as the trailer in Atlanta. Consistency is the signal customers trust." },
      { h: "Voice note", p: "On the GT3 Performance Bar app and in person, keep copy plain and flowing — warm, never precious. \"Pure Signal. No Noise.\" is a Brew brand line, not something to repeat at customers like a slogan." },
    ],
    quiz: [
      { q: "In \"Pure Signal. No Noise.\", noise is…", options: ["Loud events", "Additives, shortcuts, hype, and unsupported claims", "Talking to customers"], correct: 1 },
      { q: "A customer asks if Rise will cure their afternoon crash. You…", options: ["Promise it cures crashes", "Explain what it is and how people use it, without inventing a health claim", "Say it's medicine"], correct: 1, why: "Educate honestly; never fabricate a benefit." },
      { q: "Why does every cart pour the same recipe?", options: ["It's cheaper", "Consistency is the signal customers trust", "We ran out of options"], correct: 1 },
    ],
  },
  {
    slug: "customer-experience", section: "cx", title: "Customer Experience", estMin: 9,
    summary: "How we greet, educate, explain, and create a memorable bar.",
    body: [
      { h: "Greet", p: "Eye contact, a real hello within a few seconds. \"First time with us?\" opens the door to educate. Warm and unhurried even when the line is long." },
      { h: "Educate, don't lecture", p: "Read the guest. A regular wants their order fast; a newcomer wants a quick why. Offer the one-line version first: \"Rise is our clean cold-brew to start the day\" — go deeper only if they're curious." },
      { h: "Explain products simply", p: "Name → what it is → why it exists. \"Tide / Nature Aid is whole-coconut hydration with a touch of honey — easy to drink during the work.\" Keep it true and plain." },
      { h: "Handle objections", p: "\"Why is it more than gas-station coffee?\" → \"It's cold-extracted over hours from single-origin beans, made when you order it.\" Acknowledge, give the real reason, never argue." },
      { h: "Serve with confidence", p: "Know the menu cold. If you don't know an answer, say so and find out — never guess a nutrition number or a health claim." },
      { h: "Make it memorable", p: "Use the guest's name if you have it. Hand the bottle with both hands and a line about how to enjoy it. The last ten seconds are what they remember." },
    ],
    quiz: [
      { q: "Best way to explain a product?", options: ["List every nutrient", "Name, what it is, why it exists — in plain language", "Tell them it's the healthiest drink ever"], correct: 1 },
      { q: "A guest asks a nutrition number you don't know. You…", options: ["Make a confident guess", "Say you'll confirm it rather than guess", "Change the subject"], correct: 1, why: "Never guess a number or a claim." },
      { q: "\"Why is this more than gas-station coffee?\"", options: ["Argue that theirs is bad", "Give the real reason: cold-extracted over hours, single-origin, made to order", "Apologize and discount it"], correct: 1 },
    ],
  },
  {
    slug: "primal-nutrition", section: "nutrition", title: "Primal Nutrition — the why behind the ingredients", estMin: 10,
    summary: "Why our ingredients, sourcing, prep and process matter — without medical claims.",
    body: [
      { h: "The goal", p: "This is not medical advice and you should never give any. The goal is to explain our choices confidently in plain language so guests understand the care behind the bottle." },
      { h: "Why ingredients matter", p: "We start with named whole foods — single-origin coffee, organic coconut, pasture-raised bones — not powders, isolates, or concentrates. You can point to where every part of the drink came from." },
      { h: "Why sourcing matters", p: "Organic and pasture-raised where it counts, mineral-rich water as the base. Better inputs are the whole product; we don't fix a weak input downstream." },
      { h: "Why preparation matters", p: "Cold extraction draws coffee gently over hours for a rounder, less bitter brew than heat. Broth is slow-simmered. We make to order so it's fresh in the glass." },
      { h: "Why process matters", p: "Less processing, fewer additives. The fewer steps between a whole food and the bottle, the more honest the result." },
      { h: "The honesty rule", p: "Published nutrition is ESTIMATED until a lab panel is run — labels read \"Estimated nutrition, per 10 fl oz.\" Never state a specific health mechanism or a comparison we can't back up (e.g. \"absorbs faster than sports drinks\"). Describe the ingredient and the care; let the guest draw their own conclusion." },
    ],
    quiz: [
      { q: "How should we describe a product's nutrition?", options: ["Cite exact lab values confidently", "As estimated until lab-verified, focusing on real ingredients and care", "Compare it favorably to named competitors"], correct: 1 },
      { q: "Which is allowed?", options: ["\"This cures inflammation.\"", "\"It's cold-extracted from single-origin beans and made to order.\"", "\"Absorbs twice as fast as sports drinks.\""], correct: 1, why: "Describe ingredients and process, not health mechanisms." },
      { q: "Cold extraction means…", options: ["Brewed hot then chilled", "Drawn cold over hours for a rounder, less bitter brew", "Instant coffee over ice"], correct: 1 },
      { q: "What must every nutrition label say until lab-verified?", options: ["\"Clinically proven\"", "\"Estimated nutrition, per 10 fl oz\"", "Nothing"], correct: 1 },
    ],
  },
  {
    slug: "product-knowledge", section: "product", title: "Product Knowledge — the full lineup", estMin: 12,
    summary: "Know every product cold: what it is, who it's for, and how to talk about it.",
    body: [
      { h: "How to use this", p: "Read every product card in the Academy (below this module), then take this check. You should be able to give the one-line version of any item and its honest talking points." },
      { h: "Activation line", p: "Rise, Flow, Dusk — all cold-extracted single-origin coffee. IMPORTANT: all three share one brew spec and the SAME caffeine (~210 mg / 10 oz). The difference is flavor and ingredient, not stimulant level. Dusk is a warm, spiced bottle — not a lower-caffeine option." },
      { h: "Hydration & fuel", p: "Nature Aid is whole-coconut hydration with a touch of raw honey (disclose the honey). Bone broth is slow-simmered, pasture-raised, for the rebuild after." },
      { h: "Talking-point rule", p: "Lead with what it is and the real ingredient story. Never promise a health outcome or quote a nutrition number you're not sure of." },
    ],
    quiz: [
      { q: "How much caffeine does Dusk have vs Rise and Flow?", options: ["Much less — it's a wind-down", "The same — all three share one spec (~210 mg/10 oz)", "Double"], correct: 1, why: "Dusk differs in flavor, not caffeine." },
      { q: "Nature Aid contains…", options: ["Only coconut water", "Coconut water, coconut meat, and a touch of raw honey", "Coconut and added electrolyte powder"], correct: 1, why: "Disclose the honey — never claim 'no added sugar.'" },
      { q: "A guest wants the least caffeine in the Activation line. You say…", options: ["\"Dusk — it's the lightest.\"", "\"They're all about the same; Dusk is the same caffeine, just warmer and spiced.\"", "\"Flow has none.\""], correct: 1 },
    ],
  },
  {
    slug: "event-ops", section: "ops", title: "Event Operations", estMin: 11,
    summary: "Run an event end to end: setup, run-of-show, compliance, breakdown.",
    body: [
      { h: "Before — the pack", p: "Every event has a generated pack list driven by its menu and rig. Pack from the list, not memory. Confirm power and water on site; if no water, the handwash station is mandatory." },
      { h: "Compliance", p: "Confirm the temporary food permit and any county requirements before the event (the app surfaces the jurisdiction's rules). No permit, no pour." },
      { h: "Run-of-show", p: "Arrive with setup buffer, pour a test bottle, mark the event live in the app so sales track. One person owns the line; one owns restock." },
      { h: "During", p: "Watch the pack-signal and sales on the HUD. Keep the bar clean and stocked. Mark items 86'd the moment you run out." },
      { h: "Breakdown & AAR", p: "Break down clean, reconcile sales, and log a short after-action: what sold, what ran short, what to change. That note feeds the next event." },
    ],
    quiz: [
      { q: "There's no water on site. You…", options: ["Skip handwashing", "Set up the handwash station — it's mandatory", "Cancel the event"], correct: 1 },
      { q: "Before pouring at any event, you must confirm…", options: ["The weather", "The temporary food permit / county requirements", "The playlist"], correct: 1 },
      { q: "How do you pack for an event?", options: ["From memory", "From the generated pack list", "Whatever's in the truck"], correct: 1 },
    ],
  },
  {
    slug: "inventory-ops", section: "ops", title: "Inventory & Par", estMin: 7,
    summary: "Keep the bar stocked and the books clean.",
    body: [
      { h: "Par levels", p: "Every event has a par — the amount of each item you should leave with. Pull to par from the inventory DB; don't eyeball it." },
      { h: "Batch logging", p: "Every brew batch gets logged (GT3 Brew Lab Production) with its spec and signal score. Traceability is part of the standard and the due-diligence story." },
      { h: "Waste & 86", p: "Track what you pour out and why. Mark items 86'd in the app so the line and the guest app stay honest about what's available." },
      { h: "Restock loop", p: "Low item → flag it → restock owner pulls from par → log it. The loop is the same at a cart or a trailer." },
    ],
    quiz: [
      { q: "How do you decide how much to bring?", options: ["Eyeball it", "Pull to the event's par from the inventory DB", "Bring everything"], correct: 1 },
      { q: "Why log every batch?", options: ["Busywork", "Traceability and the due-diligence story", "It isn't required"], correct: 1 },
    ],
  },
  {
    slug: "cart-ops", section: "ops", title: "Run the Cart", estMin: 8,
    summary: "Cart-only service: setup, flow, and safety.",
    body: [
      { h: "Cart rig", p: "The cart is the lean rig — cold brew on tap or bottles, limited menu, fast setup. Know what the cart can and can't pour before you commit to a menu." },
      { h: "Service flow", p: "One-person flow: greet → make → hand off → reset. Keep your station clean and your most-ordered items within reach." },
      { h: "Safety & sanitation", p: "Handwash station working, surfaces wiped between rushes, cold items held cold. If you can't hold it safely, don't serve it." },
    ],
    quiz: [
      { q: "First thing to confirm for a cart menu?", options: ["The price", "What the cart rig can actually pour", "The parking"], correct: 1 },
      { q: "You can't hold an item cold safely. You…", options: ["Serve it anyway", "Don't serve it", "Serve it warm"], correct: 1 },
    ],
  },
  {
    slug: "trailer-ops", section: "ops", title: "Run the Trailer", estMin: 9,
    summary: "Full trailer-plus-cart service for larger activations.",
    body: [
      { h: "Trailer rig", p: "The trailer is the full bar — nitro, full menu, more throughput. It needs more setup, power, and a COI naming the venue as additional insured." },
      { h: "Crew roles", p: "At trailer scale you split roles: line, restock, and a lead who owns the run-of-show and the numbers. Assign roles in the event crew roster before doors." },
      { h: "Throughput", p: "Pre-batch where you can, keep two of every critical tool, and watch the pack-signal so you never run a station dry mid-rush." },
    ],
    quiz: [
      { q: "A trailer activation usually requires…", options: ["Nothing extra", "More power and a COI naming the venue as additional insured", "Only one person"], correct: 1 },
      { q: "At trailer scale you should…", options: ["Have one person do everything", "Split roles: line, restock, lead", "Skip the roster"], correct: 1 },
    ],
  },

  // ═══════════════ Phase 3 — The Science ═══════════════
  {
    slug: "coffee-science", section: "nutrition", title: "Coffee Science — why cold extraction tastes the way it does", estMin: 12,
    summary: "The real chemistry behind cold extraction, single-origin, and mineral water — enough to explain it honestly.",
    whyItMatters: "A guest asking 'why is this $7 and not $2' is really asking 'what am I tasting?' If you can answer with the actual science, calmly and without hype, the price explains itself and they trust everything else you say.",
    objectives: ["Explain in one breath why cold extraction is smoother than hot", "Say what 'single-origin' and '1:13' actually mean", "Describe why we use mineral water — without claiming a health benefit"],
    body: [
      { h: "Hot vs. cold is a chemistry difference, not a temperature gimmick", p: "Heat is a solvent accelerator. Brewing hot pulls coffee's oils, acids, and bitter compounds out fast — including the harsher ones. Cold water extracts the same coffee slowly over ~18 hours, pulling far less of the acidic and bitter compounds. The result is naturally lower in perceived acidity and bitterness — rounder, smoother — without adding anything. That smoothness is extracted, not sweetened." },
      { h: "Time and ratio are the recipe", p: "Our spec is 1:13 — one part coffee to thirteen parts water by weight — cold-extracted ~18 hours, then filtered. Ratio sets strength; time sets how complete the extraction is. Under-extract (too short / too coarse / too little coffee) and it tastes weak and sour. Over-extract (too long / too fine) and bitterness creeps back. The whole point of a spec is that every batch lands in the same place." },
      { h: "Single-origin means traceable, not fancy", p: "Single-origin means the beans come from one place, not a blend of mystery lots. It lets us point to where it's from and keep the flavor consistent batch to batch. We pair it with organic sourcing because it's the standard we chose — say 'organic, single-origin, cold-extracted over hours,' not 'healthier than theirs.'" },
      { h: "Mineral water — taste first", p: "Water is ~98% of the cup, so the water is part of the recipe. Minerals in the water interact with extraction and mouthfeel; we use mineral water (Mountain Valley Spring Water on spec) because it gives a cleaner, rounder result we can repeat. Frame it as taste and consistency. Do NOT claim a health benefit from the water." },
      { h: "Caffeine — know the honest number", p: "Rise, Flow, and Dusk share one base and the SAME caffeine — about 210 mg per 10 oz (estimated until lab-verified). Cold brew is often higher in caffeine than people expect because of the long extraction and ratio. If a guest is caffeine-sensitive, tell them the real number and steer them to Nature Aid or the Coconut Shake." },
    ],
    mistakes: ["Saying cold brew is 'less acidic for your stomach' — that's a health claim; say 'lower in perceived acidity, smoother'", "Guessing the caffeine number — quote ~210 mg/10 oz (estimated) or say you'll confirm", "Calling it 'healthier' than gas-station coffee instead of describing the process"],
    founderInsight: "I didn't pick cold extraction because it's trendy. I picked it because when you taste the difference, you stop needing me to sell it. The science is just the honest version of 'try it.'",
    scenarios: [
      { situation: "Guest: 'Why is cold brew stronger? Isn't cold weaker?'", doThis: "'Opposite — it steeps ~18 hours at our 1:13 ratio, so it actually pulls more caffeine than a quick hot cup. It just tastes smoother because cold water leaves the bitter stuff behind.'" },
      { situation: "Guest: 'Is this less acidic? My stomach…'", doThis: "Stay honest: 'It's lower in perceived acidity and smoother because of how it's brewed. I can't make a stomach claim, but a lot of people find it easy-drinking.'" },
    ],
    quiz: [
      { q: "Why is cold-extracted coffee smoother?", options: ["We add a smoothing agent", "Cold water pulls fewer bitter/acidic compounds over a long, slow extraction", "It's brewed hot then chilled"], correct: 1, why: "Smoothness is extracted, not added." },
      { q: "Our spec is…", options: ["1:13, ~18-hr cold extraction", "1:5, 1-hour hot brew", "Instant over ice"], correct: 0 },
      { q: "A guest asks if the mineral water is healthier. You…", options: ["Say yes, it detoxes you", "Talk taste + consistency, make no health claim", "Change the subject"], correct: 1, why: "Water is about taste and repeatability — never a health claim." },
    ],
  },
  {
    slug: "functional-ingredients", section: "nutrition", title: "Functional Ingredients — the why behind every addition (claim-safe)", estMin: 11,
    summary: "Coconut water, electrolytes, cacao, spice, maple, bone broth — what each one is and how to talk about it without inventing a benefit.",
    whyItMatters: "Every ingredient on our menu is there on purpose. If you know the real reason it exists, you can educate a guest in a sentence — and you'll never get cornered into a claim we can't back.",
    objectives: ["Name the real reason each functional ingredient is on the menu", "Describe a benefit as 'what it is / how people use it,' not a cure", "Disclose allergens (raw honey, dairy) every time"],
    body: [
      { h: "The one rule that governs all of this", p: "We describe ingredients and process, never physiological or comparative health claims. 'Coconut water has naturally occurring electrolytes' is fine. 'This rehydrates you faster than a sports drink' is not — that's a comparative claim we haven't tested. When in doubt, describe what it is and how people use it, and say you'll confirm anything you're unsure of." },
      { h: "Coconut water & electrolytes (Nature Aid, Coconut Shake)", p: "Coconut water naturally contains electrolytes — minerals like potassium and sodium that the body uses for hydration and nerve/muscle function. We use young coconut water + coconut meat for body. Nature Aid adds a measured amount of RAW HONEY as the only sweetener — always disclose the honey (allergen + not for infants). Talk about it as 'natural hydration,' not a medical rehydration claim." },
      { h: "Cacao nibs (Flow)", p: "Organic cacao nibs are infused into the cold brew. Cacao brings chocolate aroma and naturally contains theobromine — a gentle, longer compound that pairs with caffeine for a steadier feel. Say 'cacao for a smooth, sustained focus,' not 'boosts your metabolism.'" },
      { h: "Spice (Dusk: cinnamon + cardamom)", p: "Ceylon cinnamon and green cardamom are infused for warmth and aroma — an evening-leaning, lower-noise flavor. It's a flavor story, not a health story." },
      { h: "Real maple & salt (Salted Maple)", p: "Real maple is the sweetener and a pinch of salt balances it — that's culinary contrast, not a 'natural sugar is healthy' claim. Maple-forward, never cloying." },
      { h: "Bone broth — protein & amino acids (Fuel)", p: "Slow-simmered from pasture-raised bones, bone broth naturally contains protein and amino acids (like collagen-derived ones) and is served hot as a savory option. Describe it as 'a warm, savory, protein-forward option' — don't promise joint or gut outcomes." },
    ],
    mistakes: ["Forgetting to disclose the raw honey in Nature Aid", "Saying coconut water 'hydrates faster than Gatorade' (untested comparative claim)", "Calling bone broth a gut-health cure instead of 'protein-forward and savory'"],
    founderInsight: "Functional doesn't mean we make medical promises. It means every ingredient earns its place for a real reason. If the reason is just 'it tastes good,' say that — that's still a great reason.",
    scenarios: [
      { situation: "Guest with a nut/coconut allergy eyeing Nature Aid", doThis: "Flag it directly: 'Heads up — Nature Aid is coconut-based and has raw honey. Want me to point you to Rise or Dusk instead?'" },
      { situation: "Guest: 'Does the cacao give me energy?'", doThis: "'It's got natural compounds that pair nicely with the cold brew for a steady focus — most people like Flow for a smooth, sustained lift.'" },
    ],
    quiz: [
      { q: "Which is a safe way to describe coconut water?", options: ["'Rehydrates you faster than sports drinks'", "'Naturally contains electrolytes like potassium'", "'Cures dehydration'"], correct: 1 },
      { q: "Nature Aid contains raw honey. You…", options: ["Mention it only if asked", "Always disclose it (allergen, not for infants)", "Leave it off the description"], correct: 1, why: "Always disclose allergens." },
      { q: "Bone broth is best described as…", options: ["A gut-healing treatment", "A warm, savory, protein-forward option", "A weight-loss drink"], correct: 1 },
    ],
  },

  // ═══════════════ Phase 5 — Equipment Mastery ═══════════════
  {
    slug: "nitro-mastery", section: "equipment", title: "Nitro System Mastery — pour a perfect cascade, fix a bad one", estMin: 12,
    summary: "How the nitro system works, how to pour it right, and how to diagnose a flat or wild pour in the field.",
    whyItMatters: "Nitro is the showpiece — the cascade is half the product. A flat, fizzy, or foamy pour in front of a line tells the guest we're amateurs. Knowing the system means you fix it in 60 seconds instead of pulling it off the menu.",
    objectives: ["Explain why we use pure nitrogen, not CO₂", "Pour a clean cascade with a tight head", "Diagnose the three most common bad pours"],
    body: [
      { h: "Pure nitrogen, not CO₂ — and why it matters", p: "We run PURE NITROGEN (N₂), not CO₂. Nitrogen is far less soluble in liquid, so it comes out as tiny bubbles that create the signature cascade and creamy head — without the sharp carbonated 'fizz' and acidity that CO₂ adds. Using a CO₂ tank or a mixed-gas tank by mistake will ruin the pour and the taste. Always confirm the cylinder is N₂." },
      { h: "The chain, end to end", p: "N₂ cylinder → regulator (sets working pressure) → gas line → keg of cold brew → liquid line → stout faucet with a restrictor plate. The restrictor plate is the small disc with tiny holes behind the spout — forcing the beer through it is what breaks the nitrogen into that fine cascade. Keep the keg cold and at the right pressure; warm or wrong-pressure kegs pour badly." },
      { h: "How to pour", p: "Open the faucet fully (don't crack it half-open), pour straight down the center, no ice. Let it cascade and settle into a tight, creamy head before you hand it over. Presentation is part of the product — a settled glass beats a rushed one." },
      { h: "Daily + weekly care", p: "The #1 cause of a flat, no-cascade pour is a clogged restrictor plate. DAILY in service, pull the spout and flush the disc with hot water. WEEKLY, take the faucet apart, soak the parts in food-safe beer-line cleaner, clear every tiny hole in the disc with the brush/pin, rinse very well, reassemble, and pour a test glass." },
    ],
    mistakes: ["Mistaking a CO₂ or mixed-gas tank for N₂ — always confirm pure nitrogen", "Cracking the faucet half-open (kills the cascade) instead of opening it fully", "Letting the restrictor disc clog because daily flushing got skipped", "Serving a warm keg and blaming the gas"],
    founderInsight: "The cascade is a promise that we sweat the details. If it pours flat, we don't serve it and apologize for it — we fix it. A bad nitro pour is never 'good enough.'",
    scenarios: [
      { situation: "Flat pour, no cascade, mid-rush", doThis: "Most likely a clogged restrictor or low pressure. Pull the spout and flush the disc with hot water; check the regulator is at spec and the keg is cold. Re-pour a test before serving." },
      { situation: "Wild, foamy, all-head pour", doThis: "Usually warm keg or pressure too high. Lower the pressure toward spec and let the keg cool fully; foamy = gas breaking out too early." },
    ],
    quiz: [
      { q: "GT3 nitro uses…", options: ["CO₂", "Pure nitrogen (N₂)", "Mixed beer gas"], correct: 1, why: "Pure N₂ gives the fine cascade without CO₂'s fizz." },
      { q: "The #1 cause of a flat nitro pour is…", options: ["The glass", "A clogged restrictor disc / low pressure", "Too much ice"], correct: 1 },
      { q: "A wild, foamy pour usually means…", options: ["Keg too cold", "Warm keg or pressure too high", "Faucet too clean"], correct: 1 },
    ],
  },
  {
    slug: "coldbrew-power-mastery", section: "equipment", title: "Cold-Brew, Grinder & Power — keep the line running off-grid", estMin: 11,
    summary: "The grinder, the brewing vessels, and the power chain (EcoFlow / generator) — run them, clean them, and never go dark.",
    whyItMatters: "Everything we serve starts at the grinder and runs on power we bring ourselves. A wrong grind ruins a whole batch; a tripped breaker stops the whole bar. Knowing these systems is the difference between a hiccup and a dead service.",
    objectives: ["Grind to the cold-brew spec and care for the burrs", "Clean and sanitize a brewing vessel correctly", "Stage power so you never trip a breaker mid-rush"],
    body: [
      { h: "Grinder — coarse and clean", p: "Cold brew wants a COARSE, even grind (think coarse sea salt). Too fine over-extracts and clogs filters; too coarse under-extracts and tastes weak. The burrs are a consumable: dry-brush only, NEVER wash with water (steel burrs rust), and don't oil them. Once a month run cleaning tablets through and re-season with a little coffee." },
      { h: "Brewing vessels — the spec lives here", p: "Toddy (2.5 gal, filter bag) and the Cold Brew Avenue vessel (~5 gal, basket + tap) are where the 1:13, ~18-hr spec happens. Clean every use; deep-clean + sanitize on cadence with a no-rinse food-safe sanitizer (Star San — no-rinse means don't rinse it off). Watch tap seals and basket fit; a bad seal drips your yield onto the floor." },
      { h: "Power — bring your own, stage your loads", p: "Off-grid, the EcoFlow Delta Pro (and the generator on the trailer) is the bar's heart. The lesson from the field: a generator carries the running watts PLUS the biggest startup surge. Motors and heating elements (water heater, AC, blender, ice maker) spike 2–4× on startup. Never bring two big draws up at once — stagger them — or a startup surge trips the breaker and the bar goes dark." },
      { h: "If the power drops", p: "Don't panic-flip everything back on at once (that re-trips it). Shed the big loads, bring the generator/EcoFlow back up, then add appliances ONE at a time, biggest last. Keep the kegerator and cold storage prioritized so the product stays safe and cold." },
    ],
    mistakes: ["Washing the grinder burrs with water (they rust) instead of dry-brushing", "Rinsing off no-rinse sanitizer", "Starting the water heater and AC at the same instant and tripping the generator", "Re-energizing everything at once after a trip"],
    founderInsight: "We chose to be self-sufficient on power so a venue's bad outlet can never end our day. That only works if the crew understands the load. Respect the surge and you'll never go dark.",
    scenarios: [
      { situation: "Breaker trips when a second appliance kicks on", doThis: "Classic surge overload. Shed loads, restore power, then bring appliances up one at a time, biggest last. If it keeps tripping, you're over the generator's capacity — run fewer big draws at once." },
      { situation: "Cold brew tastes weak across a whole batch", doThis: "Check grind (too coarse?), ratio (1:13?), and that it got the full ~18 hrs. One of those three is almost always the cause." },
    ],
    quiz: [
      { q: "Cold brew needs what grind?", options: ["Espresso-fine", "Coarse and even", "Powder"], correct: 1 },
      { q: "You clean the grinder burrs by…", options: ["Washing with hot soapy water", "Dry-brushing only — never water", "Oiling them"], correct: 1, why: "Water rusts steel burrs." },
      { q: "After a generator trips, you…", options: ["Flip everything back on at once", "Shed loads, restore, then add appliances one at a time", "Give up and go home"], correct: 1 },
    ],
  },

  // ═══════════════ Phase 6 — Hospitality Excellence ═══════════════
  {
    slug: "hospitality-excellence", section: "cx", title: "Hospitality Excellence — Four-Seasons service at a beverage bar", estMin: 12,
    summary: "Greet, read, educate, and create a memorable moment — luxury hospitality without arrogance.",
    whyItMatters: "Product gets a guest to try us once. Hospitality is what makes them come back and bring a friend. At a busy event you ARE the brand — the same warmth, the same knowledge, every single guest, whether it's the first or the four-hundredth.",
    objectives: ["Run the greet → read → educate → close flow", "Make a confident recommendation in one sentence", "Turn a line into an experience, not a wait"],
    body: [
      { h: "Presence first", p: "Four Seasons hospitality isn't fancy words — it's undivided attention. Look up, make eye contact, smile, and greet before they reach the counter. A guest who feels seen forgives a wait; a guest who feels processed remembers it. Luxury without arrogance: we're warm and confident, never stiff or superior." },
      { h: "Read the guest in five seconds", p: "Are they in a hurry or browsing? New or a regular? Confident or overwhelmed by the menu? Match them: the rushed runner wants 'Rise, our cold brew, want it over ice?' — fast and decisive. The curious browser wants a 15-second story. Reading personalities is the skill that makes the same menu feel personal." },
      { h: "Educate without preaching", p: "Lead with the one-liner: name, what it is, why it exists — in plain language. 'Flow is our cold brew infused with cacao, smooth and steady.' Stop there unless they want more. Nobody came for a lecture; teach only as much as the guest invited." },
      { h: "Make the call for them", p: "An overwhelmed guest doesn't want ten options — they want your pick. 'If it's your first time, I'd start with Rise.' A confident recommendation is a gift, not a sale. Then upsell as care, not pressure: 'Want a Nature Aid to hydrate alongside it?'" },
      { h: "The memorable moment", p: "The settle on a nitro pour, remembering a regular's order, a genuine 'enjoy the rest of your day' — small, real touches are what they tell a friend about. The goal: every guest leaves having had a better minute than they expected." },
    ],
    mistakes: ["Talking AT the guest with every nutrient instead of the one-liner", "Treating the rushed guest and the curious guest the same way", "Letting a line feel like a DMV — no eye contact, no warmth", "Upselling as pressure instead of as care"],
    founderInsight: "I'd rather a guest remember how we made them feel than the exact caffeine number. Get the feeling right and they trust the rest. That's the whole game.",
    scenarios: [
      { situation: "Long line, guest looks impatient", doThis: "Acknowledge them early with eye contact and 'I've got you in just a sec.' Then be fast and decisive — recommend, don't deliberate. Felt-seen beats fast." },
      { situation: "Guest is overwhelmed: 'I don't know, what's good?'", doThis: "Make the call: 'First time? Start with Rise — our smooth cold brew over ice. You'll know in one sip.' Confidence relaxes them." },
    ],
    quiz: [
      { q: "Best response to an overwhelmed guest?", options: ["List the whole menu", "Make a confident one-line recommendation", "Tell them to decide and come back"], correct: 1 },
      { q: "'Luxury without arrogance' means…", options: ["Stiff and formal", "Warm, confident, attentive — never superior", "Upsell everything hard"], correct: 1 },
      { q: "You educate a guest by…", options: ["Reciting every nutrient", "Leading with the one-liner, more only if they want it", "Avoiding questions"], correct: 1 },
    ],
  },

  // ═══════════════ Phase 8 — Operational Excellence ═══════════════
  {
    slug: "operating-cadence", section: "excellence", title: "The Operating Cadence — checklists, par, waste & the numbers", estMin: 11,
    summary: "Daily, weekly, and monthly rhythms that keep quality and margin from drifting — and the few numbers every operator watches.",
    whyItMatters: "Consistency isn't a vibe — it's a cadence. The reason every visit is the same is that someone runs the same checklist every day and watches the same numbers every week. Skip the rhythm and quality and margin both quietly erode.",
    objectives: ["Run the open/close checklist without missing a safety-critical step", "Set and hold par levels so you never run dry or over-buy", "Name the handful of numbers that tell you if the day worked"],
    body: [
      { h: "Daily — open and close the same way every time", p: "Open: power up and stage loads, temps checked on cold storage, nitro test-poured, stations stocked to par, POS + reader tested in offline mode, hands + surfaces clean. Close: reconcile the day, break down and clean every contact surface, flush the nitro disc, log what ran low, secure product cold. The checklist exists so the tired end-of-day version of you doesn't skip the step that matters." },
      { h: "Weekly — deeper clean + restock to par", p: "Weekly: deep-clean the faucet/restrictor, sanitize vessels, inspect seals and O-rings, count inventory against par, place orders for what's below reorder point, and review the week's incidents so the same problem doesn't repeat." },
      { h: "Monthly — audit + cadence gear", p: "Monthly: grinder deep clean, equipment maintenance cadences (the asset maintenance log tells you what's due), a real inventory audit, and a look at waste — what got thrown out and why." },
      { h: "Par, waste & cost — the discipline", p: "Par level = the amount of each item you keep on hand so you never run out but never over-stock. Order back to par, not by guesswork. Waste is margin on the floor: track what's dumped (expired, over-batched, spilled) and fix the cause. Cost control is choosing the standard ingredient AND not wasting it — both at once." },
      { h: "The numbers that matter", p: "You don't need a finance degree — you need a few signals: did we hit our sales for the event, what was our best/worst seller, did we run anything out (lost sales), what did we waste, and did any incident cost us time or product. Those five tell you if the day worked." },
    ],
    mistakes: ["Treating the checklist as optional when you're tired (that's exactly when it's load-bearing)", "Ordering by gut instead of back to par", "Ignoring waste because 'it's just a little' — it's margin", "Not reviewing incidents, so the same failure repeats"],
    founderInsight: "Systems are how the standard survives a bad day. On a great day anyone looks good; the cadence is what makes the off day still feel like GT3.",
    scenarios: [
      { situation: "You keep running out of bottles mid-event", doThis: "Your par is too low or you didn't stock to it. Raise the par for that item and confirm the open checklist stocks to par, not 'looks like enough.'" },
      { situation: "End of day, exhausted, tempted to skip the nitro flush", doThis: "Do it anyway — that's the whole point of the checklist. A skipped flush is tomorrow's flat pour in front of a line." },
    ],
    quiz: [
      { q: "A 'par level' is…", options: ["A score", "The on-hand amount that prevents running out without over-stocking", "A cleaning step"], correct: 1 },
      { q: "You should order…", options: ["By gut feel", "Back to par, based on the count", "Only when you're fully out"], correct: 1 },
      { q: "Why run the checklist when tired?", options: ["You shouldn't", "That's exactly when steps get skipped — it's load-bearing then", "To look busy"], correct: 1 },
    ],
  },

  // ═══════════════ Phase 9 — Leadership ═══════════════
  {
    slug: "think-like-owner", section: "leadership", title: "Think Like an Owner — decisions, accountability, brand stewardship", estMin: 10,
    summary: "How to make the call the founder would make when no SOP covers it, own the outcome, and protect the brand.",
    whyItMatters: "The academy's whole test is: 'If Ryan wasn't here, would this person make the same decision?' Leadership is what closes that gap — making owner-grade calls under pressure and being accountable for them.",
    objectives: ["Apply the GT3 decision filter to a judgment call", "Own a mistake the way an owner does", "Train someone else to the standard"],
    body: [
      { h: "The decision filter", p: "When no SOP covers it, run the call through three questions in order: (1) Is it SAFE and honest? (food safety, no false claim — non-negotiable). (2) Does it protect the GUEST experience and the brand standard? (3) Is it sustainable for the business (cost, time, repeatable)? If a choice fails #1 it's dead no matter how good for #3. That ordering IS the brand." },
      { h: "Default to the standard, not the shortcut", p: "Under pressure the tempting move is the shortcut — serve the flat pour, skip the disclosure, stretch the claim. An owner eats the small cost now to protect the standard, because the standard is the asset. 'Would I be proud to hand this to a stranger and tell them what's in it?' If not, remake it." },
      { h: "Accountability", p: "Owners don't hide a miss — they surface it fast, fix it, and prevent the repeat. 'I poured a bad batch, I dumped it, here's what I changed' is exactly right. The incident log and the recap exist so a mistake becomes a lesson the whole team gets, not a secret." },
      { h: "Stewardship — you carry the brand", p: "At an event you're not 'working for' GT3, you ARE GT3 to every guest. Brand stewardship means the standard doesn't relax because the founder isn't watching. Train the next person to that bar: show, explain the why, watch them do it, give the real feedback." },
    ],
    mistakes: ["Optimizing for speed/cost (#3) over safety/honesty (#1)", "Hiding a mistake instead of surfacing and fixing it", "Letting the standard slip because no one's watching", "Training someone on the 'what' without the 'why' — so they can't adapt"],
    founderInsight: "I don't need clones. I need people who hold the same standard I do, so that when something happens I didn't plan for, they protect the brand the way I would. That's the only way GT3 scales past me.",
    scenarios: [
      { situation: "Slammed, and a batch is slightly off-spec. Serve it or dump it?", doThis: "Dump it. Off-spec fails the brand-standard filter, and 'we were busy' isn't a reason a guest accepts. Eat the small loss; protect the asset." },
      { situation: "You made a real mistake at an event", doThis: "Surface it immediately, fix what you can now, log it, and say what you'll change. Owners make mistakes recoverable by being fast and honest about them." },
    ],
    quiz: [
      { q: "First question in the GT3 decision filter?", options: ["Is it cheapest?", "Is it safe and honest?", "Is it fastest?"], correct: 1, why: "Safety + honesty is non-negotiable and comes first." },
      { q: "A slightly off-spec batch during a rush should be…", options: ["Served — we're busy", "Remade/dumped — the standard is the asset", "Discounted"], correct: 1 },
      { q: "Owning a mistake looks like…", options: ["Hiding it", "Surfacing it fast, fixing it, preventing the repeat", "Blaming the gear"], correct: 1 },
    ],
  },

  // ═══════════════ Phase 10 — GT3 Philosophy ═══════════════
  {
    slug: "how-gt3-thinks", section: "philosophy", title: "How GT3 Thinks — the principles you solve problems with", estMin: 9,
    summary: "The handful of principles that, once you hold them, let you handle anything the manual didn't cover.",
    whyItMatters: "We can't write an SOP for every situation. The point of philosophy is that if you understand HOW we think, you can make the right call in a moment we never anticipated — which is most of the real ones.",
    objectives: ["State the GT3 principles in your own words", "Use a principle to resolve a situation no SOP covered"],
    body: [
      { h: "Pure Signal. No Noise.", p: "Signal is measured substance — real ingredients, honest process, consistent quality. Noise is hype, additives, shortcuts, and unsupported claims. Every decision adds signal or noise. When unsure, ask which one you're about to add." },
      { h: "Consistency is the product", p: "The thing we actually sell is the SAME experience every time. A brilliant one-off pour that can't be repeated is worse than a good one that always lands. Repeatability beats heroics." },
      { h: "Honesty is a feature, not a constraint", p: "We never need to invent a benefit because the real story is good enough. 'I don't know, I'll confirm' builds more trust than a confident guess. The day we'd have to lie to sell it is the day we change the product, not the pitch." },
      { h: "Details are the message", p: "The settle on a pour, the clean counter, the disclosed allergen — guests can't always name why we feel premium, but they feel it. The details ARE the brand telling them we care." },
      { h: "Teach the why, and people self-correct", p: "Rules without reasons break the moment they don't fit. Reasons travel — give someone the why and they'll make the right call in a situation you never listed." },
    ],
    founderInsight: "If I did my job, you don't memorize GT3 — you think in it. Then you don't need me in the room, because the principle is.",
    scenarios: [
      { situation: "A request comes up that no rule covers", doThis: "Run it through the principles: does it add signal or noise? Is it honest? Is it repeatable? The right answer is usually obvious once you ask which principle applies." },
    ],
    quiz: [
      { q: "'Noise' in Pure Signal. No Noise. is…", options: ["Loud events", "Hype, additives, shortcuts, unsupported claims", "Talking to guests"], correct: 1 },
      { q: "A repeatable good pour vs. a brilliant one-off?", options: ["The one-off — wow them", "The repeatable one — consistency is the product", "Neither matters"], correct: 1 },
      { q: "When no SOP covers a situation, you…", options: ["Freeze", "Apply the principles (signal? honest? repeatable?)", "Guess confidently"], correct: 1 },
    ],
  },

  // ═══════════════ The GT3 Playbook ═══════════════
  {
    slug: "founders-playbook", section: "playbook", title: "The Founder's Playbook — why we built it this way", estMin: 10,
    summary: "The institutional memory: the reasoning behind GT3's biggest decisions, so the brand is bigger than any one founder.",
    whyItMatters: "Most of what makes GT3 GT3 is invisible — it's the WHY behind a hundred choices. Capture that and the brand can outlive and out-scale its founder. Lose it and a new operator re-litigates settled questions and slowly drifts off-brand.",
    objectives: ["Recall the reasoning behind a core GT3 decision", "Avoid re-opening a question the founder already settled — and know which ones are open"],
    body: [
      { h: "Why cold extraction (not hot, not nitro-only)", p: "We built the whole base on cold extraction because the smoothness is real and repeatable, and it gives us one base (Rise/Flow/Dusk/Nitro all share it) — simpler to run, consistent to serve. One great base beats five mediocre brewers." },
      { h: "Why one base and the same caffeine across Rise/Flow/Dusk", p: "Three flavors, one spec, same ~210 mg/10 oz. It keeps batching simple, training simple, and the honest answer simple — a guest can choose by flavor, not by guessing strength. Consistency over complexity." },
      { h: "Why 'estimated until lab-verified' on nutrition", p: "We'd rather under-claim and be trusted than over-claim and get caught. The Risk Register made this a hard rule: no unsupported physiological or comparative claims, ever. Trust compounds; a single caught exaggeration doesn't." },
      { h: "Why pure nitrogen, self-sufficient power, and our own water spec", p: "Each is a 'control the variable' decision: N₂ for the pour we want, our own power so a venue can't end our day, a named water spec so the cup is the same in any city. We pay more up front to remove the thing that would make us inconsistent." },
      { h: "Why the app exists", p: "The GT3 app is this philosophy turned into systems — prep, run-of-show, inventory, brew schedule, incident log, and this Academy — so the standard runs even when the founder doesn't. The app is the brand's memory and nervous system." },
      { h: "What's still open", p: "Some things are settled (the claim rule, the base, N₂). Some are still evolving — menu additions, pricing, new markets. Know the difference: don't re-open settled safety/brand questions, and bring genuine new ideas to leadership rather than quietly changing the standard on the floor." },
    ],
    founderInsight: "Write down WHY, not just what. The 'what' is easy to copy and easy to drift from. The 'why' is what lets someone new make the call I'd make — and improve on it without breaking it.",
    quiz: [
      { q: "Why do Rise/Flow/Dusk share one base + caffeine?", options: ["We ran out of beans", "Consistency over complexity — choose by flavor, not strength", "To confuse guests"], correct: 1 },
      { q: "'Estimated until lab-verified' exists because…", options: ["We're lazy", "Under-claiming and being trusted beats over-claiming and getting caught", "It's required by law to say 'estimated'"], correct: 1 },
      { q: "The point of writing the Playbook is to capture…", options: ["What decisions were made", "WHY decisions were made, so the brand outlives the founder", "Nothing important"], correct: 1 },
    ],
  },
];

// ─────────────────────────── product education + cookbook ───────────────────────────
export interface Product {
  key: string; name: string; line: string; price?: string;
  what: string; why: string; ingredients: string[]; benefits: string[];
  customer: string; talking: string[]; faqs: { q: string; a: string }[];
  cookbook?: { batch?: string; brew?: string[]; serve?: string[]; storage?: string; quality?: string; troubleshoot?: { issue: string; fix: string }[] };
}

export const PRODUCTS: Product[] = [
  {
    key: "rise", name: "Rise", line: "Activation", price: "$7",
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
    cookbook: { batch: "Standard Batch — GT3 (1:13, ~18-hr cold extraction).", brew: ["Weigh beans 1:13 to mineral water", "Cold-extract ~18 hrs", "Filter, log batch + signal score (target 8+)"], serve: ["Pour over ice", "Top with organic coconut water", "Serve in glass, made to order"], storage: "Keep cold; use within the standard hold window.", quality: "Signal Score 8+ (Energy/Clarity/Flavor/Smoothness).", troubleshoot: [{ issue: "Too bitter", fix: "Check grind/time — over-extraction; pull back toward spec." }, { issue: "Weak", fix: "Verify 1:13 ratio and full 18-hr extraction." }] },
  },
  {
    key: "flow", name: "Flow", line: "Activation", price: "$7",
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
    cookbook: { batch: "Standard Batch — GT3 with cacao-nib infusion.", brew: ["Brew base to spec", "Infuse organic cacao nibs", "Filter and log batch"], serve: ["Pour over ice in glass"], storage: "Keep cold; standard hold window.", quality: "Signal Score 8+; cacao aroma present, not muddy.", troubleshoot: [{ issue: "Muddy/silty", fix: "Improve filtration after nib infusion." }] },
  },
  {
    key: "dusk", name: "Dusk", line: "Activation", price: "$7",
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
    cookbook: { batch: "Standard Batch — GT3 with cinnamon + cardamom.", brew: ["Brew base to spec", "Add Ceylon cinnamon + green cardamom", "Filter and log batch"], serve: ["Pour over ice; garnish per spec"], storage: "Keep cold; standard hold window.", quality: "Spice aromatic, balanced — not gritty.", troubleshoot: [{ issue: "Gritty", fix: "Use infusion, not loose ground spice in the bottle." }] },
  },
  {
    key: "nature_aid", name: "Nature Aid", line: "Hydration", price: "$8",
    what: "Whole-coconut hydration — young coconut water blended with Thai coconut meat, finished with a touch of raw honey.",
    why: "Real hydration that goes down easy during the work.",
    ingredients: ["Organic young coconut water", "Organic Thai coconut meat", "Raw honey", "Blended to order"],
    benefits: ["Whole-food hydration base", "Naturally smooth and easy to drink", "No powders, concentrate, or isolates"],
    customer: "The active guest mid-work or mid-training who wants real hydration, not a sports drink.",
    talking: ["Whole-coconut hydration with a touch of honey", "Blended to order from real coconut, not a powder", "Always mention the honey if asked about sugar"],
    faqs: [
      { q: "Is there added sugar?", a: "Yes — a touch of raw honey. The rest is coconut water and coconut meat. We disclose it; we don't claim 'no added sugar.'" },
      { q: "Is it a sports drink?", a: "No — it's whole-food, blended fresh, not a powder or concentrate." },
    ],
    cookbook: { batch: "Blend to order (no long batch).", brew: ["Combine young coconut water + Thai coconut meat", "Add measured raw honey per spec", "Blend until smooth"], serve: ["Serve cold, in glass, immediately"], storage: "Make to order; do not hold blended.", quality: "Smooth, no separation at serve.", troubleshoot: [{ issue: "Too sweet", fix: "Reduce honey to spec; honey is the only added sweetener." }, { issue: "Separating", fix: "Serve immediately after blend." }] },
  },
  {
    key: "nitro", name: "Nitro Cold Brew", line: "Activation", price: "$7",
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
    cookbook: { batch: "Keg the Standard Batch cold brew.", brew: ["Fill keg with cold brew to spec", "Charge with nitrogen", "Set pressure per kegerator spec (BBQGuys Nitro Kegerator)"], serve: ["Pour straight from tap, no ice", "Let it cascade and settle"], storage: "Keep kegerator cold and pressurized.", quality: "Tight cascade, fine head.", troubleshoot: [{ issue: "Flat pour", fix: "Check nitrogen pressure and line; re-charge." }, { issue: "Foamy/wild", fix: "Lower pressure / cool the keg fully." }] },
  },
  {
    key: "cold_extract", name: "Cold Extracted Coffee", line: "Foundation", price: "—",
    what: "The base behind the whole Activation line — single-origin coffee drawn cold over ~18 hours.",
    why: "Cold extraction is gentler than heat: rounder, less bitter, less acidic.",
    ingredients: ["Single-origin coffee", "Mineral water"],
    benefits: ["Smooth, low-bitterness base", "Consistent spec across every cart and trailer", "The foundation of Rise, Flow, Dusk, Nitro"],
    customer: "Every coffee guest — this is the foundation, not a menu item itself.",
    talking: ["Cold-extracted over ~18 hours, 1:13 to mineral water", "We do it 'out of respect for the coffee'", "It's the base for everything in Activation"],
    faqs: [
      { q: "Why cold and not hot?", a: "Heat pulls bitterness and acidity fast; cold draws the coffee gently over hours for a rounder brew." },
    ],
    cookbook: { batch: "Standard Batch — GT3: 1:13 beans to mineral water, ~18-hr extraction.", brew: ["Weigh to 1:13", "Cold-extract ~18 hrs", "Filter; log batch + signal score"], serve: ["Use as the base for Rise/Flow/Dusk/Nitro"], storage: "Keep cold; honor the hold window.", quality: "Signal Score 8+; smoothness is the watch metric.", troubleshoot: [{ issue: "Low smoothness signal", fix: "Adjust grind/time toward spec; re-profile." }] },
  },
  {
    key: "salted_maple", name: "Salted Maple Latte", line: "Specialty", price: "$8",
    what: "Cold-extracted coffee with real maple and a pinch of salt, balanced — not a sugar bomb.",
    why: "A touch of comfort and sweetness done with a real ingredient.",
    ingredients: ["Cold-extracted coffee", "Real maple", "Pinch of salt", "Milk or coconut base per build"],
    benefits: ["Balanced sweet-salty flavor", "Real maple, not flavored syrup", "Made to order"],
    customer: "The guest who wants a treat-leaning coffee but still real ingredients.",
    talking: ["Real maple and a pinch of salt — balanced, not a syrup bomb", "Disclose the maple as a sweetener", "Built on the same cold-brew base"],
    faqs: [
      { q: "Is it very sweet?", a: "It's balanced — real maple with salt to round it. Maple is the sweetener; we disclose it." },
    ],
    cookbook: { batch: "Build to order on the cold-brew base.", brew: ["Pull cold-brew base", "Add measured real maple + pinch of salt", "Add milk/coconut base per build"], serve: ["Over ice or steamed per build", "Made to order"], storage: "Make to order.", quality: "Sweet-salty balance; maple-forward, not cloying.", troubleshoot: [{ issue: "Too sweet", fix: "Cut maple to spec; add the salt pinch to balance." }] },
  },
  {
    key: "bone_broth", name: "Bone Broth", line: "Fuel", price: "$9",
    what: "Slow-simmered, pasture-raised bone broth (beef / bison / ostrich variants).",
    why: "A warm, savory rebuild for after the work.",
    ingredients: ["Slow-simmered bone broth", "Pasture-raised bones"],
    benefits: ["Warm, savory, real", "Slow-simmered for hours", "No bouillon, additives, or filler"],
    customer: "The post-training or cold-day guest who wants real food in a cup.",
    talking: ["Slow-simmered from pasture-raised bones", "Real broth, not bouillon", "Describe it as warm fuel — never make a medical claim"],
    faqs: [
      { q: "Is it like a soup?", a: "It's a sippable broth — savory, warm, made from real bones simmered slow." },
    ],
    cookbook: { batch: "Slow-simmer batch per broth spec.", brew: ["Simmer pasture-raised bones for hours per spec", "Strain, season to spec", "Cool and hold safely"], serve: ["Serve hot in cup", "Hold hot at safe temp"], storage: "Hold hot; discard outside safe hold window.", quality: "Clear, rich, well-seasoned; no off-notes.", troubleshoot: [{ issue: "Greasy", fix: "Skim fat; strain again." }, { issue: "Flat", fix: "Season to spec; check simmer time." }] },
  },
  {
    key: "coconut_shake", name: "Coconut Shake", line: "Hydration", price: "$8",
    what: "A thicker whole-coconut blend — coconut water and meat blended rich, lightly sweetened with honey.",
    why: "A more indulgent, creamy take on whole-coconut hydration.",
    ingredients: ["Organic young coconut water", "Organic coconut meat", "Raw honey", "Blended to order"],
    benefits: ["Rich, creamy, whole-food", "No dairy", "Blended fresh"],
    customer: "The guest who wants Nature Aid but creamier and more filling.",
    talking: ["A creamier whole-coconut blend, no dairy", "Sweetened with a touch of honey — disclose it", "Blended to order"],
    faqs: [
      { q: "Dairy?", a: "None — the creaminess is the coconut meat." },
      { q: "Sugar?", a: "A touch of raw honey; the rest is coconut. We disclose the honey." },
    ],
    cookbook: { batch: "Blend to order.", brew: ["Blend coconut water + extra coconut meat for body", "Add honey to spec"], serve: ["Serve cold immediately"], storage: "Make to order.", quality: "Creamy, smooth, no separation.", troubleshoot: [{ issue: "Too thin", fix: "Add coconut meat for body." }] },
  },
];

// ─────────────────────────── certifications ───────────────────────────
export interface Cert { key: string; title: string; blurb: string; modules: string[] }
export const CERTS: Cert[] = [
  { key: "brand", title: "Brand Certified", blurb: "Knows who GT3 is and the Pure Signal standard.", modules: ["welcome-gt3", "brand-pure-signal"] },
  { key: "cx", title: "Customer Experience Certified", blurb: "Greets, educates, and serves to standard.", modules: ["customer-experience"] },
  { key: "product", title: "Product Certified", blurb: "Knows the lineup and the nutrition philosophy honestly.", modules: ["primal-nutrition", "product-knowledge"] },
  { key: "event", title: "Event Certified", blurb: "Can run an event end to end.", modules: ["event-ops"] },
  { key: "inventory", title: "Inventory Certified", blurb: "Keeps the bar stocked and the books clean.", modules: ["inventory-ops"] },
  { key: "ops", title: "Operations (Cart) Certified", blurb: "Can run the cart and the line.", modules: ["cart-ops"] },
  { key: "trailer", title: "Trailer Certified", blurb: "Can run the full trailer activation.", modules: ["trailer-ops"] },
];

// ─────────────────────────── role learning paths ───────────────────────────
export interface RolePath { role: Role; certs: string[] }
export const ROLE_PATHS: RolePath[] = [
  { role: "contractor", certs: ["brand", "cx"] },
  { role: "staff", certs: ["brand", "cx", "product"] },
  { role: "operator", certs: ["brand", "cx", "product", "ops", "inventory"] },
  { role: "event_manager", certs: ["brand", "cx", "product", "event", "ops", "trailer", "inventory"] },
  { role: "admin", certs: ["brand", "cx", "product", "event", "ops", "trailer", "inventory"] },
  { role: "founder", certs: ["brand", "cx", "product", "event", "ops", "trailer", "inventory"] },
];

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
export const CERT_EXPIRY_DAYS: Record<string, number> = {
  brand: 0, cx: 365, product: 730, event: 365, inventory: 365, ops: 365, trailer: 365,
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
