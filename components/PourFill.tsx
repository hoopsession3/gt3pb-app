// POUR-FILL "3" — the brand's loading state. The locked monogram outline (brand kit
// 06_decals_and_wordmarks/3_outline_cream.svg, served from /public/brand — never redrawn) becomes
// a mask, and gold pours up inside it. Styles live in globals.css (.g3pour family); browsers
// without CSS mask get the plain outline pulsing instead of a blank square.
export default function PourFill({ size = 46, label = "Brewing it up…" }: { size?: number; label?: string }) {
  return (
    <span className="g3pour-wrap" role="status" aria-label={label}>
      <span className="g3pour" style={{ width: size, height: size }} aria-hidden />
      <span className="g3pour-l">{label}</span>
    </span>
  );
}
