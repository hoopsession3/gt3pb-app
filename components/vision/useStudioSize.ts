"use client";

import { useEffect, useState } from "react";
import { roomyAt, sizeOf, type StudioSize } from "@/lib/visionStudio";

// THE STUDIO'S WIDTH (S1). The designer lays itself out by the room it is given, not by the screen: an iPad in Split View,
// a desktop with the console's rail, a phone — each gets the workspace its own width can hold. Measured on the studio
// itself (a ResizeObserver), so a rotated iPad or a dragged Split View divider re-lays it at once.
// The rule itself is lib/visionStudio.
/** `ref` goes on the studio's root: a callback, so full screen (the studio drawn again at the app's root) is measured anew. */
/** `short`: the screen is under 520 points tall — a phone on its side (S1.1b, measured: an iPhone 17 on its side is 874 wide
 *  but 402 tall, so by width alone it laid out as a tablet and left the plan 188 points of height). */
export function useStudioSize(): { ref: (el: HTMLElement | null) => void; size: StudioSize; roomy: boolean; width: number; short: boolean } {
  const [el, ref] = useState<HTMLElement | null>(null);
  const [w, setW] = useState(0);
  const [short, setShort] = useState(false);
  useEffect(() => {
    if (!el) return;
    const apply = () => { setW(Math.round(el.getBoundingClientRect().width)); setShort(window.innerHeight < 520); };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return { ref, size: sizeOf(w), roomy: w >= roomyAt, width: w, short };
}
