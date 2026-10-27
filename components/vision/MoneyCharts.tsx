"use client";

import { useState } from "react";
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

export function CashChart({ models, focus }: { models: Partial<Record<Scenario, Model>>; focus: Scenario }) {
  const W = 640, H = 260, L = 80, R = 92, T = 16, B = 34;
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
    setAt(Math.max(0, Math.min(MONTHS, Math.round(((px - L) / (W - L - R)) * MONTHS))));
  };
  return (
    <figure className="vz-fig">
      <figcaption className="vz-fig-h"><b>Cash on hand</b><span>the funding raised, less startup spending, plus each month&apos;s net cash — month by month from opening</span></figcaption>
      <div className="vz-legend" role="list">{series.map((s) => <span key={s.k} role="listitem"><i className={SC_CLASS[s.k]} />{SCENARIO_WORD[s.k]}</span>)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="vz-chart" role="img" aria-label={`Cash on hand over ${MONTHS} months: ${series.map((s) => `${SCENARIO_WORD[s.k]} ends at ${dollars(s.pts[MONTHS])}, lowest ${dollars(Math.min(...s.pts))}`).join("; ")}`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)} onPointerLeave={() => setAt(null)}>
        {ticks.map((t) => <g key={t}><line className={t === 0 ? "zero" : "gl"} x1={L} x2={W - R} y1={y(t)} y2={y(t)} /><text className="tick" x={L - 8} y={y(t) + 4} textAnchor="end">{dollars(t)}</text></g>)}
        {[0, 12, 24, 36].map((m) => <text key={m} className="tick" x={x(m)} y={H - 10} textAnchor="middle">{m === 0 ? "Open" : `Mo ${m}`}</text>)}
        {series.map((s) => (
          <polyline key={s.k} className={SC_LINE[s.k][s.k === focus ? 1 : 0]} fill="none"
            points={s.pts.map((v, m) => `${x(m).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} />
        ))}
        {series.map((s) => <text key={`l${s.k}`} className="end" x={x(MONTHS) + 6} y={y(s.pts[MONTHS]) + 4}>{SCENARIO_WORD[s.k]}</text>)}
        {at != null && (
          <g className="cross">
            <line x1={x(at)} x2={x(at)} y1={T} y2={H - B} />
            {series.map((s) => <circle key={s.k} className={SC_CLASS[s.k]} cx={x(at)} cy={y(s.pts[at])} r={4.5} />)}
          </g>
        )}
      </svg>
      <p className="vz-fig-read" aria-live="off">{at == null ? "Point at a month to read it." : `${at === 0 ? "Opening day" : `Month ${at}`}: ${series.map((s) => `${SCENARIO_WORD[s.k]} ${dollars(s.pts[at])}`).join(" · ")}`}</p>
    </figure>
  );
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
