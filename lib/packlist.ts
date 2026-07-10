import type { EventRow } from "./db";

// Deterministic pack list derived from the event's rig + menu flags. This is "workflow
// as data" (the validated R3): two archetypes resolve to a checklist — NOT a configurable
// engine. Mirrors the GT3 — Event Pack Lists manifests in Notion (the critical spine).
// tiers: critical = a hard gate (can't serve / illegal without it) → red.
//        warn     = important, bring-a-backup → amber. plain = consumable/nice-to-have.
export interface PackItem { label: string; section: string; critical?: boolean; warn?: boolean }

// The five legacy menu_* boolean columns (0024/0095) as a type, shared with MenuRigChips.
export type MenuFlagKey = "menu_nitro" | "menu_nature_aid" | "menu_salted_maple" | "menu_bottles" | "menu_broth";

// products.slug → legacy menu flag. This is the cutover bridge for 0173_event_menu_items: the
// relation stores real product slugs (0062 seed + 0127 board), and this map keeps every boolean
// reader (this file, lib/economics.ts, lib/inventory.ts, the agent routes) consistent until the
// columns drop. 'salted-latte' is 0144's bulk twin of 'maple'; slugs with no entry (e.g. 'tide')
// simply carry no legacy signal.
export const MENU_SLUG_FLAGS: Record<string, MenuFlagKey> = {
  kingme: "menu_nitro",           // KING ME — the nitro pour (0127)
  aide: "menu_nature_aid",        // NATURE'S AIDE (0127)
  maple: "menu_salted_maple",     // SALTED MAPLE LATTE (0127)
  "salted-latte": "menu_salted_maple", // Salted Latte — 0144's premium bulk item, same kit
  rise: "menu_bottles",           // the $10 glass-bottled coffees (0062/0127)
  flow: "menu_bottles",
  dusk: "menu_bottles",
  forge: "menu_broth",            // the three bone broths (0062)
  hunt: "menu_broth",
  wild: "menu_broth",
};

// menuSlugs: the event/stop's event_menu_items product slugs (0173). When provided and non-empty
// it is the source of truth for the menu gates; otherwise the legacy booleans drive (pre-0173
// rows, or an owner whose relation was never written).
export function packListFor(e: EventRow, menuSlugs?: ReadonlySet<string> | null): PackItem[] {
  const items: PackItem[] = [];
  const trailer = e.rig === "trailer_plus_cart";
  const useSlugs = !!menuSlugs && menuSlugs.size > 0;
  const menuOn = (k: MenuFlagKey) =>
    useSlugs ? [...menuSlugs].some((s) => MENU_SLUG_FLAGS[s] === k) : !!e[k];

  // Power — trailer brings the genset; no power on site makes the EcoFlow mandatory.
  if (trailer) {
    items.push({ label: "Generator + fuel", section: "Power", critical: true });
    items.push({ label: "Shore-power kit", section: "Power", warn: true });
  }
  if (trailer || e.power_available === false) items.push({ label: "EcoFlow Delta Pro", section: "Power", critical: true });

  // Nitro chain — the spare regulator exists because of a past failure (warn, not gate).
  if (menuOn("menu_nitro")) {
    items.push({ label: `Nitrogen tank${trailer ? " ×2" : ""}`, section: "Nitro", warn: true });
    items.push({ label: "Regulator", section: "Nitro", warn: true });
    items.push({ label: "SPARE regulator", section: "Nitro", warn: true });
    items.push({ label: "Faucet kit + keg lines + coupler", section: "Nitro", warn: true });
    items.push({ label: "Cold-brew kegs (pre-charged)", section: "Nitro" });
  }

  // Bottles
  if (menuOn("menu_bottles")) {
    items.push({ label: "Coolers", section: "Bottles" });
    items.push({ label: "Bottle inventory", section: "Bottles" });
    items.push({ label: "Ice — load morning-of", section: "Bottles" });
  }
  if (menuOn("menu_nature_aid") || menuOn("menu_salted_maple")) items.push({ label: "Nature Aide / Salted Maple mix + milk (cold)", section: "Coffee / Iced" });
  if (menuOn("menu_broth")) items.push({ label: "Bone broth + broth cups", section: "Fuel" });

  // Water — no water on site is a health-code + functional requirement.
  if (e.water_available === false) {
    items.push({ label: "Potable water jugs", section: "Water", critical: true });
    items.push({ label: "Handwash station", section: "Water", critical: true });
  }

  // Service — always.
  items.push({ label: "KDS tablet — charged", section: "Service", critical: true });
  items.push({ label: "Square reader — test offline mode", section: "Service", critical: true });
  items.push({ label: "Bottles + lids + straws + napkins", section: "Service" });
  if (!trailer) items.push({ label: "Canopy + weights", section: "Service" });

  // Compliance — venue / indoor.
  if (trailer) items.push({ label: "COI + permit + load-in pass", section: "Compliance", critical: true });

  return items;
}
