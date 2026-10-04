// A US ADDRESS, PART BY PART (2026-10-04, the form audit).
//
// The merch checkout asked for the state in a 90px text box and lib/apliiqOrder sent the printer
// its first two letters, upper-cased: "New York" shipped as NE (Nebraska), "Mississippi" as MI
// (Michigan), "south carolina" as SO (nothing). A state is a pick from a fixed list — the checkout
// picks it now — and anything already typed into an order is read by its name or its code here,
// so an order placed before the pick list existed still reaches the right state on a resubmit.
//
// The ZIP is read here too: five digits, or ZIP+4, and nothing else reaches the printer.
//
// Free of imports, so scripts/smoke compiles and exercises it directly.

export const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
  ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
  ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"],
  ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"],
  ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
] as const;

const BY_CODE = new Set<string>(US_STATES.map(([c]) => c));
const BY_NAME = new Map<string, string>(US_STATES.map(([c, n]) => [n.toLowerCase(), c]));

/** "SC", "sc", "S.C.", "South Carolina", " south  carolina " → "SC". Anything else → null, never a guess. */
export function stateCode(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const letters = raw.replace(/[.\s]/g, "").toUpperCase();
  if (letters.length === 2 && BY_CODE.has(letters)) return letters;
  return BY_NAME.get(raw.replace(/\s+/g, " ").toLowerCase()) ?? null;
}

/** "29601", " 29601 ", "29601-1234", "296011234" → the ZIP as the post office writes it. Anything else → null. */
export function usZip(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim();
  if (!/^\d{5}(?:[-\s]?\d{4})?$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 9 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}
