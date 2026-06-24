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
export type Section = "welcome" | "brand" | "cx" | "product" | "nutrition" | "ops" | "cookbook";

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
export interface Module {
  slug: string;
  section: Section;
  title: string;
  summary: string;
  estMin: number;
  body: ModuleSection[];
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
