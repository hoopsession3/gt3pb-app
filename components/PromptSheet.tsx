"use client";

import { useState } from "react";
import Sheet, { CloseButton } from "./Sheet";

// PROMPT SHEET — a single-field input in the app's canonical Sheet, standing in for window.prompt().
// Every other input surface in this app is a styled, dismissible-on-mobile Sheet; a native
// window.prompt() blocks the whole page behind an unstyled OS dialog and can't be reskinned or
// escaped the way everything else here can. Same "type a note next to a status change" shape used by
// VIP verify/reject and marking a pipeline opportunity lost — one shared component instead of three
// one-off dialogs.
export default function PromptSheet({
  open, title, hint, placeholder, defaultValue = "", confirmLabel = "Save", multiline = false, onSubmit, onCancel,
}: {
  open: boolean;
  title: string;
  hint?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  multiline?: boolean;
  onSubmit: (value: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try { await onSubmit(value.trim()); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onCancel} label={title}
      header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>{title}</b><CloseButton onClick={onCancel} /></div>}>
      {hint && <div className="dp-hint">{hint}</div>}
      {multiline ? (
        <textarea className="note-in" rows={3} autoFocus value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} />
      ) : (
        <input className="note-in" autoFocus value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      )}
      <div className="prod-actions" style={{ marginTop: 14 }}>
        <button type="button" className="btn-ter" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-pri" onClick={submit} disabled={busy}>{busy ? "…" : confirmLabel}</button>
      </div>
    </Sheet>
  );
}

// ── usePrompt(): the promise form, for the call sites that used window.prompt() ────────────────
// Eight window.prompt() calls were left after this sheet existed, because each needed open-state
// plumbing to use it. A promise needs none: `const v = await prompt({ title, hint })`, null when
// dismissed, the same shape as the line it replaces. One sheet lives at the app root
// (PromptProvider, beside ConfirmProvider); a second question over an unanswered one answers the
// first null, since the viewer cannot have typed into it.
import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";

export type PromptOpts = { title: string; hint?: string; placeholder?: string; defaultValue?: string; confirmLabel?: string; multiline?: boolean };
type Ask = (opts: PromptOpts | string) => Promise<string | null>;

const PromptCtx = createContext<Ask>(async () => {
  if (typeof window !== "undefined") console.warn("usePrompt() called outside PromptProvider — answering null");
  return null;
});

export function usePrompt(): Ask { return useContext(PromptCtx); }

export function PromptProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<PromptOpts | null>(null);
  const resolver = useRef<((v: string | null) => void) | null>(null);
  const settle = useCallback((v: string | null) => { const r = resolver.current; resolver.current = null; setOpts(null); r?.(v); }, []);
  const ask = useCallback<Ask>((o) => {
    resolver.current?.(null);
    const next = typeof o === "string" ? { title: o } : o;
    return new Promise<string | null>((resolve) => { resolver.current = resolve; setOpts(next); });
  }, []);
  return (
    <PromptCtx.Provider value={ask}>
      {children}
      {opts && (
        <PromptSheet open title={opts.title} hint={opts.hint} placeholder={opts.placeholder} defaultValue={opts.defaultValue}
          confirmLabel={opts.confirmLabel ?? "Save"} multiline={opts.multiline}
          onSubmit={(v) => settle(v)} onCancel={() => settle(null)} />
      )}
    </PromptCtx.Provider>
  );
}
