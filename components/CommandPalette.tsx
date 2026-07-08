"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useOperatorSection, sectionsForRole, SECTION_LABEL, type OpSection } from "./OperatorNav";
import { readTopRecents } from "./recents";
import type { Recent } from "@/lib/recents";

// COMMAND PALETTE — ⌘K / Ctrl-K quick-jump for the crew console. Type to jump to any role-allowed
// section or run a quick action, keyboard-first (↑↓ ⏎ esc). The "this is a real product" flourish.
type Item = { id: string; label: string; hint: string; run: () => void };

export default function CommandPalette() {
  const { profile } = useAuth();
  const { setSection } = useOperatorSection();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [recents, setRecents] = useState<Recent[]>([]);
  // Recents are read fresh each time the palette opens (localStorage isn't reactive).
  useEffect(() => { if (open) setRecents(readTopRecents(5)); }, [open]);

  // Jump to a recently-viewed event/stop: stage it for the Prep index, switch there, and nudge it
  // open (covers the already-on-Prep case where a mount read wouldn't re-fire).
  const openPrepTarget = (r: Recent) => {
    try { localStorage.setItem("gt3-prep-open", r.kind === "stop" ? `stop:${r.id}` : r.id); } catch { /* ignore */ }
    setSection("prep");
    window.dispatchEvent(new Event("gt3-open-prep"));
  };

  const role = (profile?.role as string | undefined) ?? (profile?.is_admin ? "owner" : "member");
  const items: Item[] = useMemo(() => {
    const recentItems: Item[] = recents
      .filter((r) => r.kind === "event" || r.kind === "stop")
      .map((r) => ({ id: `rec:${r.key}`, label: r.label, hint: "Recent", run: () => openPrepTarget(r) }));
    const secs: Item[] = sectionsForRole(role).map((s: OpSection) => ({ id: `sec:${s}`, label: SECTION_LABEL[s], hint: "Section", run: () => setSection(s) }));
    const actions: Item[] = [
      { id: "act:scan", label: "Scan a member card", hint: "Action", run: () => router.push("/scan") },
      { id: "act:cust", label: "Customer view", hint: "Action", run: () => router.push("/") },
    ];
    return [...recentItems, ...secs, ...actions];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, setSection, router, recents]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? items.filter((i) => i.label.toLowerCase().includes(t)) : items;
  }, [q, items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); setQ(""); setSel(0); }
      else if (e.key === "Escape") setOpen(false);
    };
    // Touch entry point (mobile has no ⌘K): the Jump chip dispatches this to open the palette.
    const onOpenEvt = () => { setOpen(true); setQ(""); setSel(0); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("gt3-open-cmdk", onOpenEvt);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("gt3-open-cmdk", onOpenEvt); };
  }, []);
  useEffect(() => { setSel(0); }, [q]);

  if (!open) return null;
  const activate = (i: Item) => { i.run(); setOpen(false); };
  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter" && filtered[sel]) { e.preventDefault(); activate(filtered[sel]); }
  };

  return (
    <div className="cmdk-scrim" onMouseDown={() => setOpen(false)}>
      <div className="cmdk" role="dialog" aria-label="Jump to" onMouseDown={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <input autoFocus className="cmdk-in" placeholder="Jump to a section or action…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onInputKey} aria-label="Search" />
        <div className="cmdk-list">
          {filtered.map((i, idx) => (
            <button key={i.id} type="button" className={`cmdk-item${idx === sel ? " on" : ""}`} onMouseEnter={() => setSel(idx)} onClick={() => activate(i)}>
              <span>{i.label}</span><em>{i.hint}</em>
            </button>
          ))}
          {filtered.length === 0 && <div className="cmdk-empty">No match</div>}
        </div>
        <div className="cmdk-foot">↑↓ move · ⏎ go · esc close</div>
      </div>
    </div>
  );
}
