"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import { AsyncSection } from "./AsyncSection";
import Icon from "@/components/Icon";
import { type OptionSetKey } from "@/lib/options";

// THE LISTS, EDITABLE. 0306 moved the closed vocabularies — inventory units, inventory statuses,
// document kinds, menu timing — out of lib/ constants and into public.option_sets, so every picker
// finally reads one source. That fixed the drift and created a new problem: the lists became
// uneditable from inside the app. Adding a unit went from "ship a deploy" to "open the SQL editor",
// which is not obviously better and is certainly not something to hand a market lead.
//
// This is the other half. Add a value, rename how it reads, reorder it, retire it. Writes go
// straight to option_sets; RLS already restricts them to admins, so this panel does not re-check —
// a non-admin simply gets a refusal from the database, which is the only check that can be trusted.
//
// RETIRE, NEVER DELETE. Values are already written onto rows: an item whose unit is "case" still
// says "case" after the option is retired. Deleting the row would leave that item holding a value
// nothing explains, and the picker showing a blank where a real value sits. Retiring drops it from
// the list of things you can newly choose, and lib/options' withCurrent still renders it on any row
// that already has it, marked as no longer on the list.

type Row = { id: string; set_key: string; value: string; label: string | null; sort: number; active: boolean };

const SETS: { key: OptionSetKey; title: string; blurb: string }[] = [
  { key: "inventory_unit",   title: "Stock units",      blurb: "How a shelf item is counted. Used by both inventory editors and intake." },
  { key: "inventory_status", title: "Stock status",     blurb: "Where an item stands. This list was two different lists until 0306." },
  { key: "doc_kind",         title: "Document types",   blurb: "What a filed document is. Used by intake." },
  { key: "menu_timing",      title: "Menu timing",      blurb: "When a drink is for. Three values; the menu editor picks from them." },
  { key: "agreement_activity", title: "Agreement duties",  blurb: "What an operator's agreement says they cover. Add one here and it shows up on every agreement's scope picker." },
];

export default function ListsPanel() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<OptionSetKey | null>(null);
  const [newValue, setNewValue] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const loader = useCallback(async (): Promise<Row[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("option_sets")
      .select("id, set_key, value, label, sort, active").order("set_key").order("sort").order("value");
    if (error) throw new Error(error.message);
    return (data as Row[]) ?? [];
  }, []);
  const board = useAsyncData(loader, []);
  const rows = board.data ?? [];

  const patch = async (id: string, fields: Partial<Row>) => {
    if (!supabase || busy) return;
    setBusy(true);
    const { error } = await supabase.from("option_sets").update(fields).eq("id", id);
    setBusy(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    board.reload();
  };

  const add = async (key: OptionSetKey) => {
    const value = newValue.trim();
    if (!supabase || !value || busy) return;
    setBusy(true);
    // Sort lands after everything currently in the set, so a new value appears at the bottom of the
    // dropdown rather than jumping into the middle of an order someone chose on purpose.
    const last = rows.filter((r) => r.set_key === key).reduce((n, r) => Math.max(n, r.sort), 0);
    const { error } = await supabase.from("option_sets")
      .insert({ set_key: key, value, label: newLabel.trim() || value, sort: last + 10 });
    setBusy(false);
    if (error) {
      // The unique (set_key, value) constraint is the useful error here — say what it means.
      toast(/duplicate|unique/i.test(error.message)
        ? `"${value}" is already on this list.` : `Couldn't add — ${error.message}`, "error");
      return;
    }
    setNewValue(""); setNewLabel(""); setAdding(null);
    toast(`Added ${value}`);
    board.reload();
  };

  return (
    <AsyncSection state={board}
      emptyTitle="No lists yet"
      emptySub="Run 0306 to seed the vocabularies every dropdown reads."
      loadingLabel="Loading lists…"
      errorTitle="Couldn't load the lists"
      isEmpty={(d) => (d as Row[]).length === 0}>
      {() => <>
      <p className="dp-hint" style={{ marginTop: 0 }}>
        The lists every dropdown in the console reads. Change one here and it changes everywhere at
        once — no deploy. Retiring a value removes it from what you can newly pick; anything already
        saved with it keeps it.
      </p>

      {SETS.map((s) => {
        const mine = rows.filter((r) => r.set_key === s.key);
        return (
          <div key={s.key} className="gl-form" style={{ marginTop: 12 }}>
            <div className="gl-form-h">{s.title}</div>
            <p className="dp-hint" style={{ marginTop: -4 }}>{s.blurb}</p>

            {mine.length === 0 && <div className="dp-hint">Nothing on this list yet.</div>}

            {mine.map((r) => (
              <div key={r.id} className="lst-row">
                <input className="lst-order" type="number" inputMode="numeric" defaultValue={r.sort}
                       aria-label={`Order for ${r.value}`} title="Order in the dropdown"
                       onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n !== r.sort) patch(r.id, { sort: n }); }} />
                <code className="lst-val" title="What gets stored on the row — not editable, because rows already hold it">{r.value}</code>
                <input className="lst-label" defaultValue={r.label ?? r.value} maxLength={60}
                       aria-label={`Label for ${r.value}`} placeholder={r.value}
                       onBlur={(e) => { const v = e.target.value.trim(); if (v !== (r.label ?? r.value)) patch(r.id, { label: v || null }); }} />
                <button type="button" className={`lst-live${r.active ? " on" : ""}`} disabled={busy}
                        aria-pressed={r.active} onClick={() => patch(r.id, { active: !r.active })}
                        title={r.active ? "On the list — click to retire" : "Retired — click to bring back"}>
                  {r.active ? <><Icon name="check" /> Offered</> : "Retired"}
                </button>
              </div>
            ))}

            {adding === s.key ? (
              <div className="lst-add">
                <label className="gl-f"><span>Value <i>— what gets stored, and cannot be changed later</i></span>
                  <input value={newValue} maxLength={40} autoFocus placeholder="e.g. tray"
                         onChange={(e) => setNewValue(e.target.value)} /></label>
                <label className="gl-f"><span>Label <i>— how it reads in the dropdown (optional)</i></span>
                  <input value={newLabel} maxLength={60} placeholder={newValue || "same as the value"}
                         onChange={(e) => setNewLabel(e.target.value)} /></label>
                <div className="prod-actions">
                  <button type="button" className="note-arch" onClick={() => { setAdding(null); setNewValue(""); setNewLabel(""); }}>Cancel</button>
                  <button type="button" className="note-save" disabled={busy || !newValue.trim()} onClick={() => add(s.key)}>Add</button>
                </div>
              </div>
            ) : (
              <button type="button" className="tm-hire-open" style={{ marginTop: 8 }}
                      onClick={() => { setAdding(s.key); setNewValue(""); setNewLabel(""); }}>
                Add to {s.title.toLowerCase()} <span className="ev-chev" aria-hidden="true">›</span>
              </button>
            )}
          </div>
        );
      })}
      </>}
    </AsyncSection>
  );
}
