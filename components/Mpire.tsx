// The 3MPIRE wordmark with the EXACT brand "3" — same law as Gt3Mark: the real signal-red glyph
// cropped from the logo asset (public/brand/gt3-3.png), never a font character standing in for the
// mark. "MPIRE" runs in the surrounding display face and color; the 3 carries the red, mirroring
// the GT3 lockup (cream GT · red 3). Sized in em so it rides any type scale it's dropped into —
// the .76em/.05em metrics are the same ones already tuned for Archivo Black in the .g3 masthead.
export default function Mpire({ className }: { className?: string }) {
  return (
    <span className={`mp3${className ? ` ${className}` : ""}`} aria-label="3MPIRE">
      <img className="mp3-3" src="/brand/gt3-3.png" alt="" aria-hidden="true" />
      <span aria-hidden="true">MPIRE</span>
    </span>
  );
}
