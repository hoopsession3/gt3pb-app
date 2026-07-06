// The GT3 wordmark with the EXACT brand "3" — the verbatim-traced vector glyph
// (public/brand/3_outline_*.svg, the same asset used for the watermark), never the font "3".
// "GT" is set in the context color (cream on dark, ink on light); the brand 3 is always the
// signal-red glyph, matching the logo lockup pixel-for-pixel at any size.
export default function Gt3Mark({ tone = "ink", className }: { tone?: "ink" | "cream"; className?: string }) {
  const src = tone === "cream" ? "/brand/3_outline_cream.svg" : "/brand/3_outline_charcoal.svg";
  return (
    <span className={`g3${className ? ` ${className}` : ""}`} aria-label="GT3">
      <span aria-hidden="true">GT</span>
      <img className="g3-3" src={src} alt="" aria-hidden="true" />
    </span>
  );
}
