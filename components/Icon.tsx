"use client";

// ICON — semantic line-icon system (Wave 2, 2026-07-15). Replaces emoji-as-icon (an audit found
// 744 emoji/dingbat occurrences standing in for icons — "the single most un-luxury tell," renders
// as the phone's cartoon clip-art, differently on every device). NOT the GT3 brand marks — those
// stay locked raster assets (Gt3Mark.tsx etc.), never touched here.
//
// Visual language matches the 25 icons OperatorNav.tsx already shipped (the one place this pattern
// existed before today): 24x24 viewBox, stroke=currentColor, strokeWidth=2, fill=none by default —
// so an <Icon> sits next to an OperatorNav tab icon with zero visual seam. A handful of paths below
// are literally reused from OperatorNav/BottomNav (noted per-icon) rather than redrawn, so the two
// sets stay one family instead of drifting into two "close but not quite" icon styles.
//
// Usage: <Icon name="truck" /> · <Icon name="check" size={14} /> · <Icon name="dot" tone="live" />
// Sizing: font-size-relative by default (1em square) so it inherits the surrounding text size like
// the emoji it replaces did — pass `size` (px) only when an icon needs to be sized independent of
// its text context.

import type { CSSProperties } from "react";

export type IconName =
  // top-20 emoji replacements (by frequency, per the Wave 2 icon audit)
  | "sparkles" | "truck" | "warning" | "pin" | "package" | "chat" | "calendar" | "wrench"
  | "compass" | "lock" | "target" | "bell" | "clock" | "team" | "partners" | "event" | "link"
  | "coffee" | "jar"
  // dingbat replacements (✓ → ✕ ↗ ★ ▸ ○●) — highest-frequency typographic icon-substitutes
  | "check" | "arrowRight" | "close" | "chevronRight" | "externalLink" | "star" | "dot" | "dotOutline"
  // small utility set, cheap to include, comes up constantly in retrofit work
  | "plus" | "info" | "search" | "more";

const PATHS: Record<IconName, React.ReactNode> = {
  // = OperatorNav ICONS.studio / STREAM_ICONS.brand (reused verbatim — same "AI/brand moment" glyph)
  sparkles: <path d="M12 3l2.1 4.9 5.3.4-4 3.5 1.2 5.2L12 14.7 7.4 17.4l1.2-5.2-4-3.5 5.3-.4z" />,
  // = BottomNav "find" tab icon (already the shipped truck glyph)
  truck: <><path d="M3 7h11v8H3z" /><path d="M14 10h4l3 3v2h-7z" /><circle cx="7" cy="17" r="1.6" /><circle cx="18" cy="17" r="1.6" /></>,
  warning: <><path d="M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.3 2.25h17.76a1.5 1.5 0 0 0 1.3-2.25L13.71 3.86a1.5 1.5 0 0 0-2.6 0z" /><path d="M12 9.5v4" /><circle cx="12" cy="17" r=".75" fill="currentColor" stroke="none" /></>,
  // = OperatorNav ICONS.stops (reused verbatim)
  pin: <><path d="M12 21s-6.5-5.4-6.5-10a6.5 6.5 0 0 1 13 0c0 4.6-6.5 10-6.5 10z" /><circle cx="12" cy="10.6" r="2.3" /></>,
  package: <><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  // = OperatorNav ICONS.ask, minus the "?" mark (a generic speech-bubble silhouette)
  chat: <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.6-.8L3 21l1.8-5.9A8.5 8.5 0 1 1 21 11.5z" />,
  // = OperatorNav ICONS.plan
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  wrench: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2-2z" />,
  // = OperatorNav ICONS.driver (radial "wheel" reads as compass/navigate too)
  compass: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.4" /><path d="M12 3v6.6M4.2 16.5l6-3M19.8 16.5l-6-3" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  // = OperatorNav ICONS.goals
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" /></>,
  bell: <><path d="M6 10a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  // = OperatorNav ICONS.team
  team: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5" /><path d="M16 5.2a3 3 0 0 1 0 5.6M21 20c0-2.4-1.8-4-4-4.6" /></>,
  // overlapping circles — a simplified "collaboration" glyph; a literal handshake didn't read cleanly at icon size
  partners: <><circle cx="9" cy="12" r="6" /><circle cx="15" cy="12" r="6" /></>,
  // = OperatorNav STREAM_ICONS.events
  event: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M12 13.2l1.2 2.4 2.6.3-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.3z" /></>,
  link: <><path d="M9 15l6-6" /><path d="M11 6l1-1a4 4 0 0 1 6 6l-1 1" /><path d="M13 18l-1 1a4 4 0 0 1-6-6l1-1" /></>,
  // = OperatorNav ICONS.brew / STREAM_ICONS.production (a coffee-drop silhouette)
  coffee: <><path d="M12 3c3 3.8 5.5 6.7 5.5 10a5.5 5.5 0 0 1-11 0C6.5 9.7 9 6.8 12 3z" /><path d="M9.5 13.5a2.5 2.5 0 0 0 2.5 2.5" /></>,
  jar: <><path d="M8 3h8v3.5c1.5.8 2.5 2.3 2.5 4.5v8a2 2 0 0 1-2 2H9.5a2 2 0 0 1-2-2v-8c0-2.2 1-3.7 2.5-4.5z" /><path d="M8 3h8" /></>,

  check: <path d="M4 12.5l5 5L20 6.5" />,
  arrowRight: <path d="M4 12h16M14 6l6 6-6 6" />,
  close: <path d="M5 5l14 14M19 5L5 19" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  externalLink: <><path d="M14 4h6v6" /><path d="M20 4L10 14" /><path d="M18 14v6H4V6h6" /></>,
  star: <path d="M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.2-5.4 3.2 1.3-6-4.6-4.1 6.1-.6z" />,
  dot: <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />,
  dotOutline: <circle cx="12" cy="12" r="6" />,

  plus: <path d="M12 5v14M5 12h14" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="8" r=".75" fill="currentColor" stroke="none" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  // = OperatorNav STREAM_ICONS.more
  more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
};

export function Icon({
  name, size, className = "", style, title,
}: {
  name: IconName;
  /** px, sizes the icon independent of surrounding text. Omit to size as 1em (inherits text size). */
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** accessible name — omit for a purely decorative icon sitting next to its own visible text label */
  title?: string;
}) {
  const dims = size ? { width: size, height: size } : undefined;
  return (
    <span className={`k-ic ${className}`.trim()} style={style} aria-hidden={title ? undefined : true} role={title ? "img" : undefined} aria-label={title}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...dims}>
        {PATHS[name]}
      </svg>
    </span>
  );
}

export default Icon;
