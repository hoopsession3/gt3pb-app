"use client";

import { useEffect, useRef, type RefObject } from "react";

// Shared focus-in / Tab-trap / focus-restore for the app's few bespoke overlays that don't route
// through the canonical Sheet (Wave 2, 2026-07-15 — Sheet.tsx got the same fix inline, tuned to its
// own animated-unmount timing; this is for the handful of one-off popovers/takeovers that predate
// or intentionally bypass Sheet: MarketingSplash, ConnectHub, DisplayToggle).
const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useFocusTrap(open: boolean, containerRef: RefObject<HTMLElement | null>) {
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    const raf = requestAnimationFrame(() => {
      const first = containerRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? containerRef.current)?.focus();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open || !restoreRef.current) return;
    const el = restoreRef.current;
    restoreRef.current = null;
    requestAnimationFrame(() => el.focus?.());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = Array.from(containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
