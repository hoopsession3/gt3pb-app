// The GT3 wordmark with the EXACT brand "3" — the real pixels cropped straight from the logo asset
// (public/brand/gt3-3.png, isolated from gt3pb-handle.png), never a font or a trace. "GT" is set in
// the context color (cream on dark, ink on light); the brand 3 is the real signal-red glyph, so the
// mark matches the logo lockup pixel-for-pixel at any size. `tone` is accepted for call-site clarity
// but the 3 is always the red asset.
export default function Gt3Mark({ className }: { tone?: "ink" | "cream"; className?: string }) {
  return (
    <span className={`g3${className ? ` ${className}` : ""}`} aria-label="GT3">
      <span aria-hidden="true">GT</span>
      <img className="g3-3" src="/brand/gt3-3.png" alt="" aria-hidden="true" />
    </span>
  );
}
