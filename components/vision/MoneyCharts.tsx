"use client";

import { useEffect, useRef, useState } from "react";
import { MONTHS, SCENARIO_WORD, dollars, type Model, type Scenario, type Swing } from "@/lib/visionMoney";

// THE MONEY, DRAWN (R54). Two pictures, one axis each (never two scales on one chart):
//   Cash — cash on hand month by month for each scenario, from the day the doors open (the startup cost spent, the
//   investment in): where it bottoms out is the cash the plan needs; where it crosses zero is payback. A hairline follows
//   the pointer to the nearest month and reads every scenario there. Legend above; each line named at its end too.
//   Swing — what moves 36 months' result most when one input moves ±20%: one bar each way, blue where it helps, red where
//   it hurts, the driver named beside it.
// Scenario hues are validated for the dark ground (scripts in the dataviz skill: all six checks pass on #191510).
// Each class written whole, so Tailwind and the CSS audit read the words (no class built from a variable).
export const SC_CLASS: Record<Scenario, string> = { conservative: "sc-cons", base: "sc-base", upside: "sc-up" };
export const SC_SWATCH: Record<Scenario, string> = { conservative: "vz-sw sc-cons", base: "vz-sw sc-base", upside: "vz-sw sc-up" };
const SC_LINE: Record<Scenario, [string, string]> = { conservative: ["line sc-cons", "line sc-cons on"], base: ["line sc-base", "line sc-base on"], upside: ["line sc-up", "line sc-up on"] };

