"use client";

import { useRef } from "react";

// Drag-to-dismiss for bottom sheets. Attach `sheetRef` to the sheet element and
// spread `handlers` on the grab area; drag down past the threshold (or flick) to close.
export function useSheetDrag(onClose: () => void) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const startT = useRef(0);

  const onPointerDown = (e: React.PointerEvent) => {
    startY.current = e.clientY;
    startT.current = e.timeStamp;
    try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* */ }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current == null || !sheetRef.current) return;
    const dy = Math.max(0, e.clientY - startY.current);
    sheetRef.current.style.transition = "none";
    sheetRef.current.style.transform = `translateY(${dy}px)`;
  };
  const end = (e: React.PointerEvent) => {
    if (startY.current == null || !sheetRef.current) return;
    const dy = e.clientY - startY.current;
    const dt = e.timeStamp - startT.current;
    const fast = dy > 40 && dt < 250; // a downward flick
    startY.current = null;
    sheetRef.current.style.transition = "";
    sheetRef.current.style.transform = "";
    if (dy > 120 || fast) onClose();
  };

  return { sheetRef, handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end } };
}
