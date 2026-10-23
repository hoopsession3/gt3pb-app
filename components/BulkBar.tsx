"use client";

import { useState } from "react";
import { useAppStable } from "@/components/AppProvider";
import { useConfirm } from "@/components/ConfirmSheet";
import { haptic } from "@/lib/haptics";
import { undoOpen, undoStart } from "@/lib/catalog";
import { confirmWords, inView, outcomeWords, runEach, toggleAll } from "@/lib/bulk";
import Said from "@/components/Said";

// THE BULK BAR (R48) — one bar for every list that acts on many rows at once (lib/bulk says the standard). It sits above
// the list while rows are being picked: how many are picked, Select all (what the list shows — its filter and search),
// Clear, and the list's actions. An action asks first, naming the count; writes each row on its own; says what took and
// names what didn't; and holds an Undo that puts back what was there, for the rows that changed.

export type BulkAction = {
  key: string;
  label: string;          // the button: "Hide"
  verb: string;           // the confirm: "Hide 4 items"
  verbPast: string;       // the answer: "Hid 4 items."
  where?: string;         // "from the shop"
  danger?: boolean;
  apply: (id: string) => Promise<string | null>;
  undo?: (id: string) => Promise<string | null>;
};

export default function BulkBar({ shownIds, selected, setSelected, nameOf, actions, noun = ["item", "items"], onDone }: {
  shownIds: readonly string[];
  selected: ReadonlySet<string>;
  setSelected: (s: Set<string>) => void;
  nameOf: (id: string) => string;
  actions: readonly BulkAction[];
  noun?: [string, string];
  onDone: () => void;
}) {
  const { toast } = useAppStable();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const picked = inView(selected, shownIds);
  const allShown = shownIds.length > 0 && picked.length === shownIds.length;

  const run = async (a: BulkAction) => {
    if (!picked.length || busy) return;
    const w = confirmWords(a.verb, picked.length, noun, a.where);
    if (!(await confirm({ ...w, danger: a.danger }))) return;
    setBusy(a.key); setSaid(null);
    const ids = [...picked];
    const out = await runEach(ids, a.apply);
    setBusy(null);
    const words = outcomeWords(out, a.verbPast, nameOf, noun);
    setSaid(words);
    if (!out.failed.length) haptic("success"); else if (out.ok.length) haptic("warning"); else haptic("error");
    setSelected(new Set(out.failed.map((f) => f.id)));   // what didn't take stays picked, to try again
    onDone();
    if (out.ok.length && a.undo) {
      const at = undoStart();
      const undo = a.undo;
      toast(words, out.failed.length ? "info" : "success", { action: { label: "Undo", run: () => { void (async () => {
        if (!undoOpen(at)) { toast("Too late to undo — change them back from the list", "info"); return; }
        const back = await runEach(out.ok, undo);
        toast(back.failed.length ? outcomeWords(back, "Put back", nameOf, noun) : `Put back ${back.ok.length} ${back.ok.length === 1 ? noun[0] : noun[1]}.`, back.failed.length ? "error" : "success");
        onDone();
      })(); } } });
    } else {
      toast(words, out.failed.length ? (out.ok.length ? "info" : "error") : "success");
    }
  };

  return (
    <div className="flex flex-col gap-2 my-2" role="toolbar" aria-label={`${picked.length} selected`}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-subhead">{picked.length} selected</b>
        <button type="button" className="btn-ter" onClick={() => setSelected(toggleAll(selected, shownIds))} disabled={!shownIds.length}>
          {allShown ? "Clear all" : `Select all ${shownIds.length}`}
        </button>
        {picked.length > 0 && !allShown && <button type="button" className="btn-ter" onClick={() => setSelected(new Set())}>Clear</button>}
      </div>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button key={a.key} type="button" className="btn-sec btn-sm" onClick={() => void run(a)} disabled={!picked.length || !!busy}>
            {busy === a.key ? `${a.label}…` : a.label}
          </button>
        ))}
      </div>
      {said && <Said as="p" className="crm-note mt-0">{said}</Said>}
    </div>
  );
}
