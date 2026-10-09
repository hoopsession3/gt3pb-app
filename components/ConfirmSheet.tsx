"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import Sheet, { CloseButton } from "./Sheet";

// CONFIRM SHEET — the one home for "are you sure?", standing in for window.confirm().
//
// ── WHY (2026-10-01, "audit every page and pop-up for friction") ───────────────────────────────
// 58 window.confirm() calls across 25 files, every one a native OS dialog: unstyled, un-swipeable,
// titled "app.gt3pb.com says", blocking the whole page, with an OK/Cancel pair that names neither
// the thing nor the consequence. Three of them were on CUSTOMER surfaces (cancel an order, a pack,
// a delivery). This repo had already said what it thought of that twice — PromptSheet's header
// ("a native window.prompt() blocks the whole page behind an unstyled OS dialog") and SpendBudget
// ("two taps, not a native confirm()") — and GearLibrary carries the scar of a confirm() that
// cascaded into deleting a vessel's whole service history. Each author solved it locally. This is
// the one place.
//
// ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
//   const confirm = useConfirm();
//   if (!(await confirm({ title: "Cancel this order?", body: "We'll flag it for a refund.", confirmLabel: "Cancel order", danger: true }))) return;
//
// A promise, so a call site reads the same as the `if (!window.confirm(msg)) return;` it replaces,
// and the handler stays a straight line. Resolves false on every dismissal — scrim tap, swipe,
// Esc, Cancel, the X — because every one of those means "no". One sheet is mounted at the app
// root by ConfirmProvider; a second confirm asked while one is open resolves the first as false,
// since the viewer cannot have answered it.
//
// `danger` paints the confirming button red (the house primary) and is for the irreversible:
// delete, void, demote. A reversible step (archive, unschedule) keeps the quiet button, so the
// colour keeps meaning something.
export type ConfirmOpts = {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type Ask = (opts: ConfirmOpts | string) => Promise<boolean>;

const Ctx = createContext<Ask>(async () => {
  // No provider above us. Fail SAFE for a destructive step: "no" — never silently "yes".
  if (typeof window !== "undefined") console.warn("useConfirm() called outside ConfirmProvider — answering no");
  return false;
});

export function useConfirm(): Ask { return useContext(Ctx); }

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const settle = useCallback((v: boolean) => {
    const r = resolver.current; resolver.current = null;
    setOpts(null);
    r?.(v);
  }, []);

  const ask = useCallback<Ask>((o) => {
    // A question asked over an unanswered question: the first one was not answered.
    resolver.current?.(false);
    const next = typeof o === "string" ? { title: o } : o;
    return new Promise<boolean>((resolve) => { resolver.current = resolve; setOpts(next); });
  }, []);

  return (
    <Ctx.Provider value={ask}>
      {children}
      {opts && (
        <Sheet open onClose={() => settle(false)} label={opts.title}
          header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>{opts.title}</b><CloseButton onClick={() => settle(false)} /></div>}>
          {opts.body && <div className="dp-hint cfm-body">{opts.body}</div>}
          <div className="prod-actions cfm-actions">
            <button type="button" className="btn-ter" onClick={() => settle(false)}>{opts.cancelLabel ?? "Keep it"}</button>
            <button type="button" className={opts.danger ? "btn-del" : "btn-pri"} autoFocus onClick={() => settle(true)}>{opts.confirmLabel ?? "Yes"}</button>
          </div>
        </Sheet>
      )}
    </Ctx.Provider>
  );
}
