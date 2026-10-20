"use client";

import "@/components/nutrition/nutrition.css";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { haptic } from "@/lib/haptics";
import { lessonHref } from "@/lib/native";
import { progressOf, type LessonLite, type ModuleLite, type PillarLite } from "@/lib/nutrition";

// THE COURSE MAP (R44) — the owner's Miro boards and MindNode maps, redrawn from the course itself: GT3 Nutrition at the
// root, each pillar, its modules, its lessons. The connectors draw themselves in (the playbook's line-draw); the chosen
// point pulses; each step you move feels like a detent — a selection tick, and the boundary feel at either end — and
// the same works from the arrow keys. Every point is a real button (Tab reaches it, a screen reader says it). What it
// shows is what this reader can open: a Pro lesson they have not unlocked is not in the list RLS hands back.

type Node =
  | { id: string; kind: "root"; depth: 0; label: string }
  | { id: string; kind: "pillar"; depth: 1; label: string; pillar: PillarLite & { blurb?: string | null } ; parent: string }
  | { id: string; kind: "module"; depth: 2; label: string; module: ModuleLite & { blurb?: string | null }; parent: string }
  | { id: string; kind: "lesson"; depth: 3; label: string; lesson: LessonLite; parent: string };

const ROW = 44;      // a touch target, and the map's grid (the rows' height and indents are app/globals.css .nu-map-rows)
const INDENT = 22;

