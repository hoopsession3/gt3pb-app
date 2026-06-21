// Reusable shimmer skeleton — render while data/auth is resolving so screens never
// flash blank. `variant` maps to the .sk-* sizes in globals.css.
export default function Skeleton({ variant = "line", count = 1 }: { variant?: "line" | "row" | "card"; count?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`sk sk-${variant}`} />
      ))}
    </div>
  );
}
