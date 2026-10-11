"use client";

import Icon from "@/components/Icon";

// THE WAY BACK, NAMED FOR WHERE IT GOES (2026-10-11). A file of its own, as the kit's other controls are kept apart
// (components/controls): only the crew console's row draws it, and every page that imports the segmented control —
// /architecture's system map among them, at its weight ceiling — would otherwise carry it.
/** The way back, named for where it goes — "‹ Readiness", as an iPhone's back button says the screen it returns to
 *  (2026-10-11, Ryan: "am I managing one event or am I in a menu?"). It leads a header's row; the title bar draws
 *  the same when the screen has scrolled (components/TitleBar). A long name is cut short, never the chevron. */
export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label === "Back" ? "Back" : `Back to ${label}`}
      className="flex h-11 min-w-11 max-w-[55vw] -ml-1.5 cursor-pointer appearance-none items-center gap-0.5 border-0 bg-transparent pr-2 font-sans text-body text-gold2 transition-opacity active:opacity-55">
      <Icon name="chevronLeft" size={24} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
