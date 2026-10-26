"use client";

import { useEffect, useState } from "react";
import { roomyAt, sizeOf, type StudioSize } from "@/lib/visionStudio";

// THE STUDIO'S WIDTH (S1). The designer lays itself out by the room it is given, not by the screen: an iPad in Split View,
// a desktop with the console's rail, a phone — each gets the workspace its own width can hold. Measured on the studio
// itself (a ResizeObserver), so a rotated iPad or a dragged Split View divider re-lays it at once.
// The rule itself is lib/visionStudio.
/** `ref` goes on the studio's root: a callback, so full screen (the studio drawn again at the app's root) is measured anew. */
export function useStudioSize(): { ref: (el: HTMLElement | null) => void; size: StudioSize; roomy: boolean; width: number } {
  const [el, ref] = useState<HTMLElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const apply = () => setW(Math.round(el.getBoundingClientRect().width));
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return { ref, size: sizeOf(w), roomy: w >= roomyAt, width: w };
}
