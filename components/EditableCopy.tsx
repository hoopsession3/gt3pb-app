"use client";

import { useEffect, useRef, useState, type ElementType, type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useAuth, roleOf } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { saveCopy } from "@/lib/copy";
import { EDIT_MODE_KEY, readEditMode } from "@/lib/editModeToggle";

// INLINE, ON-SCREEN COPY EDITING — Ryan's ask, 2026-07-17: owners should be able to edit copy
// directly on the page they're looking at, not only through the SiteCopyEditor form in Settings.
// This is a second, complementary door onto the exact same site_copy table/key/default-or-override
// contract from lib/copy.ts — SiteCopyEditor is still there for a full, at-a-glance pass over every
// string in one place; this is for "I'm looking right at the line that's wrong, let me fix it here."
//
// Gated TWICE on purpose: owner role (server-enforced too — RLS on site_copy — this is UX, not the
// security boundary) AND the separate EditModeToggle switch in the float rail. Without the second
// gate, every piece of copy on every page would carry edit chrome for the owner at all times, which
// would make normal browsing (checking how a page actually reads) worse, not better.
//
// When inactive (not owner, or owner with edit mode off) this renders EXACTLY what the caller would
// have rendered directly — same tag, same className, same text, no wrapper behavior at all — so
// dropping this in is a safe, zero-risk substitution for a bare {value} anywhere on a live page.
//
// `value` vs `displayValue`: for a plain key these are the same thing and you only need `value`.
// For a TEMPLATED key (menu.packs_cutoff and friends — raw copy has {cutoff}/{pickup} tokens, see
// fillCopy() in lib/copy.ts) they must differ: `value` stays the raw t(key) template — that's what
// gets loaded into the edit draft and saved back — while `displayValue` is the filled, human-facing
// text shown when not actively editing. Saving the FILLED text back as the override would bake
// today's date into the copy forever and silently kill the dynamism; keeping the template as the
// thing that's actually edited is what keeps {cutoff}/{pickup} alive across saves.
export default function EditableCopy({
  k, value, displayValue, multiline = false, as = "span", className,
}: {
  k: string;
  value: string;
  displayValue?: string;
  multiline?: boolean;
  as?: ElementType;
  className?: string;
}) {
  const As = as;
  const shown = displayValue ?? value;
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const isOwner = roleOf(profile) === "owner";

  const [editMode, setEditMode] = useState(false);
  useEffect(() => {
    if (!isOwner) return;
    const apply = () => setEditMode(readEditMode());
    apply();
    window.addEventListener(EDIT_MODE_KEY, apply);
    window.addEventListener("storage", apply); // cross-tab, matches DisplayToggle
    return () => { window.removeEventListener(EDIT_MODE_KEY, apply); window.removeEventListener("storage", apply); };
  }, [isOwner]);

  const [active, setActive] = useState(false); // this one field is mid-edit right now
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const activeRef = useRef(active); activeRef.current = active;

  // Follow upstream value changes (realtime save elsewhere, or a fresh page load) — but never
  // clobber what's actively being typed. Deliberately depends on `value` ONLY, not `active`: right
  // after commit() below sets active=false AND draft=<the just-saved text> together, `active`
  // flipping would otherwise re-run this and stomp that fresh draft back to the stale `value` prop
  // (the realtime round-trip hasn't landed yet) — the exact flash-back-to-old-copy commit() is
  // trying to avoid. Reading `active` via a ref keeps this reacting only to genuine upstream
  // changes while still seeing the current active state, not a stale one from when it last ran.
  useEffect(() => { if (!activeRef.current) setDraft(value); }, [value]);
  useEffect(() => { if (active) { ref.current?.focus(); ref.current?.select(); } }, [active]);

  if (!isOwner || !editMode) return <As className={className}>{shown}</As>;

  const cancel = () => { setActive(false); setDraft(value); };
  const commit = async () => {
    const next = draft.trim();
    if (!next || next === value) { setActive(false); setDraft(value); return; }
    setSaving(true);
    const { error } = await saveCopy(k, next, user?.id);
    setSaving(false);
    setActive(false);
    if (error) { toast(`Couldn't save — ${error}`, "error"); setDraft(value); return; }
    toast("Saved — live on the site");
    // Show the just-saved text immediately; the realtime round-trip (useSiteCopy → site_copy
    // channel) will land `value` a beat later and agree with it, so there's no flash back to old copy.
    setDraft(next);
  };

  if (active) {
    const shared = {
      value: draft,
      disabled: saving,
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: commit,
      onClick: (e: MouseEvent) => e.stopPropagation(),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === "Escape") { e.preventDefault(); cancel(); }
        else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
      },
    };
    return multiline
      ? <textarea ref={ref as React.RefObject<HTMLTextAreaElement>} className="ec-in ec-multi" rows={3} {...shared} />
      : <input ref={ref as React.RefObject<HTMLInputElement>} type="text" className="ec-in" {...shared} />;
  }

  return (
    <As
      className={`ec-editable${className ? ` ${className}` : ""}`}
      role="button"
      tabIndex={0}
      title="Click to edit this line"
      aria-label={`Edit: ${shown}`}
      onClick={(e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); setActive(true); }}
      onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); setActive(true); } }}
    >
      {shown}
    </As>
  );
}
