"use client";

import { useState } from "react";

// THE WAYS OUT, AS WIDGETS (2026-10-03).
//
// A finding on a record sheet (EventRecord, StopRecord) is three things in a row: what is wrong
// (the view's detail), what to do (lib/eventRecord · lib/stopRecord's fix sentence), and — new —
// the control that does it. These are the controls. Three of them, shared by both sheets and by
// OwnerDetails' wrap flow, so the after-action box a person meets on the sheet is the same box
// they met behind the prep checklist, down to the placeholder.
//
// Every button here clears the 44px floor: `.so-move` and `.cp-go` already do, and
// `.ownerdet-wrap-actions button` was raised to it in the same change (it measured 31px).

export type Way = { label: string; onClick: () => void; go?: boolean; busy?: boolean };

/** A row of buttons. `go` renders as a link-out ("… ›"): it lands somewhere, it does not write. */
export function WayButtons({ ways }: { ways: Way[] }) {
  if (ways.length === 0) return null;
  return (
    <div className="str-drift-b">
      {ways.map((w) => w.go ? (
        <button type="button" key={w.label} className="cp-go" onClick={w.onClick} disabled={w.busy}>
          {w.label} <span aria-hidden="true">›</span>
        </button>
      ) : (
        <button type="button" key={w.label} className="so-move" onClick={w.onClick} disabled={w.busy}>
          {w.busy ? "…" : w.label}
        </button>
      ))}
    </div>
  );
}

export type NoteAction = { label: string; onClick: () => void; primary?: boolean; quiet?: boolean };

export const AFTER_ACTION_HINT = "optional — what sold, what ran short, one change for next time";
export const AFTER_ACTION_PLACEHOLDER = "e.g. Rise + Tide sold out by noon; ran short on ice; bring a second cooler next time.";

/** The after-action box. One markup, one placeholder, wherever a note gets written. */
export function NoteBox({ label = "After-action", hint = AFTER_ACTION_HINT, value, onChange, actions, busy, autoFocus }: {
  label?: string; hint?: string; value: string; onChange: (v: string) => void;
  actions: NoteAction[]; busy?: boolean; autoFocus?: boolean;
}) {
  return (
    <div className="ownerdet-wrap">
      <div className="ownerdet-wrap-lbl">{label} {hint && <span>{hint}</span>}</div>
      <textarea className="note-in" rows={3} value={value} onChange={(e) => onChange(e.target.value)}
                placeholder={AFTER_ACTION_PLACEHOLDER} autoFocus={autoFocus} aria-label={label} />
      <div className="ownerdet-wrap-actions">
        {actions.map((a) => (
          <button type="button" key={a.label} onClick={a.onClick} disabled={busy}
                  className={a.primary ? "ownerdet-complete" : a.quiet ? "ownerdet-cancel" : undefined}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * What it took. Dollars (and an optional count) when Square did not see the money, or the one
 * other honest answer. Validation is lib/wrap's; this only collects the strings.
 */
export function TakingsBox({ onAdd, onNothing, busy }: {
  onAdd: (dollars: string, items: string) => void; onNothing: () => void; busy?: boolean;
}) {
  const [dollars, setDollars] = useState("");
  const [items, setItems] = useState("");
  return (
    <div className="ownerdet-wrap">
      <div className="ownerdet-wrap-lbl">What it took <span>cash, a tab, a card reader Square never saw</span></div>
      <div className="evr-take">
        <label><span>Dollars</span>
          <input className="note-in" inputMode="decimal" value={dollars} onChange={(e) => setDollars(e.target.value)} placeholder="184.50" />
        </label>
        <label><span>Items · optional</span>
          <input className="note-in" inputMode="numeric" value={items} onChange={(e) => setItems(e.target.value)} placeholder="38" />
        </label>
      </div>
      <div className="ownerdet-wrap-actions">
        <button type="button" className="ownerdet-complete" onClick={() => onAdd(dollars, items)} disabled={busy}>Add what it took</button>
        <button type="button" onClick={onNothing} disabled={busy}>It took nothing</button>
      </div>
    </div>
  );
}
