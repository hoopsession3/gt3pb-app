"use client";

import { useId, useState, type CSSProperties } from "react";
import { lotChoices, lotLabel, lotNote, TYPED_NOTE, type BrewLot, type LotUse, type LotValue } from "@/lib/brewLots";

// THE COFFEE LOT PICK LIST (2026-10-05, the form audit, part 3d · 0349). Ryan: "if relational
// database, generate pick list … when I fill out it's hard to know what's relational."
//
// The coffee lot on Start brew and in the batch log was a text box, and a typed lot links to no
// delivery: nobody could ask which batches a bag went into, and no batch's coffee ever came off the
// shelf. This is the one way to name a lot: the deliveries that came into the batch's city, coffee
// first (lib/brewLots.lotChoices), and — for a bag that never came in through the app — "A lot not on
// file…", which opens a box for the words and says plainly that they link to nothing.
//
// Under the pick, what naming it will do (lib/brewLots.lotNote): what the lot is, what the brews that
// named it took, and whether this batch's coffee comes off it — or why not. Before 0349 is pasted the
// pick is still offered (its name is what the batch keeps) and the line says the link arrives with
// the next database update, instead of promising a draw that cannot happen yet.
//
// Rendered as a field of its own (`prod-f`), because the line under the select is not phrasing
// content and cannot live inside the <label> the other fields use.

const OTHER = "__other";

export default function CoffeeLotPick({
  value, onChange, lots, failed = null, market, cityName, use, needGrams, today, linkable, logged = false, others = false, label,
  allowNone = false, noneLabel = "Not recorded", style,
}: {
  value: LotValue;
  onChange: (v: LotValue) => void;
  /** The deliveries on file (every city's — the pick offers the batch's). */
  lots: readonly BrewLot[];
  /** The read of them failed: said, and the box offered, rather than an empty list passed off as none. */
  failed?: string | null;
  market: string | null | undefined;
  cityName: string;
  use: ReadonlyMap<string, LotUse>;
  /** This batch's coffee in grams (lib/brewLots.coffeeGrams), for "this batch's 1.23 lb". */
  needGrams: number | null;
  /** Today's key (lib/dates.localToday), for "received 4 weeks ago". */
  today: string;
  /** 0349 is in the database — a pick is kept as a link and the draw follows it. */
  linkable: boolean;
  /** The batch has already logged what it used (consumption_logged_at): its draw is behind it. */
  logged?: boolean;
  /** `use` is the other brews' — this batch's own log, where it is not counted against itself. */
  others?: boolean;
  label: string;
  allowNone?: boolean;
  noneLabel?: string;
  style?: CSSProperties;
}) {
  const id = useId();
  const [typing, setTyping] = useState(false);
  const { coffee, other } = lotChoices(lots, market);
  const offered = [...coffee, ...other];
  const picked = value.id ? offered.find((l) => l.id === value.id) ?? null : null;
  // A lot the batch names that is not offered here (another city's, or gone) keeps showing as itself.
  const missing = value.id && !picked ? value : null;
  const typed = !value.id && (typing || value.text.trim() !== "");
  const selected = value.id ?? (typed ? OTHER : "");
  const opt = (l: BrewLot) => <option key={l.id} value={l.id}>{lotLabel(l)}</option>;

  const note = failed ? `Couldn't load the deliveries — ${failed}. Type the lot for now; it is kept as words.`
    : picked ? lotNote(picked, use.get(picked.id), { needGrams, today, linkable, logged, others })
    : typed ? TYPED_NOTE
    : !offered.length ? `No deliveries on file in ${cityName} yet — a bag logged through Log purchase shows up here. Type the lot for now.`
    : null;

  return (
    <div className="prod-f" style={style}>
      <span id={id}>{label}</span>
      {offered.length > 0 || missing ? (
        <select aria-labelledby={id} value={selected} onChange={(e) => {
          const v = e.target.value;
          setTyping(v === OTHER);
          if (v === OTHER || !v) { onChange({ id: null, text: "" }); return; }
          const l = offered.find((x) => x.id === v);
          onChange({ id: v, text: l ? lotLabel(l) : value.text });
        }}>
          {allowNone ? <option value="">{noneLabel}</option> : !value.id && !typed && <option value="">Choose…</option>}
          {missing && <option value={missing.id as string}>{missing.text || "A lot no longer on file"}</option>}
          {coffee.length > 0 && <optgroup label={`Coffee in ${cityName}`}>{coffee.map(opt)}</optgroup>}
          {other.length > 0 && <optgroup label={coffee.length ? `Other deliveries in ${cityName}` : `Deliveries in ${cityName}`}>{other.map(opt)}</optgroup>}
          <option value={OTHER}>A lot not on file…</option>
        </select>
      ) : null}
      {(typed || (!offered.length && !missing)) && (
        <input aria-label={`${label} — in words`} value={value.text} placeholder="Origin · roast date — not linked to a delivery"
               onChange={(e) => onChange({ id: null, text: e.target.value })} />
      )}
      {note && <p className="lp-note">{note}</p>}
    </div>
  );
}
