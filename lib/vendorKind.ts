// WHICH SIDE OF THE BUSINESS A BOOK ENTRY IS ON (0298) — the vocabulary of vendors.kind, once.
//
// A vendor row is somewhere we pour (venue), somewhere we buy from (supplier), or both; a row 0298's
// backfill never saw has no kind. lib/suppliers ranks the ones we buy from; the vendor cards in Plan
// say which each one is. Both read it here, and this file is deliberately nothing else: the cards sit
// in the crew console's first load, and lib/suppliers' ranking would have ridden in with them
// (measured 2026-10-05: about 450 bytes gzipped of code the console does not run until a purchase
// sheet opens).

export const isSupplierKind = (kind: string | null | undefined): boolean => kind === "supplier" || kind === "both";

/** "Venue" · "Supplier" · "Venue & supplier" — and nothing for a row with no kind, rather than a guess. */
export const vendorKindLabel = (kind: string | null | undefined): string =>
  kind === "venue" ? "Venue" : kind === "supplier" ? "Supplier" : kind === "both" ? "Venue & supplier" : "";
