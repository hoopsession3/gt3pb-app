"use client";

import { useState } from "react";

// Name-first inline creator — replaces the "insert a 'New X' placeholder row, then edit inline"
// pattern that left "Untitled" junk whenever a create was abandoned. Click the button → type a name →
// the row is created WITH that name (and opened for the rest of its details). Blank / Escape / click-away
// cancels and nothing ever hits the DB unnamed. One shared composer so every ops list creates the same way.
export default function InlineCreate({ label, placeholder, onCreate, className = "adm-btn", style }: {
  label: string;
  placeholder: string;
  onCreate: (name: string) => void | Promise<void>;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try { await onCreate(n); } finally { setBusy(false); setName(""); setOpen(false); }
  };

  if (!open) {
    return <button type="button" className={className} style={style} onClick={() => setOpen(true)}>{label}</button>;
  }
  return (
    <span className="inline-create" style={style}>
      <input
        autoFocus
        className="inline-create-in"
        value={name}
        placeholder={placeholder}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); else if (e.key === "Escape") { setName(""); setOpen(false); } }}
        onBlur={() => { if (!name.trim()) setOpen(false); }}
      />
      {/* preventDefault on mousedown so the Add click fires before the input's blur closes the composer */}
      <button type="button" className="inline-create-go" onMouseDown={(e) => e.preventDefault()} onClick={submit} disabled={!name.trim() || busy}>
        {busy ? "…" : "Add"}
      </button>
    </span>
  );
}
