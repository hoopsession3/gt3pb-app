"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { apiUrl } from "@/lib/native";

// AN ADDRESS FIELD THAT FINDS THE ADDRESS (2026-10-10, Ryan: "When someone types in their address, it goes out and finds
// it. Prepopulate."). The street field, as each form already draws it, and under it — after four letters and a pause —
// up to four real addresses from Apple Maps (app/api/address, lib/appleMaps). A pick fills the street at once, then the
// city, state and ZIP when the address comes back (onPick). Nothing is suggested over an address the form filled from
// a last order until it is edited, and a server with no Maps key answers once that it has none: from then the field is
// the plain field it was. The keyboard works as a combobox's does (↑ ↓ to move, Return to pick, Esc to close), and a
// screen reader hears the list as one.
export type PickedAddress = { street: string; city: string; state: string; zip: string; formatted: string };
type Suggestion = { line1: string; line2: string; pick: string };

let none = false; // this page asked, and the server has no Maps key

export default function AddressField({ value, onChange, onPick, near, className, placeholder, label, maxLength = 120, id, autoComplete = "address-line1" }: {
  value: string;
  onChange: (v: string) => void;
  onPick: (a: PickedAddress) => void;
  /** words that place the search — the ZIP a delivery was checked for — added to what is typed */
  near?: string;
  className?: string;
  placeholder?: string;
  label: string;
  maxLength?: number;
  /** For a visible <label htmlFor> above it (R12, F9); the aria-label stays the same words. */
  id?: string;
  /** "shipping address-line1" where the address is where a parcel goes. */
  autoComplete?: string;
}) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const typed = useRef(false);
  const asking = useRef<AbortController | null>(null);
  const listEl = useRef<HTMLDivElement | null>(null);
  const list = `${useId()}-addr`;
  const open = items.length > 0;

  useEffect(() => {
    if (none || !typed.current) return;
    const text = value.trim();
    if (text.length < 4) return; // the list was cleared as the letters went (onChange, below)
    const wait = setTimeout(async () => {
      asking.current?.abort();
      const c = new AbortController();
      asking.current = c;
      try {
        const r = await fetch(apiUrl(`/api/address?q=${encodeURIComponent(near ? `${text} ${near}` : text)}`), { signal: c.signal });
        const j = await r.json();
        if (j?.configured === false) { none = true; setItems([]); return; }
        setItems(Array.isArray(j?.results) ? j.results.slice(0, 4) : []);
        setActive(-1);
      } catch { /* a newer letter, or offline: the field stays a field */ }
    }, 300);
    return () => clearTimeout(wait);
  }, [value, near]);

  // The list, in sight as it opens: a field low in a sheet would otherwise drop it under the sheet's footer
  // (its button) or the keyboard. The nearest scroller moves only as far as the list needs.
  useEffect(() => {
    if (open) listEl.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  const pick = async (s: Suggestion) => {
    typed.current = false;
    setItems([]);
    onChange(s.line1);
    try {
      const r = await fetch(apiUrl(`/api/address?pick=${encodeURIComponent(s.pick)}`));
      const j = await r.json();
      if (j?.address?.street) onPick(j.address);
    } catch { /* the street is in; the rest is typed as before */ }
  };

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); void pick(items[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setItems([]); }
  };

  return (
    <div className="relative">
      <input id={id} className={className} placeholder={placeholder} aria-label={label} value={value} maxLength={maxLength}
        autoComplete={autoComplete} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={list}
        aria-activedescendant={open && active >= 0 ? `${list}-${active}` : undefined}
        onChange={(e) => { typed.current = true; if (e.target.value.trim().length < 4) setItems([]); onChange(e.target.value); }} onKeyDown={keys}
        onBlur={() => setTimeout(() => setItems([]), 150)} />
      {open && (
        <div id={list} ref={listEl} role="listbox" aria-label="Matching addresses"
          className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-2xl border border-line bg-card shadow-overlay">
          {items.map((s, i) => (
            <button key={s.pick} id={`${list}-${i}`} type="button" role="option" aria-selected={i === active} tabIndex={-1}
              className={`block w-full min-h-11 px-4 py-2.5 text-left border-0 cursor-pointer ${i === active ? "bg-well" : "bg-transparent"} active:bg-well`}
              onPointerDown={(e) => e.preventDefault()} onClick={() => void pick(s)}>
              <span className="block text-subhead font-semibold text-cream">{s.line1}</span>
              {s.line2 && <span className="block text-footnote text-cream-muted">{s.line2.replace(/, United States$/, "")}</span>}
            </button>
          ))}
          <div className="px-4 pb-2 pt-1 text-caption2 text-cream-muted" aria-hidden="true">Apple Maps</div>
        </div>
      )}
    </div>
  );
}
