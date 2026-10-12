"use client";

import { useEffect, useState, type ReactNode } from "react";
import { OPEN_PANEL_EVENT } from "@/lib/anchors";
import { InfoRow } from "@/components/kit";

// ONE ROW UNTIL ITS DAY (2026-10-10, the Live Ops fold). Live Ops is the service glance: what is
// happening today. Monday's office route, Sunday's porches, next Saturday's drop and the next event
// each drew their whole working face every day of the week — on a Saturday the office route alone
// was 1,100px of Monday under the Pass.
//
// Each of them is this card now: one row that says what it holds (a title, a line under it, a value
// on the right — the look of a <Panel>, .mpanel) until its day, and its working face on its day.
// `today` is the card's own answer to "is this today's work?" — the drop on drop day, the office route
// on its delivery day or when something on it is late. A tap opens or closes it on any day, and
// nothing is remembered: tomorrow it is one row again, unless tomorrow is its day. A link to its id
// opens it, as a <Panel> does (lib/anchors).
//
// A ROW OF A LIST (2026-10-12, the Live Ops round). The pickup drop's card is a row of Due next's list now
// (components/crew/DueList): `row` draws the closed card as the list's own row — the kit's InfoRow, its day in the lead
// column like every row beside it, the title, a tag and the line — and its working face opens under it, in the list.
// The same fold, the same day rule and the same id; only its look is the list's.
export default function FoldCard({ id, title, sub, value, today, label, row, children }: {
  id?: string;
  title: ReactNode;
  /** what is inside, in one line — a closed card always says it (the blind-header rule) */
  sub: ReactNode;
  value?: ReactNode;
  /** open at rest: this is today's work */
  today: boolean;
  label?: string;
  /** Draw it as a row of a list: its day (`lead`, `leadSub`), a tag, and what VoiceOver hears (`says`). */
  row?: { lead?: string; leadSub?: string; tag?: ReactNode; says: string };
  children: ReactNode;
}) {
  const [asked, setAsked] = useState<boolean | null>(null);
  const open = asked ?? today;
  useEffect(() => {
    if (!id) return;
    const onOpen = (e: Event) => { if ((e as CustomEvent<string>).detail === id) setAsked(true); };
    window.addEventListener(OPEN_PANEL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PANEL_EVENT, onOpen);
  }, [id]);
  if (row) {
    return (
      <section id={id} aria-label={label}>
        <InfoRow lead={row.lead} leadSub={row.leadSub} name={title} nameExtra={row.tag}
          meta={value != null && value !== false ? <>{sub} · {value}</> : sub}
          onClick={() => setAsked(!open)} expanded={open} ariaLabel={`${row.says}. ${open ? "Hides" : "Shows"} it here.`} />
        {open && <div className="mpanel-body px-0">{children}</div>}
      </section>
    );
  }
  return (
    <section id={id} className={`mpanel fold${open ? " open" : ""}`} aria-label={label}>
      <button type="button" className="mpanel-h" onClick={() => setAsked(!open)} aria-expanded={open}>
        <span className="mpanel-tt"><span className="mpanel-t">{title}</span><span className="mpanel-s">{sub}</span></span>
        {value != null && value !== false && <span className="mpanel-v">{value}</span>}
        <span className="mpanel-chev" aria-hidden="true">›</span>
      </button>
      {open && <div className="mpanel-body">{children}</div>}
    </section>
  );
}
