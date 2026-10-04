"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useCrew, crewLabel } from "./useCrew";

// THE PERSON PICK LIST (2026-10-04, the form audit). Ryan: "auto fill where applicable … if
// relational database, generate pick list … when I fill out it's hard to know what's relational."
//
// A person on a crew form was a text box in a dozen places — the brewer on Start brew, the person an
// offer letter or an operator agreement is for, who did the maintenance — and a typed name links to
// nobody: the brew alarm could not find the brewer (0344), an agreement could not reach its
// operator. This is the one way to name a person: the crew from useCrew (the roster every picker
// shares), YOU first and labelled so, and — where the form allows someone who is not on the crew —
// "Someone else…", which opens a box for the name and says plainly that it links to no one.
//
// The value is { id, name }: the id is what the record keeps; the name rides along for the screens
// and logs that print it. A name typed before this existed that matches a crew member's exactly is
// resolved to that person once the roster loads, so an old row picks up its link the next time it
// is saved.

export type PersonValue = { id: string | null; name: string };
const OTHER = "__other";

/** The signed-in person as a starting value — "you, unless you say otherwise". */
export function usePersonMe(): PersonValue {
  const { user, profile } = useAuth();
  return { id: user?.id ?? null, name: profile?.display_name ?? "" };
}

export default function PersonPick({ value, onChange, label, allowOther = true, allowNone = false, noneLabel = "Nobody yet" }: {
  value: PersonValue;
  onChange: (v: PersonValue) => void;
  label: string;
  allowOther?: boolean;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const crew = useCrew();
  const { user } = useAuth();
  const me = user?.id ?? null;
  const [typing, setTyping] = useState(false);
  // A name typed before pick lists existed that IS a crew member: link it once the roster is here.
  const match = !value.id && value.name.trim()
    ? crew.find((c) => (c.display_name ?? "").trim().toLowerCase() === value.name.trim().toLowerCase()) ?? null
    : null;
  useEffect(() => { if (match) onChange({ id: match.id, name: match.display_name ?? value.name }); }, [match, onChange, value.name]);

  const other = !value.id && (typing || value.name.trim() !== "") && !match;
  const selected = value.id ?? (other ? OTHER : "");
  const ordered = [...crew.filter((c) => c.id === me), ...crew.filter((c) => c.id !== me)];
  // An id no longer on the roster (someone since removed) keeps showing as itself, not as blank.
  const missing = value.id && !crew.some((c) => c.id === value.id) ? value : null;

  return (
    <>
      <select aria-label={label} value={selected} onChange={(e) => {
        const v = e.target.value;
        setTyping(v === OTHER);
        if (v === OTHER || !v) { onChange({ id: null, name: "" }); return; }
        const c = crew.find((x) => x.id === v);
        onChange({ id: v, name: c?.display_name ?? "" });
      }}>
        {allowNone ? <option value="">{noneLabel}</option> : !value.id && !other && <option value="">Choose…</option>}
        {missing && <option value={missing.id as string}>{missing.name || "Someone no longer on the crew"}</option>}
        {ordered.map((c) => <option key={c.id} value={c.id}>{c.id === me ? `You — ${crewLabel(c)}` : crewLabel(c)}</option>)}
        {allowOther && <option value={OTHER}>Someone else…</option>}
      </select>
      {other && allowOther && (
        <input aria-label={`${label} — name`} value={value.name} placeholder="Their name — not linked to anyone on the crew"
               onChange={(e) => onChange({ id: null, name: e.target.value })} />
      )}
    </>
  );
}
