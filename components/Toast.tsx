"use client";

import { useApp } from "./AppProvider";

export default function Toast() {
  const { toastMsg, toastShown, toastVariant, toastAction, hideToast } = useApp();
  const isErr = toastVariant === "error";
  return (
    <div
      className={`toast${toastShown ? " show" : ""}${isErr ? " err" : ""}${toastAction ? " has-act" : ""}`}
      role={isErr ? "alert" : "status"}
      aria-live={isErr ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5} aria-hidden="true">
        {isErr ? <path d="M12 8v5M12 16.5v.5M12 3l9 16H3z" /> : <path d="M5 12l5 5L20 7" />}
      </svg>
      <span>{toastMsg}</span>
      {/* "Undo" — the toast's one action, when it has one (a swiped-away flag). */}
      {toastAction && toastShown && (
        <button type="button" className="toast-act" onClick={() => { const a = toastAction; hideToast(); a.run(); }}>{toastAction.label}</button>
      )}
    </div>
  );
}
