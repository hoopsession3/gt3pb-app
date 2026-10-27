"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { HORIZONS, HORIZON_WORD, PILLARS, PILLAR_WORD, ASK_WORD, askTotals, board, kindOf, shortMoney, whenWords, type Layout, type Pillar } from "@/lib/vision";
import type { Vision } from "@/lib/visionRead";
import { MODE_SAYS, MODE_WORD, PRESENT_MODES, caseParts, type CasePart, type PresentMode } from "@/lib/visionPresent";
import Store3D from "./Store3D";
import { CapitalBar } from "./Roadmap";
import { DEAL_WORD, FORMAT, phases } from "@/lib/visionPlans";
import FlowBar, { figuresOf } from "./FlowBar";
import { useFlow, type Speed } from "./useFlow";
import dynamic from "next/dynamic";

// A plan's case (R57) draws the money's engine and its chart — loaded only when a case slide is reached.
const CaseSlide = dynamic(() => import("./CaseSlide"), { ssr: false, loading: () => <p className="vp-lede">Loading the numbers…</p> });

// THE PRESENTER (R52) — "pull the app up and show someone". The plan as a story, full screen, in its own dark room:
// the four pillars, the board, each program and why, the store in 3D with the reason for each thing in it, and where
// capital may be needed. Tap the right side (or →) for the next, the left (or ←) for the one before; swipe works too.
// The same screen opens from a private link (app/present) for someone who isn't in the room.
type Slide =
  | { kind: "cover" } | { kind: "board" } | { kind: "program"; id: string } | { kind: "ways"; id: string } | { kind: "case"; id: string; part?: CasePart } | { kind: "store"; id: string } | { kind: "capital" } | { kind: "end" };
const PILLAR_LINE: Record<Pillar, string> = {
  stillness: "Room to slow down.", light: "Daylight, and nothing to hide.", fuel: "Clean fuel — cold extracted, every ingredient named.", movement: "A reason to move, every day.",
};

/** Pitch: each case told in parts, one message a slide (the ask and return, cash and the scenarios, the risks, the evidence). */
function toldInParts(slides: Slide[], cases: Vision["cases"]): Slide[] {
  return slides.flatMap((x) => (x.kind === "case" && cases?.[x.id] ? caseParts(cases[x.id]).map((part) => ({ kind: "case" as const, id: x.id, part })) : [x]));
}

