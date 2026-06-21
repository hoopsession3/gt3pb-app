import type { EventRow } from "./db";
import type { PackItem } from "./packlist";

// Location-aware compliance items with official links. Researched from Fulton County
// Board of Health + GA DPH (June 2026). Honest by design: jurisdictions we've verified
// (GA/Fulton) get exact requirements + links; anywhere else gets a "confirm with the
// county" prompt rather than a fabricated requirement. Permit rules change — these track
// + link, they are not legal advice; the last item always points to the source of truth.
export interface ComplianceItem extends PackItem { link?: string }

const FULTON_BOH = "https://fultoncountyboh.com/environmental-health/food-service/";
const FULTON_APP = "https://www.fultoncountyga.gov/-/media/Departments/Board-of-Health/Environmental-Health/Restaurant-Inspection/Link-List-Items/Temporary-Event-Vendor-Application.pdf";
const GA_DPH = "https://dph.georgia.gov/environmental-health/food-service";
const GA_CFSM = "https://www.agr.georgia.gov/certified-food-protection-managers";

export function complianceFor(e: EventRow): ComplianceItem[] {
  const st = (e.state ?? "").trim().toLowerCase();
  const ga = st === "ga" || st === "georgia";
  const fulton = (e.county ?? "").toLowerCase().includes("fulton");
  const items: ComplianceItem[] = [];

  if (ga && fulton) {
    items.push({ label: "Temporary Food Service Permit — apply ≥30 days out", section: "Compliance", critical: true, link: FULTON_APP });
    items.push({ label: "Permit must go THROUGH the event organizer (no solo curb setup)", section: "Compliance", critical: true, link: FULTON_BOH });
    items.push({ label: "Person-in-charge food-safety knowledge (ServSafe/CFSM — recommended, not required for temp)", section: "Compliance", link: GA_CFSM });
    items.push({ label: "Call Fulton County Board of Health to confirm for the date", section: "Compliance", link: FULTON_BOH });
  } else if (ga) {
    items.push({ label: "Temporary Food Service Permit — county health dept, ≥30 days out", section: "Compliance", critical: true, link: GA_DPH });
    items.push({ label: "Confirm permit + food-safety rules with the county health dept", section: "Compliance", link: GA_DPH });
  } else if (e.state) {
    items.push({ label: `Temporary Food Service Permit — confirm ${e.state}${e.county ? " / " + e.county : ""} health-dept rules`, section: "Compliance", critical: true });
  } else {
    items.push({ label: "Set the event State + County (Back office → Events) to load permit requirements", section: "Compliance" });
  }

  // Universal on-site inspection items (what they check at any temp event).
  items.push({ label: "Permit + inspection report displayed on site", section: "Compliance" });
  items.push({ label: "Hot/cold holding thermometer + temp log", section: "Compliance" });
  if (e.water_available === false) items.push({ label: "Handwash station set up + working (no water on site)", section: "Compliance", critical: true });
  if (e.rig === "trailer_plus_cart") items.push({ label: "COI naming the venue as additional insured", section: "Compliance", critical: true });

  return items;
}
