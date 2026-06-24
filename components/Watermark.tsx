// The Debossed Marque — one faint, edge-cropped GT3 "3" pressed into a few landmark surfaces.
//
// Decorative only: it sits BEHIND content (z-index:-1 inside a stacking-context parent), is
// pointer-transparent, and is aria-hidden. It uses the LOCKED outline-3 vector masters
// (public/brand/3_outline_{cream,charcoal}.svg) verbatim — never a redraw — recolored by world:
// the cream master on the dark arrival/partner surfaces, the charcoal ink master on the cream menu.
// One mark per screen, opacity in the app's --line hairline register. Placement + opacity live in
// globals.css (.wm / .wm--*). NOT mounted globally — opt-in per curated surface (see the screens that
// render it). The design rationale: an oversized glyph cropped hard by a screen edge reads as
// architecture pressed into the page, not a stamp.
export default function Watermark({ variant }: { variant: "landing" | "share" | "menu" }) {
  return <div aria-hidden role="presentation" className={`wm wm--${variant}`} />;
}
