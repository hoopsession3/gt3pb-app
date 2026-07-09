"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

// THE canonical popout. One implementation, so the scroll contract, safe-area, keyboard-awareness,
// spring-in, and swipe-to-dismiss are guaranteed identical everywhere — no per-sheet drift. Bottom
// sheet on phones (slides up, drag the handle/header down to flick it away), centered modal ≥520px.
// Structure: scrim (flex) > panel (flex column) > grab · [header] · body (the only scroll region) ·
// [footer]. Respects prefers-reduced-motion via the global guard.
export default function Sheet({
  open, onClose, header, footer, children, className = "", labelledBy, bodyRef,
}: {
  open: boolean;
  onClose: () => void;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  // Optional ref onto the scroll body — for a sheet that needs to control its own scroll position
  // (e.g. auto-scrolling a chat transcript to the latest message). Every sheet shares this one scroll
  // region by contract; this just exposes a handle to it instead of a per-sheet nested scroll div.
  bodyRef?: RefObject<HTMLDivElement | null>;
}) {
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const start = useCallback((y: number) => { startY.current = y; }, []);
  const move = useCallback((y: number) => {
    if (startY.current == null) return;
    const dy = y - startY.current;
    setDrag(dy > 0 ? dy : 0); // only downward drags dismiss
  }, []);
  const end = useCallback(() => {
    if (startY.current == null) return;
    startY.current = null;
    setDrag((d) => { if (d > 88) onClose(); return 0; }); // past the threshold → flick away
  }, [onClose]);

  if (!open) return null;
  // Only the grab handle + header are drag-to-dismiss zones — the body scrolls normally, no conflict.
  const dragZone = {
    onTouchStart: (e: React.TouchEvent) => start(e.touches[0].clientY),
    onTouchMove: (e: React.TouchEvent) => move(e.touches[0].clientY),
    onTouchEnd: end,
  };
  const panelStyle = drag
    ? { transform: `translateY(${drag}px)`, transition: "none", opacity: Math.max(0.5, 1 - drag / 420) }
    : undefined;

  return (
    <div className="sheet2-scrim" onClick={onClose}>
      <div className={`sheet2 ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}
        style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div className="sheet2-grab" {...dragZone} />
        {header && <div className="sheet2-head" {...dragZone}>{header}</div>}
        <div className="sheet2-body" ref={bodyRef}>{children}</div>
        {footer && <div className="sheet2-foot">{footer}</div>}
      </div>
    </div>
  );
}
