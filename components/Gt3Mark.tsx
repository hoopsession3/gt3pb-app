// The GT3 wordmark with the EXACT brand "3" — the real pixels cropped straight from the logo asset
// (public/brand/gt3-3.png, isolated from gt3pb-handle.png), never a font or a trace. "GT" is set in
// the context color (cream on dark, ink on light); the brand 3 is the real signal-red glyph, so the
// mark matches the logo lockup pixel-for-pixel at any size. `tone` is accepted for call-site clarity
// but the 3 is always the red asset.
// THE GLYPH AT THE SIZE IT IS SHOWN (R13 — the 10/10 audit's performance pass, F14): public/brand/gt3-3-glyph.png is
// the same master exported 240 pixels tall — sharp to an 80-point "3" on a 3× screen — 10 KB, where the 1660 × 2197
// original was 122 KB and 14 MB once decoded for a 20-point mark on every page. The splash's big 3 keeps the master.
export default function Gt3Mark({ className }: { tone?: "ink" | "cream"; className?: string }) {
  return (
    <span className={`g3${className ? ` ${className}` : ""}`} role="img" aria-label="GT3">
      <span aria-hidden="true">GT</span>
      <img className="g3-3" src="/brand/gt3-3-glyph.png" width={181} height={240} alt="" aria-hidden="true" />
    </span>
  );
}
