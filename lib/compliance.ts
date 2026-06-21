import type { EventRow } from "./db";
import type { PackItem } from "./packlist";
import type { SupabaseClient } from "@supabase/supabase-js";

// Location-aware compliance, PULLED from the compliance_rules DB (0027) by jurisdiction,
// so it grows: add a row for a new city and every event there gets the right checklist.
// Honest by design — only jurisdictions seeded in the DB return real requirements; an
// unseeded location gets a "confirm with the county" prompt, never a fabricated rule.
export interface ComplianceItem extends PackItem { link?: string }

const norm = (s?: string | null) => (s ?? "").trim().toLowerCase().replace("georgia", "ga");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function complianceFor(e: EventRow, supabase: SupabaseClient | null): Promise<ComplianceItem[]> {
  const items: ComplianceItem[] = [];
  const st = norm(e.state), co = norm(e.county);
  let matchedJurisdiction = 0;

  if (supabase) {
    const { data } = await supabase
      .from("compliance_rules")
      .select("label,link,critical,sort,state,county")
      .eq("active", true)
      .order("sort");
    for (const r of (data ?? []) as { label: string; link: string | null; critical: boolean; state: string | null; county: string | null }[]) {
      const rSt = norm(r.state), rCo = norm(r.county);
      const stateOk = !rSt || rSt === st;       // null = universal
      const countyOk = !rCo || rCo === co;       // null = state-wide
      if (stateOk && countyOk) {
        items.push({ label: r.label, section: "Compliance", critical: !!r.critical, link: r.link ?? undefined });
        if (rSt || rCo) matchedJurisdiction++;   // count only real jurisdiction matches
      }
    }
  }

  // No jurisdiction set / no match → prompt, don't invent.
  if (!matchedJurisdiction && !st) {
    items.unshift({ label: "Set the event State + County (Back office → Events) to load permit requirements", section: "Compliance" });
  } else if (!matchedJurisdiction && st) {
    items.unshift({ label: `Confirm ${e.state}${e.county ? " / " + e.county : ""} temporary food permit rules with the county health dept`, section: "Compliance", critical: true });
  }

  // Event-flag conditionals (driven by the event's own config, not jurisdiction).
  if (e.water_available === false) items.push({ label: "Handwash station set up + working (no water on site)", section: "Compliance", critical: true });
  if (e.rig === "trailer_plus_cart") items.push({ label: "COI naming the venue as additional insured", section: "Compliance", critical: true });

  return items;
}
