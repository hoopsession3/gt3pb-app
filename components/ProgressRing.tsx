"use client";

// A telemetry progress ring — the Pit Wall / race-control read. An arc fills clockwise from the top
// as pct goes 0→1, animating smoothly on each update. Purely presentational; the caller owns pct and
// what sits in the middle.
export default function ProgressRing({
  pct, size = 52, stroke = 4.5, color = "var(--gold2)", children,
}: {
  pct: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  const off = c * (1 - p);
  const cx = size / 2;
  return (
    <div className="pring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(245,241,232,.12)" strokeWidth={stroke} />
        <circle
          cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off}
          transform={`rotate(-90 ${cx} ${cx})`}
          style={{ transition: "stroke-dashoffset .7s cubic-bezier(.3,.9,.3,1), stroke .3s ease" }}
        />
      </svg>
      {children != null && <div className="pring-mid">{children}</div>}
    </div>
  );
}
