"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { prepHandoffKey, prepHandoffValue } from "@/lib/eventRecord";
import { useRouter } from "next/navigation";
import { useAuth, roleOf } from "./AuthProvider";
import { useOperatorSection, sectionsForRole, SECTION_LABEL, type OpSection } from "./OperatorNav";
import { readTopRecents } from "./recents";
import type { Recent } from "@/lib/recents";
import { APP_BUILD } from "@/lib/native";
import { PANEL_INDEX, panelMatches } from "@/lib/panelIndex";
import { scrollToAnchor } from "@/lib/anchors";
import Said from "./Said";
import { useChanged } from "@/lib/useChanged";
import { ModalAnnouncer } from "./Announcer";

// COMMAND PALETTE — ⌘K / Ctrl-K quick-jump for the crew console. Type to jump to any role-allowed
// section or run a quick action, keyboard-first (↑↓ ⏎ esc). The "this is a real product" flourish.
//
// EVERY PANEL, BY THE WORDS AN OWNER TYPES (R48 — the console audit: "store", "merch", "course", "discount" found
// nothing). Typed, it also finds each panel the reader's role can open — by its title, its section and the words in
// lib/panelIndex — and opens it where it lives. Empty, it stays the sections and actions it always was.
type Item = { id: string; label: string; hint: string; run: () => void; match?: (q: string) => boolean };

