"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import Icon from "./Icon";
import { useBack } from "./useBack";
import { useOperatorSection } from "./OperatorSection";
import { appHistory } from "@/lib/appHistory";
import { scrollToTop } from "@/lib/appScroll";
import { SECTION_TITLE, isTabRoot, titleOf, upOf } from "@/lib/routeTitles";
import { surfaceOf } from "@/lib/surfaces";

// A TITLE THAT STAYS, AND BACK IN ONE PLACE (2026-10-08, the navigation round: redesign 2, approved by Ryan).
//
// Before: each crew section opened with a large title and the title left with the page, so a long section
// like Money no longer said where you were; and on five pages Back was a ‹ inside the page (in the
// masthead's corner, on the right), which scrolled away with it. Now, as in Settings or Mail:
//
//   · When the screen's large title has scrolled away — a crew section's heading, a masthead's eyebrow
//     (data-large-title) — a 44pt bar fades in under the status bar with the screen's name in 17pt over a
//     blurred ground. A tap on the name goes back to the top.
//   · A screen you reached from another one carries ‹ and that screen's name at the left of the bar
//     (components/useBack says where Back goes and what it is called). There it is at rest too, above the
//     page, on a clear ground; the ground comes up as soon as anything scrolls under it. The crew console
//     keeps its own ‹ at rest, in its header row, in the same corner.
//   · A tab's own screen (Find Us, Menu, Shop, 3MPIRE, Today) has neither: the tab bar already says where
//     you are, and a tab is where a way through the app starts.
//
// The bar is a zero-height sticky row at the top of the scrolling <main id="body">, so it rides the top of
// the screen whatever is above the scroll (a broadcast banner) and adds no space unless it holds a resting
// ‹ — and then its 44pt is in the page from its first paint (a server render draws it for the screens whose
// Back is known from the address alone), never pushed in under someone's thumb after. Sticky bars inside a
// page step down under it while it shows (data-compact; the calendar's month row).

const ROW = 44;
// Screens that are not for walking through: the truck's TV loop.
const BARE = new Set(["/display"]);
const noop = () => () => {};
const server = () => false;

export default function TitleBar() {
  const pathname = usePathname() || "/";
  const { section } = useOperatorSection();
  const crew = surfaceOf(pathname) === "console";
  const root = isTabRoot(pathname) || BARE.has(pathname);
  const way = useBack();
  const hist = appHistory();
  const moved = useSyncExternalStore(hist ? hist.subscribe : noop, hist ? hist.moved : server, server);
  // What is being watched is keyed to the screen, so a new screen never shows the last one's state.
  const key = crew ? `${pathname}?s=${section}` : pathname;
  const [compactAt, setCompactAt] = useState("");
  const [underAt, setUnderAt] = useState("");
  // A view the screen opened inside itself names itself (data-title on its heading: a lesson, a layer).
  const [named, setNamed] = useState<{ key: string; title: string } | null>(null);
  const title = (named?.key === key && named.title) || (crew ? (SECTION_TITLE[section] ?? "Crew") : titleOf(pathname));
  const compact = !root && compactAt === key;
  const under = underAt === key;
  const rowRef = useRef<HTMLDivElement>(null);
  // At rest the bar holds Back only where Back has somewhere to go and the page was drawn with it: a screen
  // whose Back the address alone decides (upOf), or any screen reached by a move in this visit.
  const resting = !crew && !root && !!way && (upOf(pathname) != null || moved);

  useEffect(() => {
    if (root) return;
    const body = document.getElementById("body");
    const row = rowRef.current;
    if (!body || !row) return;
    let watched: Element | null = null;
    let io: IntersectionObserver | null = null;
    let raf = 0;
    const onScroll = () => {
      setUnderAt(body.scrollTop > 1 ? key : "");
      if (!watched) setCompactAt(body.scrollTop > ROW + 12 ? key : "");
    };
    const attach = () => {
      raf = 0;
      // A view's own heading first (it sits under the screen's masthead), then the screen's.
      const el = body.querySelector("[data-large-title][data-title]") ?? body.querySelector("[data-large-title]");
      if (el === watched) return;
      io?.disconnect();
      io = null;
      watched = el;
      const own = el?.getAttribute("data-title");
      setNamed(own ? { key, title: own } : null);
      if (!el) { onScroll(); return; }
      // The large title is gone once its last pixel is above the bar's bottom edge.
      const edge = Math.max(0, Math.round(row.getBoundingClientRect().bottom - body.getBoundingClientRect().top));
      io = new IntersectionObserver(([e]) => {
        const r = e.rootBounds;
        setCompactAt(!e.isIntersecting && !!r && e.boundingClientRect.bottom <= r.top + 1 ? key : "");
      }, { root: body, rootMargin: `-${edge}px 0px 0px 0px`, threshold: 0 });
      io.observe(el);
    };
    const soon = () => { if (!raf) raf = requestAnimationFrame(attach); };
    // A screen draws its heading when its data arrives: look again whenever the page changes.
    const mo = new MutationObserver(soon);
    mo.observe(body, { childList: true, subtree: true });
    body.addEventListener("scroll", onScroll, { passive: true });
    soon();
    const first = requestAnimationFrame(onScroll);
    return () => {
      io?.disconnect();
      mo.disconnect();
      body.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      cancelAnimationFrame(first);
    };
  }, [key, root]);

  if (root) return null;
  const shown = resting || compact;
  const ground = compact || (resting && under);
  return (
    <div data-tbar="" data-compact={compact ? "" : undefined}
      className={`sticky top-0 z-20 ${resting ? "h-11" : "h-0"}`}>
      <div className={`absolute inset-x-0 top-0 pt-safe [.app:has(>.bcast)_&]:pt-0 ${shown ? "" : "pointer-events-none"}`}>
        {/* The ground: the screen's own (the status bar's, in the app), blurred, with a hairline. Never hit by a
            tap or a look at what is under the status bar (components/NativeBridge reads the screen's ground there). */}
        <div aria-hidden className={`pointer-events-none absolute inset-0 border-b border-line bg-ground/86 [-webkit-backdrop-filter:blur(24px)_saturate(1.5)] [backdrop-filter:blur(24px)_saturate(1.5)] transition-opacity duration-200 ${ground ? "opacity-100" : "opacity-0"}`} />
        <div ref={rowRef} className="relative flex h-11 items-center px-1">
          {way && (
            <button type="button" onClick={way.go} aria-label={`Back to ${way.label}`}
              className={`relative z-10 flex h-11 min-w-11 max-w-[42%] cursor-pointer appearance-none items-center gap-0.5 border-0 bg-transparent pl-1 pr-2 font-sans text-[17px] text-gold2 transition-[opacity,visibility] duration-200 ${shown ? "visible opacity-100" : "invisible opacity-0"}`}>
              <Icon name="chevronLeft" size={24} className="shrink-0" />
              <span className="truncate">{way.label}</span>
            </button>
          )}
          <button type="button" onClick={scrollToTop} aria-label={`${title} — back to the top`}
            className={`absolute left-1/2 h-11 max-w-[52%] -translate-x-1/2 cursor-pointer appearance-none truncate border-0 bg-transparent px-2 font-sans text-[17px] font-semibold text-cream transition-[opacity,visibility] duration-200 ${compact ? "visible opacity-100" : "invisible opacity-0"}`}>
            {title}
          </button>
        </div>
      </div>
    </div>
  );
}
