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
//
// onChange says HOW the value changed, because a form may fill other fields from a person it was
// handed: "pick" is someone choosing from the list; "match" is that old typed name being resolved
// (link it, change nothing else — the record already says what it says); "type" is the free-text box.
//
// `others` is for a form whose subject may not be on the crew yet — an offer letter goes to a
// customer before they are hired. They are listed after the crew, under their own heading, and
// never matched by name (a customer called "Chris" is not the crew's Chris).

export type PersonValue = { id: string | null; name: string };
export type PersonHow = "pick" | "match" | "type";
const OTHER = "__other";

/** The signed-in person as a starting value — "you, unless you say otherwise". */
export function usePersonMe(): PersonValue {
  const { user, profile } = useAuth();
  return { id: user?.id ?? null, name: profile?.display_name ?? "" };
}

export default function PersonPick({
  value, onChange, label, allowOther = true, allowNone = false, noneLabel = "Nobody yet",
  prefer = [], disabled = false, withoutMe = false, others = [], othersLabel = "Not on the crew", matchByName = true, className,
}: {
  value: PersonValue;
  onChange: (v: PersonValue, how: PersonHow) => void;
  label: string;
  allowOther?: boolean;
  allowNone?: boolean;
  noneLabel?: string;
  /** Roles listed first, after you — an operator agreement lists the operators before the rest. */
  prefer?: readonly string[];
  disabled?: boolean;
  /** Leave the signed-in person off the list — nobody writes themselves an offer letter. */
  withoutMe?: boolean;
  /** People with an account who are not on the crew, listed after it (see the header). */
  others?: readonly { id: string; name: string }[];
  othersLabel?: string;
  /** Resolve an old typed name to the crew member it spells (on by default). Off where "nobody on the
   *  list" was itself a choice — an offer for someone new is not the crew member who shares a name. */
  matchByName?: boolean;
  /** The form's own field class, for a form whose fields are not styled by their container. */
  className?: string;
}) {
  const crew = useCrew();
  const { user } = useAuth();
  const me = user?.id ?? null;
  const [typing, setTyping] = useState(false);
  const roster = withoutMe ? crew.filter((c) => c.id !== me) : crew;
  // A name typed before pick lists existed that IS a crew member: link it once the roster is here.
  // Never while they are typing into "Someone else…": a half-typed "Ana" is not the crew's Ana.
  const match = matchByName && !typing && !value.id && value.name.trim()
    ? roster.find((c) => (c.display_name ?? "").trim().toLowerCase() === value.name.trim().toLowerCase()) ?? null
    : null;
  useEffect(() => { if (match) onChange({ id: match.id, name: match.display_name ?? value.name }, "match"); }, [match, onChange, value.name]);

  const other = !value.id && (typing || value.name.trim() !== "") && !match && allowOther;
  const selected = value.id ?? (other ? OTHER : "");
  const rank = (c: { id: string; role: string }) => (c.id === me ? 0 : prefer.includes(c.role) ? 1 : 2);
  const ordered = [...roster].sort((a, b) => rank(a) - rank(b));
  // An id no longer on either list (someone since removed) keeps showing as itself, not as blank.
  const missing = value.id && !roster.some((c) => c.id === value.id) && !others.some((o) => o.id === value.id) ? value : null;
  const crewOptions = ordered.map((c) => <option key={c.id} value={c.id}>{c.id === me ? `You — ${crewLabel(c)}` : crewLabel(c)}</option>);

  return (
    <>
      <select aria-label={label} className={className} value={selected} disabled={disabled} onChange={(e) => {
        const v = e.target.value;
        setTyping(v === OTHER);
        if (v === OTHER || !v) { onChange({ id: null, name: "" }, "pick"); return; }
        const c = roster.find((x) => x.id === v);
        const o = c ? null : others.find((x) => x.id === v);
        onChange({ id: v, name: c?.display_name ?? o?.name ?? "" }, "pick");
      }}>
        {allowNone ? <option value="">{noneLabel}</option> : !value.id && !other && <option value="">Choose…</option>}
        {missing && <option value={missing.id as string}>{missing.name || "Someone no longer on the crew"}</option>}
        {others.length > 0 ? <optgroup label="On the crew">{crewOptions}</optgroup> : crewOptions}
        {others.length > 0 && (
          <optgroup label={othersLabel}>
            {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </optgroup>
        )}
        {allowOther && <option value={OTHER}>Someone else…</option>}
      </select>
      {other && (
        <input aria-label={`${label} — name`} className={className} value={value.name} disabled={disabled} placeholder="Their name — not linked to anyone on the crew"
               onChange={(e) => onChange({ id: null, name: e.target.value }, "type")} />
      )}
    </>
  );
}
