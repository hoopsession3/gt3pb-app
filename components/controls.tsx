"use client";

// THE KIT'S CONTROLS (2026-10-07, the pill round) — the segmented control and the icon button. The
// kit's other primitives are components/kit.tsx; these are a file of their own because the public
// pages import the kit for its masthead and its closing beat, and a page that shows no control should
// carry none of their code (they cost eight routes a kilobyte when they lived there).

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Icon, { type IconName } from "@/components/Icon";

// What a pill looks like is app/globals.css's ("PILLS, ONE KIT"); what it does is here.

export type SegOption<K extends string> = { key: K; label: ReactNode; title?: string };

/** The id a Segmented of tabs gives each tab when it names its panel; the panel is named by the chosen one. */
export const segTabId = (panelId: string, key: string) => `${panelId}-tab-${key}`;
/** Spread on the view a Segmented of tabs switches (R12 — the 10/10 audit, F7): its tab panel, named by the chosen tab,
 *  so a screen reader's "tab, 2 of 4" has the view it opens, and goes from the tab to it. */
export const tabPanel = (panelId: string, key: string) => ({ role: "tabpanel" as const, id: panelId, "aria-labelledby": segTabId(panelId, key) });

/** One track, the chosen option on a thumb that slides to it. `kind="tabs"` (the default) when the
 *  options are views of one place — My Day · Live Ops · Command — and a tab list to a screen reader;
 *  `kind="choice"` when picking one changes a setting or a mode, and a radio group. `fill` shares the
 *  row equally (and scrolls when the words will not fit); otherwise the track is as wide as its words.
 *  The thumb is measured from the chosen option itself, so options of different widths, a row that
 *  scrolls and the text-size setting all keep it under the right word. Until it has measured, the
 *  chosen option fills itself, so the first paint is already right. A `value` that is none of the
 *  options chooses none: no thumb, nothing filled. `size="lg"` stands 44 points to the eye, not only
 *  to the thumb — a choice a form is made of (2026-10-12: the Monday audit's 0 · 1 · 2). */
export function Segmented<K extends string>({ options, value, onChange, onReselect, label, kind = "tabs", size, fill, className, disabled, panelId }: {
  options: SegOption<K>[];
  value: K;
  onChange: (key: K) => void;
  /** A tap on the option already chosen — a tab bar's tap on its own tab: back to that view's start. */
  onReselect?: (key: K) => void;
  label: string;
  kind?: "tabs" | "choice";
  size?: "sm" | "lg";
  fill?: boolean;
  className?: string;
  /** Held still — the choice shows, and no option takes a tap (the checkout's tip while a payment is unconfirmed). */
  disabled?: boolean;
  /** The id of the view the tabs switch (role="tabpanel" there), so a screen reader goes from a tab to what it shows. */
  panelId?: string;
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
  // ONE STOP IN THE TAB ORDER, ARROWS INSIDE (R12 — the 10/10 audit, F7): a tab list and a radio group are one Tab stop —
  // the chosen option — and ← → (↑ ↓) Home End move along it and choose, as every tab bar and segmented control does.
  // Every option was its own Tab stop, and no arrow did anything.
  const chosenAt = options.findIndex((o) => o.key === value);
  const stop = chosenAt >= 0 ? chosenAt : 0;
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !options.length) return;
    const from = Math.max(0, options.findIndex((o) => o.key === value));
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (from + 1) % options.length
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (from - 1 + options.length) % options.length
      : e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(options[to].key);
    track.current?.querySelectorAll<HTMLElement>(".k-seg-opt")[to]?.focus();
  };
  // The row scrolls in .k-seg-scroll, whose padding holds each option's 44px reach — an element that
  // scrolls clips what reaches past it, so the track cannot be the one that scrolls; .k-seg-wrap holds
  // the control's place on the page (a margin given here lands on it, not on the scroll's own).
  return (
    <div className={["k-seg-wrap", fill ? "fill" : "", className].filter(Boolean).join(" ")}>
      <div className="k-seg-scroll">
        <div ref={track} className={["k-seg", size, fill ? "fill" : ""].filter(Boolean).join(" ")}
          role={tabs ? "tablist" : "radiogroup"} aria-label={label} data-thumb={thumb ? "" : undefined} style={style} onKeyDown={onKeyDown}>
          <span className="k-seg-thumb" aria-hidden="true" />
          {options.map((o, i) => {
            const on = o.key === value;
            return (
              <button key={o.key} type="button" role={tabs ? "tab" : "radio"} aria-selected={tabs ? on : undefined} aria-checked={tabs ? undefined : on}
                tabIndex={i === stop ? 0 : -1} id={tabs && panelId ? segTabId(panelId, o.key) : undefined} aria-controls={tabs && panelId ? panelId : undefined}
                className={`k-seg-opt${on ? " on" : ""} disabled:cursor-default disabled:opacity-55`} title={o.title} disabled={disabled} onClick={() => { if (!on) onChange(o.key); else onReselect?.(o.key); }}>
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