export default function CourseMap({ pillars, modules, order, done }: {
  pillars: readonly (PillarLite & { blurb?: string | null })[];
  modules: readonly (ModuleLite & { blurb?: string | null })[];
  order: readonly LessonLite[];
  done: ReadonlySet<string>;
}) {
  const nodes = useMemo<Node[]>(() => {
    const out: Node[] = [{ id: "root", kind: "root", depth: 0, label: "GT3 Nutrition" }];
    for (const p of [...pillars].sort((a, b) => a.sort - b.sort)) {
      out.push({ id: `p:${p.id}`, kind: "pillar", depth: 1, label: p.title, pillar: p, parent: "root" });
      for (const m of modules.filter((x) => x.pillar_id === p.id).sort((a, b) => a.sort - b.sort)) {
        const ls = order.filter((l) => l.module_id === m.id);
        if (!ls.length) continue;
        out.push({ id: `m:${m.id}`, kind: "module", depth: 2, label: m.title, module: m, parent: `p:${p.id}` });
        for (const l of ls) out.push({ id: `l:${l.id}`, kind: "lesson", depth: 3, label: l.title, lesson: l, parent: `m:${m.id}` });
      }
    }
    return out;
  }, [pillars, modules, order]);

  const [sel, setSel] = useState(0);
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = new Map(nodes.map((n, i) => [n.id, i]));

  const choose = (i: number, focus: boolean) => {
    if (i < 0 || i >= nodes.length) { haptic("boundary"); return; }   // the end stop: nothing further that way
    if (i !== sel) haptic("selection");                                // a detent: the choice changed
    setSel(i);
    if (focus) btns.current[i]?.focus();
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowDown") { e.preventDefault(); choose(i + 1, true); }
    else if (e.key === "ArrowUp") { e.preventDefault(); choose(i - 1, true); }
    else if (e.key === "Home") { e.preventDefault(); choose(0, true); }
    else if (e.key === "End") { e.preventDefault(); choose(nodes.length - 1, true); }
  };

  const height = nodes.length * ROW;
  const width = 22 + 3 * INDENT + 260;
  const x = (d: number) => 21 + d * INDENT;   // a point's dot: the row's indent (7 + 22 per level) + the button's 6px + half the 14px dot
  const y = (i: number) => i * ROW + ROW / 2;
  const s = nodes[sel] ?? nodes[0];

  return (
    <div className="nu-map-wrap">
      <div className="nu-map" style={{ height: height + 20 }}>
        <svg className="nu-map-lines fx-draw" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          {nodes.map((n, i) => {
            if (n.kind === "root") return null;
            const pi = idx.get(n.parent) ?? 0;
            const px = x(n.depth - 1), py = y(pi), cx = x(n.depth), cy = y(i);
            return <path key={n.id} pathLength={1} style={{ "--d": Math.min(i * 28, 900) } as React.CSSProperties}
              d={`M${px} ${py + 8} L${px} ${cy - 10} Q${px} ${cy} ${px + 10} ${cy} L${cx - 6} ${cy}`} />;
          })}
        </svg>
        <ol className="nu-map-rows" aria-label="The course, as a map">
          {nodes.map((n, i) => {
            const isDone = n.kind === "lesson" && done.has(n.lesson.id);
            const prog = n.kind === "pillar" ? progressOf(order.filter((l) => modules.some((m) => m.id === l.module_id && m.pillar_id === n.pillar.id)), done) : null;
            const empty = n.kind === "pillar" && prog?.total === 0;
            return (
              <li key={n.id} className={n.depth === 0 ? "d0" : n.depth === 1 ? "d1" : n.depth === 2 ? "d2" : "d3"}>
                <button
                  ref={(el) => { btns.current[i] = el; }}
                  type="button"
                  className={`nu-map-node ${n.kind === "root" ? "root" : n.kind === "pillar" ? "pillar" : n.kind === "module" ? "module" : "lesson"}${isDone ? " done" : ""}${i === sel ? " sel" : ""}${empty ? " lock" : ""} fx-rise`}
                  style={{ "--i": Math.min(i, 12) } as React.CSSProperties}
                  aria-current={i === sel ? "true" : undefined}
                  aria-label={`${n.label}${isDone ? ", done" : ""}${empty ? ", coming to Pro" : ""}`}
                  onClick={() => choose(i, false)}
                  onKeyDown={(e) => onKey(e, i)}
                >
                  <span className={`nu-map-dot${i === sel ? " fx-pulse" : ""}`} aria-hidden="true">
                    {isDone ? <Icon name="check" size={10} /> : n.kind === "lesson" && n.lesson.tier === "pro" ? <Icon name="lock" size={9} /> : null}
                  </span>
                  <span className="nu-map-label">{n.label}</span>
                  {prog && prog.total > 0 && <span className="nu-map-count">{prog.done}/{prog.total}</span>}
                  {empty && <span className="nu-map-count">Pro</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="nu-map-hint">Tap a point to see it, or use the arrow keys.</p>
      <div className="nu-map-detail fx-rise" key={s.id} aria-live="polite">
        {s.kind === "root" && <>
          <span className="nu-map-detail-n">Return to Primal</span>
          <span className="nu-map-detail-t">GT3 Nutrition</span>
          <span className="nu-map-detail-s">{progressOf(order, done).done} of {order.length} lessons done. Five pillars, one system.</span>
        </>}
        {s.kind === "pillar" && <>
          <span className="nu-map-detail-n">Pillar</span>
          <span className="nu-map-detail-t">{s.label}</span>
          {s.pillar.blurb && <span className="nu-map-detail-s">{s.pillar.blurb}</span>}
          <a href={`#pillar-${s.pillar.slug}`} className="btn-ter self-start">See its lessons</a>
        </>}
        {s.kind === "module" && <>
          <span className="nu-map-detail-n">Module</span>
          <span className="nu-map-detail-t">{s.label}</span>
          {s.module.blurb && <span className="nu-map-detail-s">{s.module.blurb}</span>}
        </>}
        {s.kind === "lesson" && <>
          <span className="nu-map-detail-n">{s.lesson.tier === "pro" ? "Pro lesson" : "Free lesson"}{done.has(s.lesson.id) ? " · done" : ""}</span>
          <span className="nu-map-detail-t">{s.label}</span>
          {s.lesson.summary && <span className="nu-map-detail-s">{s.lesson.summary}</span>}
          <Link href={lessonHref(s.lesson.slug)} className="btn-pri self-start" onClick={() => haptic("light")}>Open the lesson</Link>
        </>}
      </div>
    </div>
  );
}
