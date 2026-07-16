"use client";

import { useEffect, useRef, useState } from "react";
import Sheet from "@/components/Sheet";
import Icon from "@/components/Icon";

// Best-in-class focused entry — a bottom sheet for a single value (the iOS "Add account number"
// pattern). It sits at the bottom over a LIGHT scrim, so the reference info above stays readable
// while you type, and it carries an inline helper exactly where doubt happens ("Where do I find
// this? ⓘ") without cluttering the main screen. Reuse anywhere a field needs a clear, guided entry.
export default function InputSheet({
  title, value, onChange, onDone, onClose,
  placeholder, type = "text", inputMode, maxLength, multiline,
  hint, help, busy, doneLabel = "Done",
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  onDone: () => void;          // Save/confirm. Keep the sheet open on failure by not closing here.
  onClose: () => void;         // Dismiss without saving.
  placeholder?: string;
  type?: string;
  inputMode?: "text" | "tel" | "email" | "numeric" | "decimal" | "url" | "search";
  maxLength?: number;
  multiline?: boolean;
  hint?: string;                                   // one-line helper under the input
  help?: { label: string; detail: React.ReactNode }; // expandable "Where do I find this? ⓘ"
  busy?: boolean;
  doneLabel?: string;
}) {
  const [showHelp, setShowHelp] = useState(false);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.focus(), 80); return () => clearTimeout(t); }, []);
  const done = () => { if (!busy) onDone(); };

  return (
    <Sheet open onClose={onClose} header={<div style={{ display: "flex", alignItems: "center" }}><button type="button" className="isheet-x" onClick={onClose} aria-label="Close"><Icon name="close" /></button><span className="isheet-title">{title}</span><button type="button" className="isheet-done" onClick={done} disabled={busy || !value.trim()}>{busy ? "…" : doneLabel}</button></div>}>
        {multiline ? (
          <textarea ref={ref} className="isheet-in isheet-area" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength} rows={3} />
        ) : (
          <input
            ref={ref} className="isheet-in" value={value} onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder} type={type} inputMode={inputMode} maxLength={maxLength}
            onKeyDown={(e) => { if (e.key === "Enter") done(); }}
          />
        )}
        {hint && <div className="isheet-hint">{hint}</div>}
        {help && (
          <>
            <button type="button" className="isheet-help" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp}>
              {help.label} <span className="isheet-help-i"><Icon name="info" /></span>
            </button>
            {showHelp && <div className="isheet-help-detail">{help.detail}</div>}
          </>
        )}
    </Sheet>
  );
}
