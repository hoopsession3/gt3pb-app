"use client";

import type { ReactNode } from "react";
import type { RowSays, RowTone } from "@/lib/liveOps";

// ONE ROW FOR A THING'S STATE (2026-10-12, the Live Ops round, approved). Live Ops' truck was a 195-point card and the
// Pass a hero button over it; each is this now: a card one row tall — about 52 points — holding a dot, one line that
// says the state in words (lib/liveOps truckSays, passSays), and at most one action. The line is the row's own button:
// it opens what the row is about (the Pass), or folds open in place what was behind it (the truck's map dot and links:
// nothing removed, only folded). Its name for VoiceOver says what it holds and what a tap does; the dot only repeats the
// words, never stands alone. Every target is 44 points: the line's button is (min-h-11 in a 52-point row), and the
// action is the kit's compact button, 36 points that reach 44 (app/globals.css .btn-sm::after).
//
// The kit's pieces: .mpanel is the card (Live Ops' folds are .mpanel too), .mpanel-chev the chevron that turns when the
// card is open, .adm-dot the dot (green and breathing when live, as the truck's light always was); the rest is layout.

const DOT: Record<RowTone, string> = {
  idle: "adm-dot mr-0",
  on: "adm-dot on mr-0",
  busy: "adm-dot mr-0 bg-gold2",
  warn: "adm-dot mr-0 bg-warn",
  fail: "adm-dot mr-0 bg-red",
};

export function StatusRow({ label, says, tapLabel, onTap, expanded, controls, action, children }: {
  /** The row's name as a region: "The Pass", "The truck". */
  label: string;
  says: RowSays;
  /** What the line's button says to VoiceOver: the state, then what a tap does. */
  tapLabel: string;
  onTap: () => void;
  /** A row that folds open in place says whether it is open; a row that goes somewhere leaves this out. */
  expanded?: boolean;
  /** The id of what the fold opens. */
  controls?: string;
  /** The one action: a kit compact button, or nothing. */
  action?: ReactNode;
  /** What the fold holds, drawn while it is open. */
  children?: ReactNode;
}) {
  return (
    <section aria-label={label} className={`mpanel${expanded ? " open" : ""}`}>
      <div className="flex items-center gap-2 pr-3 min-h-13">
        <button type="button" onClick={onTap} aria-label={tapLabel} aria-expanded={expanded} aria-controls={expanded ? controls : undefined}
          className="flex flex-1 min-w-0 items-center gap-2.5 self-stretch min-h-11 pl-4 pr-1 py-1.5 text-left text-cream bg-transparent border-0 appearance-none cursor-pointer [font:inherit]">
          <span aria-hidden="true" className={DOT[says.tone]} />
          <span className="flex-1 min-w-0 text-subhead leading-snug line-clamp-2">{says.text}</span>
          <span aria-hidden="true" className="mpanel-chev">›</span>
        </button>
        {action}
      </div>
      {expanded && children}
    </section>
  );
}