export default function Present({ vision, onExit, forWhom, exitLabel = "Done" }: { vision: Vision; onExit?: () => void; forWhom?: string | null; exitLabel?: string }) {
  const cols = useMemo(() => board(vision.programs), [vision.programs]);
  const asksOf = useCallback((id: string) => vision.asks.filter((a) => a.program_id === id), [vision.asks]);
  const base = useMemo<Slide[]>(() => {
    const out: Slide[] = [{ kind: "cover" }, { kind: "board" }];
    const shownRooms = new Set<string>();
    for (const h of HORIZONS) for (const p of cols[h]) {
      if (h === "now" && !p.why) continue;
      out.push({ kind: "program", id: p.id });
      if (vision.plans.some((x) => x.program_id === p.id)) out.push({ kind: "ways", id: p.id });
      // Each plan with an approved case (its baseline — on a link, only where an owner chose to show it), in phase order.
      for (const pl of vision.plans.filter((x) => x.program_id === p.id).sort((a, b) => a.phase - b.phase || a.sort - b.sort)) if (vision.cases?.[pl.id]) out.push({ kind: "case", id: pl.id });
      const room = vision.layouts.find((l) => l.id === p.layout_id);
      if (room && room.items.length && !shownRooms.has(room.id)) { out.push({ kind: "store", id: room.id }); shownRooms.add(room.id); }
    }
    for (const l of vision.layouts) if (!shownRooms.has(l.id) && l.items.length) out.push({ kind: "store", id: l.id });
    if (vision.showAsks && vision.asks.length) out.push({ kind: "capital" });
    out.push({ kind: "end" });
    return out;
  }, [cols, vision]);
  // IP1: three ways to show it. Pitch tells each case in parts, one message a slide; Explore and Diligence keep the case
  // whole on one slide (its levers, its drill-down). The modes appear only when there's a case to show.
  const [mode, setMode] = useState<PresentMode>("pitch");
  const hasCase = base.some((x) => x.kind === "case");
  const slides = useMemo(() => (mode === "pitch" ? toldInParts(base, vision.cases) : base), [base, mode, vision.cases]);
  const [at, setAt] = useState(0);
  const [focus, setFocus] = useState(0);
  // No haptics on slides (IP1 — nothing decorative in front of a guest).
  const go = useCallback((d: number) => { setAt((i) => Math.max(0, Math.min(slides.length - 1, i + d))); setFocus(0); }, [slides.length]);
  // Changing the way keeps the place: the same slide (or the same case) in the other list.
  const switchTo = (m: PresentMode) => {
    if (m === mode) return;
    const cur = slides[at];
    const next = m === "pitch" ? toldInParts(base, vision.cases) : base;
    const same = (x: Slide) => x.kind === cur.kind && ("id" in x ? x.id : null) === ("id" in cur ? cur.id : null);
    const idx = next.findIndex(same);
    setMode(m); setAt(idx < 0 ? Math.min(at, next.length - 1) : idx); setFocus(0);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, select, textarea")) return; // a lever in Explore keeps its arrows
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
      else if (e.key === "Escape" && onExit) onExit();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [go, onExit]);

  const swipe = useRef<{ x: number; y: number } | null>(null);
  const s = slides[at];
  const total = askTotals(vision.asks);

  // Full screen means the window's: drawn at the top of the document, so no frame, stage or transformed parent around the
  // page (the desk's canvas, the phone frame on a desktop) can hold it in (R53 — on a desktop it was clipped to the frame).
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <div className="vp" role="dialog" aria-modal="true" aria-label="The plan, presented">
      <div className="vp-bar">
        {onExit ? <button type="button" className="btn-sec btn-sm" onClick={onExit}>{exitLabel}</button> : <span />}
        <div className="vp-prog" aria-hidden="true">{slides.map((_, i) => <i key={i} className={i <= at ? "on" : undefined} />)}</div>
        <span className="flex gap-2">
          <button type="button" className="btn-sec btn-sm" onClick={() => go(-1)} disabled={at === 0} aria-label="The one before">‹</button>
          <button type="button" className="btn-sec btn-sm" onClick={() => go(1)} disabled={at === slides.length - 1} aria-label="Next">›</button>
        </span>
      </div>
      {hasCase && (
        <div className="vp-modes" role="radiogroup" aria-label="How to show it">
          {PRESENT_MODES.map((m) => <button key={m} type="button" role="radio" aria-checked={mode === m} title={MODE_SAYS[m]} className={mode === m ? "on" : undefined} onClick={() => switchTo(m)}>{MODE_WORD[m]}</button>)}
        </div>
      )}
      <div className="vp-stage"
        onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={(e) => {
          const st = swipe.current; swipe.current = null;
          if (!st || (e.target as HTMLElement).closest("canvas, button, a, input, label, summary, details, .vp-drill, .vp-explore, .vz-chart, .vz-cmp-wrap, .vp-month, .vp-scn")) return;
          const dx = e.clientX - st.x;
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
          else if (Math.abs(dx) < 8 && Math.abs(e.clientY - st.y) < 8) go(e.clientX > window.innerWidth / 3 ? 1 : -1);
        }}>
        <div className="vp-slide" key={`${mode}:${at}`}>
          {s.kind === "cover" && (
            <>
              <p className="vp-eyebrow">GT3 Performance Bar{forWhom ? ` · for ${forWhom}` : ""}</p>
              <h1 className="vp-title">What&apos;s next.</h1>
              <p className="vp-lede">People want clean coffee, and they want it every day. Everything we build stands on four pillars — and says plainly what goes into the cup.</p>
              <div className="vp-pillars">{PILLARS.map((p) => <span key={p} className="vp-pillar"><i className={`pz-${p}`} />{PILLAR_WORD[p]}</span>)}</div>
            </>
          )}
          {s.kind === "board" && (
            <>
              <p className="vp-eyebrow">The roadmap</p>
              <h2 className="vp-title">Now. Next. Later.</h2>
              <div className="vp-cols grid-cols-1 min-[700px]:grid-cols-3">
                {HORIZONS.map((h) => (
                  <div key={h} className="vp-col">
                    <b>{HORIZON_WORD[h]}</b>
                    {cols[h].map((p) => <div key={p.id} className="vp-chip">{p.emoji ? `${p.emoji} ` : ""}{p.title}</div>)}
                  </div>
                ))}
              </div>
            </>
          )}
          {s.kind === "program" && (() => {
            const p = vision.programs.find((x) => x.id === s.id)!;
            const asks = asksOf(p.id), t = askTotals(asks);
            const when = whenWords(p.start_on, p.target_on);
            return (
              <>
                <p className="vp-eyebrow">{HORIZON_WORD[p.horizon]} · {p.lane}{when ? ` · ${when}` : ""}</p>
                <h2 className="vp-title">{p.emoji ? `${p.emoji} ` : ""}{p.title}</h2>
                {p.summary && <p className="vp-lede">{p.summary}</p>}
                {p.why && <p className="vp-lede">{p.why}</p>}
                {p.pillars.length > 0 && <div className="vp-pillars">{p.pillars.map((x) => <span key={x} className="vp-pillar"><i className={`pz-${x}`} />{PILLAR_WORD[x]} — {PILLAR_LINE[x]}</span>)}</div>}
                {vision.showAsks && asks.length > 0 && (
                  <div>
                    <p className="vp-eyebrow">{t.total > 0 ? `Where capital helps · ${shortMoney(t.total)}` : "Partners wanted"}</p>
                    {asks.map((a, i) => (
                      <div key={i} className="vp-ask"><span>{a.label}</span><b>{a.amount_cents ? shortMoney(a.amount_cents) : "—"}</b><span>{ASK_WORD[a.state]}{a.note ? ` · ${a.note}` : ""}</span></div>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
          {s.kind === "ways" && (() => {
            const p = vision.programs.find((x) => x.id === s.id)!;
            const steps = phases(vision.plans.filter((x) => x.program_id === p.id));
            return (
              <>
                <p className="vp-eyebrow">{p.title} · the ways in</p>
                <h2 className="vp-title">Step by step.</h2>
                <p className="vp-lede">Each step earns the next: start small, and build the full room once demand is proven.</p>
                <div className="vp-steps grid-cols-1 min-[700px]:grid-cols-none min-[700px]:grid-flow-col min-[700px]:auto-cols-fr">
                  {steps.map(({ phase, plans: ps }) => (
                    <div key={phase} className="vp-col">
                      <b>Phase {phase}</b>
                      {ps.map((pl) => (
                        <div key={pl.id} className="vp-chip">
                          <div>{FORMAT[pl.format].mark} {pl.name}</div>
                          <div className="vp-chip-s">{[FORMAT[pl.format].name !== pl.name ? FORMAT[pl.format].name : null, pl.sqft ? `${pl.sqft.toLocaleString("en-US")} sq ft` : null, pl.deal !== "tbd" ? DEAL_WORD[pl.deal] : null].filter(Boolean).join(" · ") || "Size and deal to be set"}</div>
                          {pl.gate && <div className="vp-chip-s"><b>Goes when</b> {pl.gate}</div>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
          {s.kind === "case" && (() => {
            const pl = vision.plans.find((x) => x.id === s.id)!;
            return <CaseSlide key={`${s.id}:${mode}`} plan={pl} c={vision.cases![s.id]} room={vision.layouts.find((l) => l.id === pl.layout_id) ?? null} part={mode === "pitch" ? s.part : "all"} mode={mode} />;
          })()}
          {s.kind === "store" && (() => {
            const l = vision.layouts.find((x) => x.id === s.id)!;
            return <TourSlide layout={l} focus={focus} setFocus={setFocus} />;
          })()}
          {s.kind === "capital" && (
            <>
              <p className="vp-eyebrow">Where we need capital</p>
              <div className="vp-big">{total.total > 0 ? shortMoney(total.total) : "Partners wanted"}</div>
              <CapitalBar t={total} dark />
              {vision.programs.filter((p) => asksOf(p.id).length).map((p) => {
                const t = askTotals(asksOf(p.id));
                return <div key={p.id} className="vp-ask"><span>{p.emoji ? `${p.emoji} ` : ""}{p.title}</span><b>{t.total ? shortMoney(t.total) : "—"}</b><span>{t.open ? `${shortMoney(t.open)} open` : t.total ? "Fully committed" : "Being priced"}</span></div>;
              })}
            </>
          )}
          {s.kind === "end" && (
            <>
              <p className="vp-eyebrow">GT3 Performance Bar</p>
              <h2 className="vp-title">Clean fuel. Every day. Everywhere people move.</h2>
              <p className="vp-lede">Questions welcome. The plan changes as we learn.</p>
            </>
          )}
        </div>
      </div>
      {/* IP1.4: said once, on the first slide — on a phone the line took room under every slide after it. */}
      {at === 0 && <p className="vp-tap">Tap or swipe · ← → on a keyboard</p>}
    </div>,
    document.body,
  );
}
const noop = () => () => {};

// The store, on its slide: the reason for each thing in it, one at a time — and, a tap away, the room with guests moving
// through it, the way it would run on a busy morning.
function TourSlide({ layout: l, focus, setFocus }: { layout: Layout; focus: number; setFocus: (f: (n: number) => number) => void }) {
  const [flowOn, setFlowOn] = useState(false);
  const [perHour, setPerHour] = useState(60);
  const [speed, setSpeed] = useState<Speed>(30);
  const flow = useFlow(l, flowOn, perHour, speed);
  const figures = useMemo(() => figuresOf(flow), [flow]);
  const tour = l.items.filter((i) => i.why);
  const cur = flowOn ? undefined : tour[focus % Math.max(1, tour.length)];
  const sqft = Math.round((l.width_in * l.depth_in) / 144);
  return (
    <>
      <p className="vp-eyebrow">The room · {sqft.toLocaleString()} sq ft</p>
      <h2 className="vp-title">{l.name}</h2>
      <div className="vp-tour grid-cols-1 min-[860px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Store3D layout={l} selected={cur?.id ?? null} focus={cur?.id ?? null} spin={!cur} figures={figures} heat={flow?.heat} label={`${l.name}, in 3D`} />
        <div className="vp-why" key={cur?.id ?? "flow"}>
          {cur && (
            <>
              <p className="vp-eyebrow">{focus % tour.length + 1} of {tour.length}</p>
              <h3>{cur.label || kindOf(cur.kind).name}</h3>
              <p>{cur.why}</p>
              {cur.pillars.length > 0 && <div className="vp-pillars">{cur.pillars.map((x) => <span key={x} className="vp-pillar"><i className={`pz-${x}`} />{PILLAR_WORD[x]}</span>)}</div>}
              <span className="flex gap-2 mt-2">
                <button type="button" className="k-chip" onClick={() => setFocus((f) => (f - 1 + tour.length) % tour.length)}>‹ Before</button>
                <button type="button" className="k-chip" onClick={() => setFocus((f) => (f + 1) % tour.length)}>The next thing ›</button>
              </span>
            </>
          )}
          {flowOn && (
            <>
              <p className="vp-eyebrow">A busy morning · {perHour} guests an hour</p>
              <h3>The flow</h3>
              <p>In the door, a turn at the counter, a pour at the taps — then a seat, or a bottle and back out moving.</p>
            </>
          )}
          <div className="mt-2">
            <FlowBar compact on={flowOn} onToggle={() => setFlowOn((o) => !o)} perHour={perHour} onPerHour={setPerHour} speed={speed} onSpeed={setSpeed} frame={flow} />
          </div>
        </div>
      </div>
    </>
  );
}
