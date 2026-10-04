import { isMarket, type Market } from "./markets";

// THE CITY A PERSON WORKS FROM (2026-10-04, the form audit).
//
// The one they lead, else the one they are in — or null when neither is a market, so a caller decides
// its own fallback instead of quietly inheriting Greenville. The same `leads_market || market` was
// written out in the smart-intake route, the offer letter and the operator agreement, and two more
// forms were about to copy it: a purchase's city, a new shelf's city and a hire's city start here.
//
// Beside lib/markets rather than in it on purpose: lib/markets rides in every public page's shared
// chunk (Turbopack carries a module whole), and only crew screens and server routes ask whose city a
// person works from — in it, this cost every guest 36 bytes for nothing.

export function homeMarket(p: { market?: unknown; leads_market?: unknown } | null | undefined): Market | null {
  const lead = p?.leads_market;
  if (isMarket(lead)) return lead;
  const home = p?.market;
  return isMarket(home) ? home : null;
}
