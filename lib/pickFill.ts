// A FIELD FOLLOWS A PICK UNTIL SOMEONE TYPES OVER IT (2026-10-04, the form audit).
//
// When a form's subject is picked from a list — the person an offer letter or an operator agreement
// is for — its fields fill from what is on file for that person. Change the pick and they move with
// it, but only the ones nobody has touched: a field that is empty, or still holds exactly what the
// last pick put there, belongs to the form; anything else was typed, and belongs to the person
// typing. The customer forms keep the same promise a different way (useKnownField: what we know,
// until they type). This is the one rule for a form that fills from a pick.
//
// `was` may be several values (2026-10-05, the venue pick): a venue's place reaches a stop's "Where"
// as its place text, its name or its address, depending on which screen linked it — any of them is
// still the pick's, not the person's.

const t = (v: string | null | undefined) => (v ?? "").trim();

/** `cur` is the field now, `was` what the previous pick filled it with, `now` what this pick knows. */
export function follow(cur: string | null | undefined, was: string | null | undefined | readonly (string | null | undefined)[], now: string | null | undefined): string {
  // An empty `cur` takes the pick's value before `was` is looked at, so an empty `was` matches nothing.
  return !t(cur) || (Array.isArray(was) ? was : [was]).map(t).includes(t(cur)) ? (now ?? "") : (cur ?? "");
}
