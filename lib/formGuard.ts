// Shared form guard — one rule for "is this row valid enough to save?", replacing the hand-rolled
// .trim() checks scattered across the app and the "insert a placeholder row then edit inline" pattern
// that produced "Untitled" / "New item" junk. Bind the result to BOTH the submit button
// (disabled={!ok}) AND the handler (if(!guard.ok){toast(guard.message);return}) so a keyboard/Enter
// submit can't bypass a disabled button.
//
// Rules of thumb (encode with the fields you pass):
//   • identity field (title/name/label) — always required on create AND edit, so nothing is "Untitled"
//   • money/quantity that drives a charge — required and > 0 (pass a number with min: 0)
//   • contact fields — required only when they're the point (delivery/pickup/booking)
export type GuardField = { label: string; value: unknown; min?: number };
export type GuardResult = { ok: boolean; missing: string[]; message: string };

// String fields must have non-space content; number fields must be finite and > min (default 0).
export function guard(fields: GuardField[]): GuardResult {
  const missing = fields
    .filter((f) => {
      const v = f.value;
      if (typeof v === "number") return !(Number.isFinite(v) && v > (f.min ?? 0));
      if (typeof v === "string") return v.trim().length === 0;
      return v == null;
    })
    .map((f) => f.label);
  const message =
    missing.length === 0 ? "" :
    missing.length === 1 ? `${missing[0]} is required` :
    `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]} are required`;
  return { ok: missing.length === 0, missing, message };
}

// Identity shorthand — true when a title/name/label is blank (the most common required check).
export const isBlank = (v: unknown): boolean => (typeof v === "string" ? v.trim().length === 0 : v == null);
