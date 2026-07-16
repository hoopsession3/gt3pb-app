"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

// THE canonical popout. One implementation, so the scroll contract, safe-area, keyboard-awareness,
// spring-in, and swipe-to-dismiss are guaranteed identical everywhere — no per-sheet drift. Bottom
// sheet on phones (slides up, drag the handle/header down to flick it away), centered modal ≥520px.
// Structure: scrim (flex) > panel (flex column) > grab · [header] · body (the only scroll region) ·
// [footer]. Respects prefers-reduced-motion via the global guard.
export default function Sheet({
  open, onClose, header, footer, children, className = "", labelledBy, label, bodyRef,
}: {
  open: boolean;
  onClose: () => void;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  // Accessible name for the dialog (a11y: dialog-name). Use `labelledBy` to point at a title element,
  // or `label` for a plain string. If neither is given we fall back to "Dialog" so the modal is never
  // nameless — every caller SHOULD pass one of them, but the fallback guarantees axe never fails here.
  label?: string;
  // Optional ref onto the scroll body — for a sheet that needs to control its own scroll position
  // (e.g. auto-scrolling a chat transcript to the latest message). Every sheet shares this one scroll
  // region by contract; this just exposes a handle to it instead of a per-sheet nested scroll div.
  bodyRef?: RefObject<HTMLDivElement | null>;
}) {
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
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
    // Restore focus now, not on a later phase==="closed" — for the common conditionally-mounted
    // caller ({x && <Sheet .../>}) the parent unmounts the whole subtree as soon as onClose fires
    // below, so an effect gated on a future phase transition never gets the chance to run (verified:
    // that transition is also unreachable via this path even when the parent keeps rendering, since
    // phase is already "closing" by the time the open-prop effect would react to onClose's result).
    if (restoreRef.current) {
      const el = restoreRef.current;
      restoreRef.current = null;
      el.focus?.();
    }
    closeT.current = setTimeout(() => { closeT.current = null; onClose(); }, 210);
  }, [onClose]);
  useEffect(() => () => { if (closeT.current) clearTimeout(closeT.current); }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") requestClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, requestClose]);

  // Focus management: remember what was focused when the sheet opens, move focus into the panel;
  // restore it once the exit animation finishes and the sheet actually unmounts (phase === "closed"),
  // not on the `open` prop flip — closing plays out over ~210-230ms and shouldn't yank focus early.
  useEffect(() => {
    if (phase !== "open") return;
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    const raf = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panelRef.current)?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [phase]);
  useEffect(() => {
    if (phase !== "closed" || !restoreRef.current) return;
    const el = restoreRef.current;
    restoreRef.current = null;
    requestAnimationFrame(() => el.focus?.());
  }, [phase]);
  useEffect(() => {
    if (phase === "closed") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase]);

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
      <div className={`sheet2 ${className}${out}`} ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : (label ?? "Dialog")}
        style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div className="sheet2-grab" {...dragZone} />
        {header && <div className="sheet2-head" {...dragZone}>{header}</div>}
        <div className="sheet2-body" ref={bodyRef}>{children}</div>
        {footer && <div className="sheet2-foot">{footer}</div>}
      </div>
    </div>
  );
}
