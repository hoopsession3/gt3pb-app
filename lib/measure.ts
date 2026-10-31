// A SIZE AS A SOURCE SAYS IT, IN INCHES (IMS7 correctness). Research reads sizes from makers' pages and spec sheets,
// in whatever unit they're printed; the library keeps inches. This reads the value and its unit — never by stripping
// what isn't a digit and calling the rest inches (the intake did that: "6 ft" became 6″, "1830 mm" 1830″) — converts
// the units it knows, keeps what was said, and refuses anything else with a reason. Pure.
//
//   units: in (in, inch, inches, ", ″) · ft (ft, foot, feet, ', ′) · mm · cm · m (m, meter(s), metre(s))
//   forms: 72 · 72.5 · "72 1/2" · "72½" · "6 ft" · "6' 2\"" · "6 ft 2 in" · "6′ 2½″" · "1,830 mm"
//   a plain number with no unit: inches — the field's own unit (w_in, d_in, h_in), as the research is told to give it
//   refused: another unit, a unit in the text that disagrees with the one given, words, a range, zero, negative, over 2400″

export type Measured = { ok: true; inches: number; original: { value: string; unit: string | null } } | { ok: false; why: string };

const UNIT: Record<string, "in" | "ft" | "mm" | "cm" | "m"> = {
  in: "in", inch: "in", inches: "in", '"': "in", "″": "in", "''": "in",
  ft: "ft", foot: "ft", feet: "ft", "'": "ft", "′": "ft",
  mm: "mm", millimeter: "mm", millimeters: "mm", millimetre: "mm", millimetres: "mm",
  cm: "cm", centimeter: "cm", centimeters: "cm", centimetre: "cm", centimetres: "cm",
  m: "m", meter: "m", meters: "m", metre: "m", metres: "m",
};
const PER_INCH: Record<"in" | "ft" | "mm" | "cm" | "m", number> = { in: 1, ft: 12, mm: 1 / 25.4, cm: 1 / 2.54, m: 1 / 0.0254 };
const VULGAR: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875, "⅓": 1 / 3, "⅔": 2 / 3 };
export const MAX_INCHES = 2400;

const unitOf = (u: string | null | undefined): "in" | "ft" | "mm" | "cm" | "m" | null | undefined => {
  if (u == null || u.trim() === "") return null;
  return UNIT[u.trim().toLowerCase().replace(/\.$/, "")];   // undefined: a unit, but not one we know
};
/** "72", "72.5", "72 1/2", "72½", "1/2", "1,830" → a number, or null. */
function amount(s: string): number | null {
  const t = s.trim();
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ""));
  let m = /^(\d+(?:\.\d+)?)$/.exec(t); if (m) return Number(m[1]);
  m = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(t); if (m && Number(m[3]) > 0) return Number(m[1] ?? 0) + Number(m[2]) / Number(m[3]);
  m = /^(\d+)?\s*([½¼¾⅛⅜⅝⅞⅓⅔])$/.exec(t); if (m) return Number(m[1] ?? 0) + VULGAR[m[2]];
  return null;
}
const done = (inches: number, value: unknown, unit: string | null | undefined): Measured => {
  if (!Number.isFinite(inches) || inches <= 0) return { ok: false, why: "not a positive size" };
  if (inches > MAX_INCHES) return { ok: false, why: `over ${MAX_INCHES}″ — not a fixture's size` };
  return { ok: true, inches: Math.round(inches * 100) / 100, original: { value: typeof value === "string" ? value.trim().slice(0, 120) : String(value), unit: unit?.trim() || null } };
};

export function toInches(value: unknown, unit?: string | null): Measured {
  const given = unitOf(unit);
  if (given === undefined) return { ok: false, why: `unit not understood: ${String(unit).slice(0, 20)}` };
  if (typeof value === "number") return Number.isFinite(value) ? done(value * PER_INCH[given ?? "in"], value, unit) : { ok: false, why: "not a number" };
  if (typeof value !== "string" || !value.trim()) return { ok: false, why: "no size given" };
  const t = value.trim().toLowerCase().replace(/\s+/g, " ");
  // Feet and inches together: 6' 2", 6 ft 2 in, 6′ 2½″, 6 ft 2-1/2 in.
  const fi = /^(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|'|′)\s*(?:(\d+(?:\.\d+)?(?:[ -]\d+\/\d+)?|\d*\s*[½¼¾⅛⅜⅝⅞]|\d+\/\d+)\s*(?:in|inch|inches|"|″|'')?)?$/.exec(t);
  if (fi && fi[2] !== undefined) {
    if (given && given !== "in" && given !== "ft") return { ok: false, why: "the size's text and its unit disagree" };
    const inch = amount(fi[2].replace("-", " "));
    if (inch == null || inch >= 12) return { ok: false, why: "inches past 12 in a feet-and-inches size" };
    return done(Number(fi[1]) * 12 + inch, value, unit);
  }
  // A number (with a fraction) and maybe a unit.
  const m = /^(\d[\d,]*(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|\d*\s*[½¼¾⅛⅜⅝⅞⅓⅔])\s*([a-z"'″′]+\.?)?$/.exec(t);
  if (!m) return { ok: false, why: "not a size that can be read (words, a range, or more than one figure)" };
  const n = amount(m[1]);
  if (n == null) return { ok: false, why: "not a number" };
  const said = m[2] ? unitOf(m[2]) : null;
  if (said === undefined) return { ok: false, why: `unit not understood: ${m[2]}` };
  if (said && given && said !== given) return { ok: false, why: "the size's text and its unit disagree" };
  return done(n * PER_INCH[said ?? given ?? "in"], value, unit);
}
