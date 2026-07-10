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
  // Exit choreography: when `open` flips false, keep rendering ~220ms with the `out` class so the
  // sheet leaves the way it arrived. Works for every close path since it watches the prop itself;
  // the timeout (not animationend) guarantees unmount even under reduced-motion or missing CSS.
  const [phase, setPhase] = useState<"closed" | "open" | "closing">(open ? "open" : "closed");
  useEffect(() => {
    if (open) { setPhase("open"); return; }
    let t: ReturnType<typeof setTimeout> | null = null;
    setPhase((p) => {
      if (p !== "open") return p;
      t = setTimeout(() => setPhase("closed"), 230);
      return "closing";
    });
    return () => { if (t) clearTimeout(t); };
  }, [open]);
  // Most callers mount conditionally ({x && <Sheet open …>}), so the prop never flips — the sheet
  // owns its own exit for the gesture paths: play the out animation, THEN tell the parent to
  // unmount. Buttons inside children that close directly still work (they just skip the animation).
  const closeT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestClose = useCallback(() => {
    if (closeT.current) return;
    setPhase("closing");
    closeT.current = setTimeout(() => { closeT.current = null; onClose(); }, 210);
  }, [onClose]);
  useEffect(() => () => { if (closeT.current) clearTimeout(closeT.current); }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") requestClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, requestClose]);

  const start = useCallback((y: number) => { startY.current = y; }, []);
  const move = useCallback((y: number) => {
    if (startY.current == null) return;
    const dy = y - startY.current;
    setDrag(dy > 0 ? dy : 0); // only downward drags dismiss
  }, []);
  const end = useCallback(() => {
    if (startY.current == null) return;
    startY.current = null;
    setDrag((d) => { if (d > 88) requestClose(); return 0; }); // past the threshold → flick away
  }, [requestClose]);

  if (phase === "closed") return null;
  // Only the grab handle + header are drag-to-dismiss zones — the body scrolls normally, no conflict.
  const dragZone = {
    onTouchStart: (e: React.TouchEvent) => start(e.touches[0].clientY),
    onTouchMove: (e: React.TouchEvent) => move(e.touches[0].clientY),
    onTouchEnd: end,
  };
  const panelStyle = drag
    ? { transform: `translateY(${drag}px)`, transition: "none", opacity: Math.max(0.5, 1 - drag / 420) }
    : undefined;

  const out = phase === "closing" ? " out" : "";
  return (
    <div className={`sheet2-scrim${out}`} onClick={requestClose}>
      <div className={`sheet2 ${className}${out}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}
        style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div className="sheet2-grab" {...dragZone} />
        {header && <div className="sheet2-head" {...dragZone}>{header}</div>}
        <div className="sheet2-body" ref={bodyRef}>{children}</div>
        {footer && <div className="sheet2-foot">{footer}</div>}
      </div>
    </div>
  );
}
