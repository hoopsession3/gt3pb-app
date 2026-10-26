import type { Format } from "../visionPlans";

// THE OPERATING MODELS, AS DATA (the shared spatial engine, 2026-10-26 — Ryan: "apply configurable operating-model-
// specific constraints and rules without duplicating the underlying engine"). A profile says which checks apply and with
// which dimensions; the engine (lib/spatial/evaluate) is one. A new operating model is a new row here, never new code.
//
// The dimensions are GT3's working defaults — the 36-inch aisle the studio has used since R52 — not a code requirement,
// and every one says so. They differ between models only where the model itself differs (who walks inside), not by an
// invented number: an owner or a professional sets real ones per model.
export type ModelKey = "brick_and_mortar" | "stationary_trailer" | "recurring_trailer" | "partnership" | "kiosk";

export type Profile = {
  key: ModelKey; name: string;
  /** Do guests walk inside? A trailer or kiosk serves through a window: the routes checked are the crew's. */
  publicInside: boolean;
  /** The clear width a route needs, in inches. */
  routeIn: number;
  /** The clear depth kept in front of equipment the crew works at, in inches. */
  workZoneIn: number;
  /** Doors: the area a door swings through is kept clear (its own width, assumed swinging in — checked on site). */
  doorSwing: boolean;
  /** Where the dimensions come from, said wherever a finding uses them. */
  basis: string;
};

const BASIS = "GT3 working default (the studio's 36-in aisle) — not a code requirement; set per model by an owner or a professional";

export const PROFILES: Record<ModelKey, Profile> = {
  brick_and_mortar:   { key: "brick_and_mortar",   name: "Storefront",                 publicInside: true,  routeIn: 36, workZoneIn: 36, doorSwing: true, basis: BASIS },
  stationary_trailer: { key: "stationary_trailer", name: "Stationary trailer",         publicInside: false, routeIn: 36, workZoneIn: 36, doorSwing: true, basis: BASIS },
  recurring_trailer:  { key: "recurring_trailer",  name: "Recurring trailer placement", publicInside: false, routeIn: 36, workZoneIn: 36, doorSwing: true, basis: BASIS },
  partnership:        { key: "partnership",        name: "Host partnership",           publicInside: true,  routeIn: 36, workZoneIn: 36, doorSwing: true, basis: BASIS },
  kiosk:              { key: "kiosk",              name: "Kiosk",                      publicInside: false, routeIn: 36, workZoneIn: 36, doorSwing: true, basis: BASIS },
};

/** The operating model a plan's format runs as. A pop-up is checked as a recurring placement until it has its own. */
export function modelOf(format: Format | null | undefined): ModelKey {
  switch (format) {
    case "kiosk": return "kiosk";
    case "gym_bar": case "shared_space": case "partner_menu": return "partnership";
    case "pop_up": return "recurring_trailer";
    default: return "brick_and_mortar";
  }
}
