"use client";

import { useEffect, useRef } from "react";
import { useApp } from "./AppProvider";

// THE TOAST (R12 — the 10/10 audit, F3). What it says is said to a screen reader as it shows (AppProvider → the app's
// one pair of live regions, components/Announcer), so this is not a live region of its own: it used to flip between
// status and alert on the same node at the moment its words changed, which VoiceOver announces unreliably. Hidden, it
// is hidden from everyone (visibility, aria-hidden) — the last "Couldn't save…" no longer waited for a swipe after it
// had faded. A finger on it or focus in it stops its clock; one with something to do (Undo, Open) has a way to close it
// too, and focus that was in it when it went goes back where it came from.
export default function Toast() {
  const { toastMsg, toastShown, toastVariant, toastAction, hideToast, holdToast } = useApp();
  const isErr = toastVariant === "error";
  const ref = useRef<HTMLDivElement>(null);
  // Where focus was before it came into the toast (a VoiceOver swipe, a Tab) — given back when the toast goes.
  const cameFrom = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (toastShown) return;
    const el = ref.current;
    if (el && el.contains(document.activeElement)) {
      const to = cameFrom.current?.isConnected ? cameFrom.current : document.getElementById("body");
      to?.focus({ preventScroll: true });
    }
    cameFrom.current = null;
  }, [toastShown]);
  return (
    <div
      ref={ref}
      className={`toast${toastShown ? " show" : ""}${isErr ? " err" : ""}${toastAction ? " has-act" : ""}`}
      aria-hidden={toastShown ? undefined : true}
      onPointerEnter={() => holdToast(true)}
      onPointerLeave={() => holdToast(false)}
      onFocus={(e) => {
        const from = e.relatedTarget;
        if (!cameFrom.current && from instanceof HTMLElement && !ref.current?.contains(from)) cameFrom.current = from;
        holdToast(true);
      }}
      onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node | null)) holdToast(false); }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5} aria-hidden="true">
        {isErr ? <path d="M12 8v5M12 16.5v.5M12 3l9 16H3z" /> : <path d="M5 12l5 5L20 7" />}
      </svg>
      <span>{toastMsg}</span>
      {/* "Undo" — the toast's one action, when it has one (a swiped-away flag) — and a way to close it without it. */}
      {toastAction && toastShown && (
        <>
          <button type="button" className="toast-act" onClick={() => { const a = toastAction; hideToast(); a.run(); }}>{toastAction.label}</button>
          <button type="button" className="toast-x" aria-label="Dismiss" onClick={hideToast}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </>
      )}
    </div>
  );
}