export function CashChart({ models, focus, onPick }: { models: Partial<Record<Scenario, Model>>; focus: Scenario; onPick?: (month: number) => void }) {
  // IP1.3 (mobile): the drawing is as wide as its box, so 12px labels stay 12px on a phone instead of shrinking with a
  // 640-wide drawing to about 7px. Narrow boxes shorten the axis money ($20K) to keep the plot room.
  const box = useRef<HTMLElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => { const v = Math.round(e.contentRect.width); if (v > 0) setW(Math.max(300, Math.min(640, v))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = w < 480;
  const W = w, H = narrow ? 240 : 260, L = narrow ? 52 : 80, R = narrow ? 84 : 92, T = 16, B = 34;
  const axis = (v: number) => (narrow && Math.abs(v) >= 100000 ? `${v < 0 ? "−" : ""}$${Math.round(Math.abs(v) / 10000) / 10}K` : dollars(v));
  const shown = (Object.entries(models) as [Scenario, Model][]).filter(([, m]) => m.ok);
  const [at, setAt] = useState<number | null>(null);
  if (!shown.length) return null;
  // Month 0 is the opening: cash after the startup and the investment.
  const series = shown.map(([k, m]) => ({ k, pts: [m.months[0].cumulative - m.months[0].net, ...m.months.map((x) => x.cumulative)] }));
  const all = series.flatMap((s) => s.pts);
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const pad = (hi - lo) * 0.06 || 1;
  const y0 = lo - pad, y1 = hi + pad;
  const x = (m: number) => L + ((W - L - R) * m) / MONTHS;
  const y = (v: number) => T + ((H - T - B) * (y1 - v)) / (y1 - y0);
  const ticks = niceTicks(y0, y1, 5);
  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    const v = Math.max(0, Math.min(MONTHS, Math.round(((px - L) / (W - L - R)) * MONTHS)));
    setAt(v);
    onPick?.(v);   // IP1.4: the month a finger lands on opens in full beside the chart
  };
  return (
    <figure className="vz-fig" ref={box}>
      <figcaption className="vz-fig-h"><b>Cash in the bank</b><span>what&apos;s left after opening, plus each month&apos;s cash in and out</span></figcaption>
      <div className="vz-legend" role="list">{series.map((s) => <span key={s.k} role="listitem"><i className={SC_CLASS[s.k]} />{SCENARIO_WORD[s.k]}</span>)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="vz-chart" role="img" aria-label={`Cash on hand over ${MONTHS} months: ${series.map((s) => `${SCENARIO_WORD[s.k]} ends at ${dollars(s.pts[MONTHS])}, lowest ${dollars(Math.min(...s.pts))}`).join("; ")}`}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)} onPointerMove={(e) => pick(e.clientX, e.currentTarget)} onPointerLeave={(e) => { if (e.pointerType === "mouse") setAt(null); }}>
        {ticks.map((t) => <g key={t}><line className={t === 0 ? "zero" : "gl"} x1={L} x2={W - R} y1={y(t)} y2={y(t)} /><text className="tick" x={L - 8} y={y(t) + 4} textAnchor="end">{axis(t)}</text></g>)}
        {[0, 12, 24, 36].map((m) => <text key={m} className="tick" x={x(m)} y={H - 10} textAnchor="middle">{m === 0 ? "Open" : `Mo ${m}`}</text>)}
        {series.map((s) => (
          <polyline key={s.k} className={SC_LINE[s.k][s.k === focus ? 1 : 0]} fill="none"
            points={s.pts.map((v, m) => `${x(m).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} />
        ))}
        {series.filter((s) => s.k === focus).map((s) => {
          // On a narrow chart the label stacks in two short lines, so it fits the open space above the curve.
          const v = Math.min(...s.pts), m = s.pts.indexOf(v), rows = narrow ? [`Lowest ${dollars(v)}`, m ? `month ${m}` : "at opening"] : [`Lowest ${dollars(v)}${m ? `, month ${m}` : ", at opening"}`];
          const spot = lowSpot(x(m), y(v), Math.max(...rows.map((r) => r.length)) * 7, rows.length * 14, series.map((q) => q.pts.map((p, k) => [x(k), y(p)] as const)), y(0), { L, R: W - R, T, B: H - B });
          return <g key={`low${s.k}`} className="low"><circle cx={x(m)} cy={y(v)} r={4} />{spot.lead && <line x1={x(m)} y1={y(v) - 5} x2={x(m)} y2={spot.y + rows.length * 14 - 10} />}<text className="tick" x={spot.x} y={spot.y} textAnchor={spot.anchor}>{rows.map((r, k) => <tspan key={k} x={spot.x} dy={k ? 14 : 0}>{r}</tspan>)}</text></g>;
        })}
        {series.map((s) => <text key={`l${s.k}`} className="end" x={x(MONTHS) + 6} y={y(s.pts[MONTHS]) + 4}>{SCENARIO_WORD[s.k]}</text>)}
        {at != null && (
          <g className="cross">
            <line x1={x(at)} x2={x(at)} y1={T} y2={H - B} />
            {series.map((s) => <circle key={s.k} className={SC_CLASS[s.k]} cx={x(at)} cy={y(s.pts[at])} r={4.5} />)}
          </g>
        )}
      </svg>
      <p className="vz-fig-read" aria-live="off">{at == null ? "Point at or tap a month to read it." : `${at === 0 ? "Opening day" : `Month ${at}`}: ${series.map((s) => `${SCENARIO_WORD[s.k]} ${dollars(s.pts[at])}`).join(" · ")}`}</p>
    </figure>
  );
}

/** IP1.3 — where the low point's label goes: the first spot whose box no line and no zero line crosses — under the point,
 *  beside it, then higher with a leader — turned toward the middle; the halo (vision.css) only as the last resort. */
export function lowSpot(px: number, py: number, w: number, h: number, lines: (readonly (readonly [number, number])[])[], zeroY: number, box: { L: number; R: number; T: number; B: number }) {
  const right = px > (box.L + box.R) / 2;
  const at = (dy: number) => { const x0 = right ? px - 8 - w : px + 8; return { x: right ? px - 8 : px + 8, y: py + dy, x0, x1: x0 + w, top: py + dy - 11, bot: py + dy - 11 + h }; };
  const hits = (c: ReturnType<typeof at>) => c.top < box.T || c.bot > box.B || c.x0 < box.L - 4 || c.x1 > box.R + 80
    || (zeroY > c.top - 2 && zeroY < c.bot + 2)
    || lines.some((pts) => pts.some(([qx, qy], k) => { if (k === 0) return false; const [ax, ay] = pts[k - 1];
      if (qx < c.x0 || ax > c.x1) return false;
      for (let t = 0; t <= 1; t += 0.125) { const sx = ax + (qx - ax) * t, sy = ay + (qy - ay) * t; if (sx >= c.x0 && sx <= c.x1 && sy >= c.top - 3 && sy <= c.bot + 3) return true; } return false; }));
  for (const dy of [20, -10 - (h - 14), -30, -50, -70, -90, -110, -130, -150]) { const c = at(dy); if (!hits(c)) return { x: c.x, y: c.y, anchor: right ? "end" as const : "start" as const, lead: dy < -10 - (h - 14) }; }
  const c = at(-10 - (h - 14));
  return { x: c.x, y: c.y, anchor: right ? "end" as const : "start" as const, lead: false };
}

export function Tornado({ swings, pct }: { swings: Swing[]; pct: number }) {
  if (!swings.length) return null;
  const W = 640, row = 30, L = 132, R = 16, H = swings.length * row + 28;
  const max = Math.max(...swings.flatMap((s) => [Math.abs(s.up), Math.abs(s.down)])) || 1;
  const mid = L + (W - L - R) / 2, half = (W - L - R) / 2 - 4;
  const bar = (v: number) => (Math.abs(v) / max) * half;
  return (
    <figure className="vz-fig">
      <figcaption className="vz-fig-h"><b>What moves it most</b><span>each input ±{pct}%, the change in 36 months&apos; result</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="vz-chart" role="img" aria-label={swings.map((s) => `${s.driver}: ${dollars(s.down)} to ${dollars(s.up)}`).join("; ")}>
        <line className="zero" x1={mid} x2={mid} y1={4} y2={H - 22} />
        {swings.map((s, k) => {
          const yy = 8 + k * row;
          const parts = [s.down, s.up].map((v, j) => {
            const w = bar(v), left = v < 0 ? mid - w : mid;
            return <rect key={j} className={v < 0 ? "hurt" : "help"} x={left} y={yy} width={Math.max(1, w)} height={row - 10} rx={3}><title>{`${s.driver} ${j ? "+" : "−"}${pct}%: ${dollars(v)}`}</title></rect>;
          });
          return <g key={s.driver}><text className="tick" x={L - 10} y={yy + (row - 10) / 2 + 4} textAnchor="end">{s.driver}</text>{parts}</g>;
        })}
        <text className="tick" x={mid - 8} y={H - 6} textAnchor="end">worse</text>
        <text className="tick" x={mid + 8} y={H - 6}>better</text>
      </svg>
    </figure>
  );
}

/** Round steps for an axis: 1, 2 or 5 × a power of ten, covering lo..hi in about `n` steps, zero among them. */
export function niceTicks(lo: number, hi: number, n: number): number[] {
  const span = hi - lo || 1, raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((f) => f * p).find((s) => s >= raw) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v));
  return out;
}
