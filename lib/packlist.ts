import type { EventRow } from "./db";

// Deterministic pack list derived from the event's rig + menu flags. This is "workflow
// as data" (the validated R3): two archetypes resolve to a checklist — NOT a configurable
// engine. Mirrors the GT3 — Event Pack Lists manifests in Notion (the critical spine).
export interface PackItem { label: string; section: string; critical?: boolean }

export function packListFor(e: EventRow): PackItem[] {
  const items: PackItem[] = [];
  const trailer = e.rig === "trailer_plus_cart";

  // Power — trailer brings the genset; no power on site makes the EcoFlow mandatory.
  if (trailer) {
    items.push({ label: "Generator + fuel", section: "Power", critical: true });
    items.push({ label: "Shore-power kit", section: "Power", critical: true });
  }
  if (trailer || e.power_available === false) items.push({ label: "EcoFlow Delta Pro", section: "Power", critical: true });

  // Nitro chain — the spare regulator exists because of a past failure.
  if (e.menu_nitro) {
    items.push({ label: `Nitrogen tank${trailer ? " ×2" : ""}`, section: "Nitro", critical: true });
    items.push({ label: "Regulator", section: "Nitro", critical: true });
    items.push({ label: "SPARE regulator", section: "Nitro", critical: true });
    items.push({ label: "Faucet kit + keg lines + coupler", section: "Nitro", critical: true });
    items.push({ label: "Cold-brew kegs (pre-charged)", section: "Nitro" });
  }

  // Bottles
  if (e.menu_bottles) {
    items.push({ label: "Coolers", section: "Bottles" });
    items.push({ label: "Bottle inventory", section: "Bottles" });
    items.push({ label: "Ice — load morning-of", section: "Bottles" });
  }
  if (e.menu_nature_aid || e.menu_salted_maple) items.push({ label: "Nature Aid / Salted Maple mix + milk (cold)", section: "Coffee / Iced" });
  if (e.menu_broth) items.push({ label: "Bone broth + broth cups", section: "Fuel" });

  // Water — no water on site is a health-code + functional requirement.
  if (e.water_available === false) {
    items.push({ label: "Potable water jugs", section: "Water", critical: true });
    items.push({ label: "Handwash station", section: "Water", critical: true });
  }

  // Service — always.
  items.push({ label: "KDS tablet — charged", section: "Service", critical: true });
  items.push({ label: "Square reader — test offline mode", section: "Service", critical: true });
  items.push({ label: "Cups + lids + straws + napkins", section: "Service" });
  if (!trailer) items.push({ label: "Canopy + weights", section: "Service" });

  // Compliance — venue / indoor.
  if (trailer) items.push({ label: "COI + permit + load-in pass", section: "Compliance", critical: true });

  return items;
}
