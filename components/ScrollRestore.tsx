"use client";

import { useEffect, useRef } from "react";
import { useOperatorSection } from "./OperatorNav";

// SCROLL RESTORATION — remember where you were in each crew section and return there when you come
// back (via nav, back button, or swipe-back). Section switches are query-only, so the shell's
// scroll-to-top-on-route effect leaves them alone; we track each section's scroll live and restore
// it on re-entry. Without this, backing into a long Prep or Money list dumps you at the top.
export default function ScrollRestore() {
  const { section } = useOperatorSection();
  const positions = useRef<Record<string, number>>({});
  const sectionRef = useRef(section);
  sectionRef.current = section;

  // Continuously record the current section's scroll so it's captured BEFORE the content swaps.
  useEffect(() => {
    const body = document.getElementById("body");
    if (!body) return;
    const onScroll = () => { positions.current[sectionRef.current] = body.scrollTop; };
    body.addEventListener("scroll", onScroll, { passive: true });
    return () => body.removeEventListener("scroll", onScroll);
  }, []);

  // On section change, restore the incoming section's saved scroll (next frame, after content mounts).
  useEffect(() => {
    const body = document.getElementById("body");
    if (!body) return;
    const target = positions.current[section] ?? 0;
    const raf = requestAnimationFrame(() => { body.scrollTop = target; });
    return () => cancelAnimationFrame(raf);
  }, [section]);

  return null;
}
