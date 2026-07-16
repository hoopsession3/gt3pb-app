"use client";

import type { ReactNode } from "react";
import Gt3Mark from "@/components/Gt3Mark";

// ============================================================
// KIT — Customer Design System v1 (2026-07-14). The app-wide
// standard: every screen is built from these primitives.
//   Masthead      one identity zone; eyebrow = CONTEXT LABEL
//                 only — never a slogan, never a date
//   SectionHeader mono label + italic annotation + hairline
//   InfoRow       lead · body · trailing — a stop and an event
//                 are the same row; only the trailing changes
//   ClosingBeat   every page ends on purpose (mark + sig)
// Buttons are CSS-only tiers: btn-pri (max ONE per screen),
// btn-sec, btn-ter. EmptyState stays its own component.
// ============================================================

export function Masthead({ eyebrow, live = false, right, tone = "dark" }: { eyebrow?: string; live?: boolean; right?: ReactNode; tone?: "dark" | "light" }) {
  return (
    <>
      <header className={`k-mast${tone === "light" ? " k-mast-light" : ""}`}>
        <div className="k-lock">
          <Gt3Mark tone="cream" />
          <span className="k-pb">Performance Bar</span>
        </div>
        {right}
      </header>
      {eyebrow && (
        <div className={`k-eyb k-page-eyb${live ? " live" : ""}`}>
          {live && <span className="livedot" />}
          {eyebrow}
        </div>
      )}
    </>
  );
}

export function SectionHeader({ label, annotation, right }: { label: string; annotation?: string; right?: ReactNode }) {
  return (
    <div className="k-sec">
      <span className="k-sec-lbl">
        <span className="l">{label}</span>
        {annotation && <span className="a">{annotation}</span>}
      </span>
      {right && <span className="k-sec-r">{right}</span>}
    </div>
  );
}

// One row for anything scheduled or listed. `lead` is the mono context column
// (day over date, or a label); `sub` is the Fraunces-italic second line.
export function InfoRow({ lead, leadSub, name, nameExtra, sub, meta, trailing, live = false, onClick, bodyClick, ariaLabel, expanded }: {
  lead?: string; leadSub?: string;
  name: ReactNode; nameExtra?: ReactNode; sub?: ReactNode; meta?: ReactNode;
  trailing?: ReactNode; live?: boolean;
  /** whole row is one button (use when the trailing slot is NOT interactive) */
  onClick?: () => void;
  /** only the body zone is tappable (use when the trailing slot holds its own button) */
  bodyClick?: () => void;
  ariaLabel?: string; expanded?: boolean;
}) {
  const cls = `k-row${live ? " now" : ""}${onClick ? " tap" : ""}`;
  const bodyProps = bodyClick
    ? {
        role: "button" as const, tabIndex: 0, "aria-expanded": expanded, "aria-label": ariaLabel,
        onClick: bodyClick,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); bodyClick(); } },
        style: { cursor: "pointer" as const },
      }
    : {};
  const body = (
    <>
      {(lead || leadSub) && (
        <div className="k-lead">{lead}{leadSub && <b>{leadSub}</b>}</div>
      )}
      <div className="k-bd" {...bodyProps}>
        <div className="k-nm">{name}{live && <span className="k-tag-live">Live</span>}{nameExtra}</div>
        {sub && <div className="k-rsub">{sub}</div>}
        {meta && <div className="k-meta">{meta}</div>}
      </div>
      {trailing && <div className="k-tr">{trailing}</div>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} aria-label={ariaLabel} aria-expanded={expanded}>
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}

export function ClosingBeat() {
  return (
    <div className="k-beat">
      <div className="rule" />
      <Gt3Mark tone="cream" />
      <div className="sig">Carolinas, Georgia</div>
    </div>
  );
}
