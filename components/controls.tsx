"use client";

// THE KIT'S CONTROLS (2026-10-07, the pill round) — the segmented control and the icon button. The
// kit's other primitives are components/kit.tsx; these are a file of their own because the public
// pages import the kit for its masthead and its closing beat, and a page that shows no control should
// carry none of their code (they cost eight routes a kilobyte when they lived there).

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Icon, { type IconName } from "@/components/Icon";

// What a pill looks like is app/globals.css's ("PILLS, ONE KIT"); what it does is here.

export type SegOption<K extends string> = { key: K; label: ReactNode; title?: string };

/** One track, the chosen option on a thumb that slides to it. `kind="tabs"` (the default) when the
 *  options are views of one place — My Day · Live Ops · Command — and a tab list to a screen reader;
 *  `kind="choice"` when picking one changes a setting or a mode, and a radio group. `fill` shares the
 *  row equally (and scrolls when the words will not fit); otherwise the track is as wide as its words.
 *  The thumb is measured from the chosen option itself, so options of different widths, a row that
 *  scrolls and the text-size setting all keep it under the right word. Until it has measured, the
 *  chosen option fills itself, so the first paint is already right. */
export function Segmented<K extends string>({ options, value, onChange, label, kind = "tabs", size, fill, className }: {
  options: SegOption<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  kind?: "tabs" | "choice";
  size?: "sm";
  fill?: boolean;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const place = () => {
      const on = el.querySelector<HTMLElement>(".k-seg-opt.on");
      if (!on) { setThumb(null); return; }
      setThumb((t) => (t && t.x === on.offsetLeft && t.w === on.offsetWidth ? t : { x: on.offsetLeft, w: on.offsetWidth }));
      // Keep the chosen option in sight when the row scrolls — by the row's own scroll, never the
      // page's (scrollIntoView would also move the page under a person who swiped a section over).
      const sc = el.parentElement;
      if (sc) {
        const left = on.offsetLeft - 3, right = on.offsetLeft + on.offsetWidth + 3;
        if (left < sc.scrollLeft) sc.scrollLeft = left;
        else if (right > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = right - sc.clientWidth;
      }
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, options.length]);
  const tabs = kind === "tabs";
  const style = thumb ? ({ "--x": `${thumb.x}px`, "--w": `${thumb.w}px` } as CSSProperties) : undefined;
  // The row scrolls in .k-seg-scroll, whose padding holds each option's 44px reach — an element that
  // scrolls clips what reaches past it, so the track cannot be the one that scrolls; .k-seg-wrap holds
  // the control's place on the page (a margin given here lands on it, not on the scroll's own).
  return (
    <div className={["k-seg-wrap", fill ? "fill" : "", className].filter(Boolean).join(" ")}>
      <div className="k-seg-scroll">
        <div ref={track} className={["k-seg", size, fill ? "fill" : ""].filter(Boolean).join(" ")}
          role={tabs ? "tablist" : "radiogroup"} aria-label={label} data-thumb={thumb ? "" : undefined} style={style}>
          <span className="k-seg-thumb" aria-hidden="true" />
          {options.map((o) => {
            const on = o.key === value;
            return (
              <button key={o.key} type="button" role={tabs ? "tab" : "radio"} aria-selected={tabs ? on : undefined} aria-checked={tabs ? undefined : on}
                className={`k-seg-opt${on ? " on" : ""}`} title={o.title} onClick={() => { if (!on) onChange(o.key); }}>
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A round control with no words on it: its name is `label` (the screen reader's, and a pointer's
 *  tooltip); a count rides on it as a badge — `crit` when the count is something gone wrong. */
export function IconButton({ icon, label, onClick, badge, crit, size, className, hint, ...aria }: {
  icon: IconName;
  label: string;
  onClick: () => void;
  badge?: number | null;
  crit?: boolean;
  size?: "sm";
  className?: string;
  /** what a pointer's tooltip adds to the name — a keyboard shortcut, say */
  hint?: string;
  "aria-haspopup"?: "dialog" | "menu" | true;
  "aria-expanded"?: boolean;
}) {
  return (
    <button type="button" className={["k-icon-btn", size, className].filter(Boolean).join(" ")} onClick={onClick}
      aria-label={label} title={hint ? `${label} (${hint})` : label} {...aria}>
      <Icon name={icon} />
      {badge != null && badge > 0 && <span className={`k-badge${crit ? " crit" : ""}`} aria-hidden="true">{badge > 99 ? "99+" : badge}</span>}
    </button>
  );
}
