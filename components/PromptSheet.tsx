"use client";

import { useState } from "react";
import Sheet from "./Sheet";
import Icon from "@/components/Icon";

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
      header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}>{title}</b><button type="button" className="qd-x" style={{ marginLeft: "auto" }} onClick={onCancel} title="Close"><Icon name="close" /></button></div>}>
      {hint && <div className="dp-hint">{hint}</div>}
      {multiline ? (
        <textarea className="note-in" rows={3} autoFocus value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} />
      ) : (
        <input className="note-in" autoFocus value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      )}
      <div className="prod-actions" style={{ marginTop: 14 }}>
        <button type="button" className="note-arch" onClick={onCancel}>Cancel</button>
        <button type="button" className="note-save" onClick={submit} disabled={busy}>{busy ? "…" : confirmLabel}</button>
      </div>
    </Sheet>
  );
}