export default function CommandPalette() {
  const { profile } = useAuth();
  const { setSection } = useOperatorSection();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [recents, setRecents] = useState<Recent[]>([]);
  // Recents are read fresh each time the palette opens (localStorage isn't reactive) — as it opens, during render (R17,
  // lib/useChanged), so its first frame has them.
  if (useChanged(open) && open) setRecents(readTopRecents(5));
  // Focus return: remember what was focused when the palette opened, restore it on close so keyboard
  // users aren't dumped at the top of the document.
  const restoreRef = useRef<HTMLElement | null>(null);
  const suppressRestore = useRef(false); // set when an item navigates — destination manages focus
  useEffect(() => {
    if (!open && restoreRef.current) {
      const el = restoreRef.current; restoreRef.current = null;
      if (!suppressRestore.current) requestAnimationFrame(() => el.focus?.());
      suppressRestore.current = false;
    }
  }, [open]);
  // Tab-trap while open — the palette is a full scrim takeover, so Tab shouldn't be able to
  // escape into the page behind it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const panel = document.querySelector<HTMLElement>(".cmdk");
      const items = Array.from(panel?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? []).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Jump to a recently-viewed event/stop: stage it for the Prep index, switch there, and nudge it
  // open (covers the already-on-Prep case where a mount read wouldn't re-fire).
  const openPrepTarget = (r: Recent) => {
    try { localStorage.setItem(prepHandoffKey, prepHandoffValue(r.kind === "stop" ? "stop" : "event", r.id)); } catch { /* ignore */ }
    setSection("prep");
    window.dispatchEvent(new Event("gt3-open-prep"));
  };

  const role = roleOf(profile);
  const items: Item[] = useMemo(() => {
    const recentItems: Item[] = recents
      .filter((r) => r.kind === "event" || r.kind === "stop")
      .map((r) => ({ id: `rec:${r.key}`, label: r.label, hint: "Recent", run: () => openPrepTarget(r) }));
    const secs: Item[] = sectionsForRole(role).map((s: OpSection) => ({ id: `sec:${s}`, label: SECTION_LABEL[s], hint: "Section", run: () => setSection(s) }));
    // "Scan a member card" is the web's (2026-10-11, the App Store audit): a member's card is scanned with the phone's
    // Camera, which opens the link in Safari, not in the iPhone app — so in the app the action led to a page waiting
    // for a scan that could never arrive there (lib/native APP_BUILD: the app's build, fixed when it is made).
    const actions: Item[] = [
      ...(APP_BUILD ? [] : [{ id: "act:scan", label: "Scan a member card", hint: "Action", run: () => router.push("/scan") }]),
      { id: "act:cust", label: "Customer view", hint: "Action", run: () => router.push("/") },
      // R52: the plan — the roadmap, the store in 3D, Present — found by the words people ask it with.
      { id: "act:vision", label: "The vision — roadmap & the store", hint: "Action", run: () => router.push("/vision"),
        match: (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => "vision roadmap plan plans what's next whats next store brick mortar 3d design investors present pitch".includes(t)) },
    ];
    const allowed = new Set<OpSection>(sectionsForRole(role));
    const panels: Item[] = PANEL_INDEX.filter((e) => allowed.has(e.section)).map((e) => ({
      id: `panel:${e.id}`, label: e.title, hint: SECTION_LABEL[e.section],
      run: () => { setSection(e.section); scrollToAnchor(e.id); },
      match: (q: string) => panelMatches(e, SECTION_LABEL[e.section], q),
    }));
    return [...recentItems, ...secs, ...actions, ...panels];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, setSection, router, recents]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    // Empty: sections and actions. Typed: anything whose name has it, and every panel the words find.
    return t ? items.filter((i) => (i.match ? i.match(t) : i.label.toLowerCase().includes(t))) : items.filter((i) => !i.match);
  }, [q, items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => { if (!o) restoreRef.current = (document.activeElement as HTMLElement) ?? null; return !o; }); setQ(""); setSel(0); }
      else if (e.key === "Escape") setOpen(false);
    };
    // Touch entry point (mobile has no ⌘K): the Jump chip dispatches this to open the palette.
    const onOpenEvt = () => { restoreRef.current = (document.activeElement as HTMLElement) ?? null; setOpen(true); setQ(""); setSel(0); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("gt3-open-cmdk", onOpenEvt);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("gt3-open-cmdk", onOpenEvt); };
  }, []);
  if (useChanged(q)) setSel(0);   // a new query starts at its first match, during render (R17)

  if (!open) return null;
  const activate = (i: Item) => { suppressRestore.current = true; i.run(); setOpen(false); };
  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter" && filtered[sel]) { e.preventDefault(); activate(filtered[sel]); }
  };

  return (
    <div className="cmdk-scrim" onMouseDown={() => setOpen(false)}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Jump to" onMouseDown={(e) => e.stopPropagation()}>
        <ModalAnnouncer />{/* "No match" and the rest, said inside the palette (R33 — UX11-01) */}
        {/* A COMBOBOX, SAID AS ONE (R12 — the 10/10 audit, F8): ↑ ↓ moved a highlight a screen reader never heard. The field
            says it controls a list of options and which one is picked (aria-activedescendant), as the address field's
            does; the options are the list's; "No match" is said when it comes. */}
        <input autoFocus className="cmdk-in" placeholder="Search — a section, a panel, “merch”, “course”…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onInputKey}
          aria-label="Jump to" role="combobox" aria-autocomplete="list" aria-expanded={filtered.length > 0} aria-controls="cmdk-list"
          aria-activedescendant={filtered[sel] ? `cmdk-opt-${sel}` : undefined} />
        <div className="cmdk-list" id="cmdk-list" role="listbox" aria-label="Sections, panels and actions">
          {filtered.map((i, idx) => (
            <button key={i.id} id={`cmdk-opt-${idx}`} type="button" role="option" aria-selected={idx === sel} tabIndex={-1}
              className={`cmdk-item${idx === sel ? " on" : ""}`} onMouseEnter={() => setSel(idx)} onClick={() => activate(i)}>
              <span>{i.label}</span><em>{i.hint}</em>
            </button>
          ))}
        </div>
        {filtered.length === 0 && <Said className="cmdk-empty">No match</Said>}
        {/* keys, for a keyboard: a touch screen — a phone, the iPhone app — has none of them (2026-10-11, the App Store audit) */}
        <div className="cmdk-foot pointer-coarse:hidden">↑↓ move · ⏎ go · esc close</div>
      </div>
    </div>
  );
}
