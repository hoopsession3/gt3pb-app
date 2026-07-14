"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { DRINKS, MENU, type DrinkId } from "./menu";

// SITE COPY — owner/admin-editable front-end text. Every editable string has a stable key and a
// DEFAULT (the canonical copy). Overrides live in the `site_copy` table (0122); the front-end reads
// default-or-override, so the site never shows a blank and always works even before anything is
// edited. Add a new editable string = add one entry here and render it with useSiteCopy()'s t(key).
export type CopyMeta = { key: string; group: string; label: string; multiline?: boolean; default: string };

export const COPY_META: CopyMeta[] = [
  // ── Team board · back-office (the crew console) ──
  { key: "board.welcome", group: "Team board", label: "Crew welcome line", multiline: true,
    default: "Precision in every pour — let's make today one worth remembering." },
  // ── Launch countdown (home page banner) — every word + the date are yours; blank the date to hide ──
  { key: "launch.date", group: "Launch countdown", label: "Launch date (YYYY-MM-DD) — blank hides the banner",
    default: "2026-08-01" },
  { key: "launch.kicker", group: "Launch countdown", label: "Kicker",
    default: "Founding early access" },
  { key: "launch.headline", group: "Launch countdown", label: "Headline",
    default: "The first drop lands August 1." },
  { key: "launch.sub", group: "Launch countdown", label: "Supporting line", multiline: true,
    default: "Reserve a founding pack now and you're pouring on day one." },
  { key: "launch.cta", group: "Launch countdown", label: "Button",
    default: "Reserve yours" },
  // ── Home · signed-out (Arrival) ──
  { key: "home.statement", group: "Home · signed-out", label: "Hero statement", multiline: true,
    default: "We draw the coffee cold, blend the hydration from whole coconut, and simmer the broth slow — the long way, on purpose — then make every cup the moment you order it." },
  { key: "home.principles", group: "Home · signed-out", label: "Principles line",
    default: "Drawn cold, made to order, poured into glass" },
  { key: "home.cta", group: "Home · signed-out", label: "Primary button",
    default: "Start your order" },
  { key: "home.cta_sub", group: "Home · signed-out", label: "Button subtext", multiline: true,
    default: "Choose what you'd like and we'll have it waiting at the window." },
  { key: "home.signoff", group: "Home · signed-out", label: "Sign-off",
    default: "Pure Signal, No Noise." },
  // ── Member card (the status card popout) ──
  { key: "card.founding_thanks", group: "Member card", label: "Founding-member thank-you banner", multiline: true,
    default: "✦ Thank you for being a Founding Member — you were here first." },
  // ── Our Craft page (/craft) — every line editable. Ingredient blocks: one per line, "Name — fact". ──
  { key: "craft.eye", group: "Craft page", label: "Eyebrow", default: "Our Craft · The How" },
  { key: "craft.h1_l1", group: "Craft page", label: "Headline line 1", default: "We practice" },
  { key: "craft.h1_em1", group: "Craft page", label: "Headline emphasis 1", default: "art." },
  { key: "craft.h1_l2", group: "Craft page", label: "Headline line 2", default: "And" },
  { key: "craft.h1_em2", group: "Craft page", label: "Headline emphasis 2", default: "chemistry." },
  { key: "craft.lede", group: "Craft page", label: "Lede", multiline: true,
    default: "Every drink on our menu is built from whole, recognizable food — chosen on purpose, for what it does for you. Coffee to switch on, coconut and minerals to carry you, slow-simmered broth to rebuild. We treat each one as a craft, because your body runs on what you give it — and it deserves the good stuff." },
  { key: "craft.mol_cap", group: "Craft page", label: "Molecule caption", default: "Caffeine · three methyls, three 3s" },
  { key: "craft.fuel", group: "Craft page", label: "Philosophy band", multiline: true,
    default: "Your body is built to run on real, whole food — the way a well-made engine runs best on the right fuel. So we don't hedge: here's exactly what's in the cup, and what it does for you." },
  // Pillar 1 — Activation
  { key: "craft.act_label", group: "Craft page", label: "Activation — label", default: "01 · Activation" },
  { key: "craft.act_title", group: "Craft page", label: "Activation — title", default: "Switch on — clean." },
  { key: "craft.act_intro", group: "Craft page", label: "Activation — intro", multiline: true,
    default: "Cold-extracted coffee, drawn slow in cool water so it's smoother and less bitter — a steady, even lift, without the sugar-crash, because there's no refined sugar or syrup in it." },
  { key: "craft.act_items", group: "Craft page", label: "Activation — ingredients (one per line, Name — fact)", multiline: true,
    default: "Cold-extracted coffee — Steeped slow and cold for a smoother cup and an even lift. Caffeine is a well-studied stimulant — real energy, nothing artificial to process.\nOrganic cacao nibs · FLOW — Whole chocolate: theobromine (caffeine's gentler, longer-acting cousin) plus magnesium and cocoa flavanols, for a smoother, steadier focus.\nCeylon cinnamon + cardamom · DUSK — True cinnamon, naturally low in coumarin, with aromatic cardamom — warmth and depth, no sweetener needed.\nA2 goat milk, maple & sea salt · SALTED MAPLE LATTE — Naturally-A2 goat milk (many find it easier to digest), real maple for trace minerals like manganese, a pinch of sea salt. An afternoon treat that still eats clean.\nNitrogen · KING ME — Nothing but gas: micro-bubbles for a velvety, creamy pour — no dairy, no sugar." },
  // Pillar 2 — Hydration
  { key: "craft.hyd_label", group: "Craft page", label: "Hydration — label", default: "02 · Hydration" },
  { key: "craft.hyd_title", group: "Craft page", label: "Hydration — title", default: "Carry it through." },
  { key: "craft.hyd_intro", group: "Craft page", label: "Hydration — intro", multiline: true,
    default: "Real hydration is more than water — it's the minerals that carry it into you. We pour whole-food electrolytes: no powders, no dyes, no concentrate." },
  { key: "craft.hyd_items", group: "Craft page", label: "Hydration — ingredients (one per line, Name — fact)", multiline: true,
    default: "Organic coconut water — Naturally rich in potassium — the electrolyte most people run short on — plus sodium and magnesium. A whole-food electrolyte source.\nYoung Thai coconut meat + local honey · TIDE — Blended to order for real hydration that goes down easy, with a touch of unrefined honey.\nSea salt — Sodium, the body's primary electrolyte for fluid balance — the reason a little salt helps you actually hold your water.\nMineral water base — We build on mineral water, not stripped water, so there's substance behind every pour." },
  // Pillar 3 — Rebuild / Fuel
  { key: "craft.reb_label", group: "Craft page", label: "Rebuild — label", default: "03 · Rebuild / Fuel" },
  { key: "craft.reb_title", group: "Craft page", label: "Rebuild — title", default: "Rebuild after." },
  { key: "craft.reb_intro", group: "Craft page", label: "Rebuild — intro", multiline: true,
    default: "When you've spent yourself, you rebuild with real material — collagen, amino acids and minerals drawn out of bones over hours. No bouillon, no filler, no powder." },
  { key: "craft.reb_items", group: "Craft page", label: "Rebuild — ingredients (one per line, Name — fact)", multiline: true,
    default: "Slow-simmered bone broth · FORGE · HUNT · WILD — Bones and connective tissue simmered for hours into collagen, amino acids like glycine and proline, and minerals — a savory, whole-food source of protein, often ~8–10g a cup.\nPasture-raised beef, bison & ostrich — Cleaner sources, each with a profile: bison leaner with a little more iron and zinc, ostrich lighter still." },
  // The mark + close
  { key: "craft.mark_label", group: "Craft page", label: "The Mark — label", default: "04 · The Mark" },
  { key: "craft.mark_title", group: "Craft page", label: "The Mark — title", default: "Three methyls. Three 3s. GT3." },
  { key: "craft.mark_body", group: "Craft page", label: "The Mark — body", multiline: true,
    default: "Caffeine is one elegant molecule — a purine ring with three methyl groups at its nearest points. Three 3s, written into the chemistry itself. We didn't invent the coincidence; it's the structure. It's on the shirt. It's on the truck. It's the bar. Art meets chemistry, and they were the same thing all along." },
  { key: "craft.close_line", group: "Craft page", label: "Close line", default: "Perfectly design-crafted." },
  { key: "craft.cta_menu", group: "Craft page", label: "CTA — menu", default: "See the menu →" },
  { key: "craft.cta_reserve", group: "Craft page", label: "CTA — reserve", default: "Reserve a drop" },
  { key: "craft.signoff", group: "Craft page", label: "Sign-off", default: "Pure Signal, No Noise." },
  // ── Home · signed-in (Today) ──
  { key: "home.questions", group: "Home · signed-in", label: "Stack-builder intro", multiline: true,
    default: "Five questions and I'll build your stack for the day." },
  // ── Home · the three pillars (signed-out "What We Make") ──
  { key: "home.pillar1_t", group: "Home · pillars", label: "Pillar 1 — title", default: "Activation" },
  { key: "home.pillar1_d", group: "Home · pillars", label: "Pillar 1 — line", default: "Cold-extracted coffee to start the day clear." },
  { key: "home.pillar2_t", group: "Home · pillars", label: "Pillar 2 — title", default: "Hydration" },
  { key: "home.pillar2_d", group: "Home · pillars", label: "Pillar 2 — line", default: "Whole-coconut water to carry you through it." },
  { key: "home.pillar3_t", group: "Home · pillars", label: "Pillar 3 — title", default: "Fuel" },
  { key: "home.pillar3_d", group: "Home · pillars", label: "Pillar 3 — line", default: "Slow-simmered broth to rebuild after." },
  // ── Reserve card on the home screen ──
  { key: "pitch.kicker", group: "Reserve card", label: "Kicker", default: "Order Ahead" },
  { key: "pitch.headline", group: "Reserve card", label: "Headline", default: "The bottles you love, brewed to order." },
  { key: "pitch.body", group: "Reserve card", label: "Body", multiline: true,
    default: "Reserve a Saturday drop — ready the moment you reach the window. No plan, no commitment." },
  { key: "pitch.cta", group: "Reserve card", label: "Button", default: "Reserve this week's drop" },
  { key: "pitch.fine", group: "Reserve card", label: "Fine print", multiline: true,
    default: "Order by Wed 6 PM · pickup Saturday · bring bottles back for the best price." },
  // ── Reserve flow (order-ahead). {cutoff}/{pickup}/{size} are filled in live. ──
  { key: "reserve.kicker", group: "Reserve flow", label: "Kicker", default: "Order Ahead" },
  { key: "reserve.headline", group: "Reserve flow", label: "Headline", multiline: true, default: "Tell us you're coming, we'll brew it to order." },
  { key: "reserve.cutoff", group: "Reserve flow", label: "Cutoff line (uses {cutoff} and {pickup})", default: "Order by {cutoff} · pickup {pickup}" },
  { key: "reserve.fresh", group: "Reserve flow", label: "Fresh line", multiline: true, default: "Clean caffeine, whole-food botanicals — brewed to order, fresh 7 days." },
  { key: "reserve.window", group: "Reserve flow", label: "Footer / walk-up prices", multiline: true, default: "No commitment, no plan — just this drop.\nAt the window: $10 new · $8 bring-back · single bottle $10" },
  { key: "reserve.confirm_return", group: "Reserve flow", label: "Confirmation — bringing bottles back (uses {size})", multiline: true, default: "Don't forget your empties. Rinse them out and bring all {size} — that's what your pack price is built on. Fresh 7 days from pickup." },
  { key: "reserve.confirm_new", group: "Reserve flow", label: "Confirmation — new glass", multiline: true, default: "Your bottles are yours to keep — or bring them back next drop and unlock pack pricing. Fresh 7 days from pickup." },
  // ── Menu header ──
  { key: "menu.statement", group: "Menu", label: "Menu statement", multiline: true,
    default: "Drawn cold, simmered slow, blended from whole ingredients — every cup made the moment you order." },
  { key: "menu.order_line", group: "Menu", label: "Order prompt",
    default: "Order here, and it'll be waiting when you reach the window." },
  // ── Reserve (the signed-out storefront's story page) ──
  { key: "reserve.order_bar", group: "Reserve", label: "Order-from-the-bar button",
    default: "Order from the bar" },
  { key: "menu.integrity", group: "Menu", label: "Integrity line",
    default: "Everything real, poured into glass, made the moment you order" },
  { key: "menu.mto", group: "Menu", label: "Made-to-order line",
    default: "Made to order" },
  { key: "menu.packs_title", group: "Menu", label: "Packs — section title",
    default: "Take it home" },
  { key: "menu.packs_sub", group: "Menu", label: "Packs — section subtitle",
    default: "Saturday packs" },
  { key: "menu.packs_note", group: "Menu", label: "Packs — bring-back note", multiline: true,
    default: "Bring your empties back for pack pricing — or take new glass at $10 a bottle. You choose when you reserve." },
  // ── Truck page · the "what's on board" tagline per stop (keyed by the stop's menu tier) ──
  { key: "truck.tier.full", group: "Truck", label: "Tagline — full bar", default: "Full bar on board" },
  { key: "truck.tier.coffee", group: "Truck", label: "Tagline — coffee bar", default: "Coffee bar" },
  { key: "truck.tier.nitro", group: "Truck", label: "Tagline — nitro bar", default: "Nitro bar" },
  { key: "truck.tier.beer", group: "Truck", label: "Tagline — beer & wine", default: "Beer & wine on board" },
  { key: "truck.stop_note", group: "Truck", label: "Route row — note when a stop has none", multiline: true,
    default: "Full bar on board. Order ahead or save a reminder." },
  // ── Menu · sections + every drink. Names, tags, and descriptions are copy — PRICES ARE NOT:
  // the charge is computed server-side from the locked catalog / Square, so px stays in code.
  ...MENU.flatMap((s, i) => [
    { key: `menu.sec.${i}.name`, group: "Menu · sections", label: `${s.name} — title`, default: s.name },
    { key: `menu.sec.${i}.sub`, group: "Menu · sections", label: `${s.name} — subtitle`, default: s.wn },
  ]),
  ...(Object.keys(DRINKS) as DrinkId[]).flatMap((id) => {
    const d = DRINKS[id];
    const out: CopyMeta[] = [
      { key: `menu.${id}.name`, group: `Menu · ${d.n}`, label: "Name", default: d.n },
      { key: `menu.${id}.lines`, group: `Menu · ${d.n}`, label: "What it is (one line per row)", multiline: true, default: d.lines.join("\n") },
      { key: `menu.${id}.why`, group: `Menu · ${d.n}`, label: "Why it exists", multiline: true, default: d.why },
    ];
    if (d.tag) out.push({ key: `menu.${id}.tag`, group: `Menu · ${d.n}`, label: "Tag", default: d.tag });
    return out;
  }),
];

export const COPY_DEFAULTS: Record<string, string> = Object.fromEntries(COPY_META.map((m) => [m.key, m.default]));
export const copyDefault = (key: string): string => COPY_DEFAULTS[key] ?? "";

// Client hook: load overrides once, resolve default-or-override. Returns a stable t(key) function.
// Falls back to defaults if Supabase isn't configured or the row doesn't exist.
export function useSiteCopy(): (key: string) => string {
  const [over, setOver] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    supabase.from("site_copy").select("key, value").then(({ data }) => {
      if (live && data) setOver(Object.fromEntries((data as { key: string; value: string }[]).map((r) => [r.key, r.value])));
    });
    return () => { live = false; };
  }, []);
  return (key: string) => over[key] ?? COPY_DEFAULTS[key] ?? "";
}
