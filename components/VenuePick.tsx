"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import { useApp } from "@/components/AppProvider";
import { useAuth } from "@/components/AuthProvider";
import { useOperatorSection } from "@/components/OperatorNav";
import { canOf } from "@/lib/roles";
import { goPlanTab } from "@/lib/planNav";
import { geocode } from "@/lib/geocode";
import { addVendorLocation, resolveVendor, similarVendors, type ResolveDecision, type VendorMatch } from "@/lib/vendorLink";
import {
  NEW_VENUE, NO_VENUE, currentVenue, newVenueSeed, typedPlace, venueChoices, venueFill, venueGroups, venueNote,
  type PlaceRec, type VenueChoice, type VenueFill,
} from "@/lib/venues";
import { useVenues } from "./useVenues";
import VenueContact from "./VenueContact";

// The look-alike sheet only opens when a new venue resembles one in the book.
const VendorResolve = dynamic(() => import("@/components/VendorResolve"));

// THE VENUE PICK (2026-10-05, the form audit, part 4) — the one way a stop or an event names the
// venue it is at, on every screen that edits its place: the stop and event sheet (FieldOpSheet), the
// prep hub's editor (OwnerDetails), the event card in Plan › Events, the calendar's quick-add and the
// event copilot. What it lists, where it starts, what a pick fills in and the line under it are
// lib/venues'; this draws them, and adds a venue to the book when the place is not in it.
//
//   · A record whose words already spell one venue starts on it — "Soul Yoga" typed before the pick
//     existed — and, on a form that saves, the pick takes it (`match`): the form says saving links
//     it. Where a pick writes at once (the event card), it is offered with a button instead, because
//     opening a card must not change the record.
//   · A record whose words only look like a venue — "Wine Express" against the book's "WineXpress" —
//     is offered that venue (similar_vendors, 0226's look-alike rule), with a button.
//   · "+ Add a venue to the book…" takes a name, checks it against the book (lib/vendorLink's one
//     resolver: the same name links, a look-alike asks — VendorResolve — and a new one goes in waiting
//     for the owner's approval), files it in the record's city with the address the record already
//     has, and picks it. Nothing is added to the book without that tap: the screens that turned typed
//     words into vendors on save are how one place became three.
//
// `onChange` hands the form what the pick writes (lib/venues.venueFill — the words, and the pin
// apart), and how: "pick" is someone choosing; "match" is the record's own words resolved.

export type VenueHow = "pick" | "match";

const similarCache = new Map<string, VendorMatch[]>();

export default function VenuePick({
  kind, rec, saved, onChange, match = true, source, contact = false, label = "Venue", fieldClass = "prod-f", inputClass, disabled = false, style,
}: {
  kind: "stop" | "event";
  /** The record, or the form editing it, as it stands. */
  rec: PlaceRec;
  /** The venue as the database has it, when the form has not saved yet — what "Saving files it to…" compares. */
  saved?: string | null;
  onChange: (fill: VenueFill, how: VenueHow, choice: VenueChoice | null) => void;
  /** A form that saves: it takes the venue the record's words already spell, and offers no door away
   *  from the unsaved form. Off where a pick writes at once (the event card): there the spelled venue is
   *  offered, and an admin gets the door to approve a pending one. */
  match?: boolean;
  /** Where a venue added here came from, for the owner's approval alert. */
  source: string;
  /** The venue's liaison, phone and email under the pick. */
  contact?: boolean;
  label?: string;
  fieldClass?: string;
  inputClass?: string;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const id = useId();
  const { toast } = useApp();
  const { profile } = useAuth();
  const { setSection } = useOperatorSection();
  const { book, error, reload } = useVenues();
  const [adding, setAdding] = useState(false);
  const [nm, setNm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [similar, setSimilar] = useState<VendorMatch[] | null>(null);
  // Whether the record's words have been read against the book yet — once, when both are here.
  const checked = useRef(false);
  // The last look-alike answer — kept so the answer arriving draws the line under the pick.
  const [looks, setLooks] = useState<{ text: string; matches: VendorMatch[] } | null>(null);

  const choices = useMemo(() => (book ? venueChoices(book.venues, book.sites, [rec.vendor_id]) : []), [book, rec.vendor_id]);
  const now = useMemo(() => currentVenue(rec, choices, book?.venues ?? []), [rec, choices, book]);
  const groups = useMemo(() => venueGroups(choices, rec.market ?? null), [choices, rec.market]);
  const typed = typedPlace(kind, rec);
  const was: VenueChoice | null = now.how === "linked" ? now.choice : null;
  // Words that spell a venue are offered ("Link it") until the record is linked.
  const shown = adding ? NEW_VENUE : now.how === "matched" ? NO_VENUE : now.value;

  // A form that saves takes the venue its words spelled when the book arrived — the words as they
  // were saved, or as the copilot drafted them — once (PersonPick's "match"). Words typed after that
  // are only offered: a half-typed "Soul" is not the venue called Soul.
  useEffect(() => {
    if (!book || checked.current) return;
    checked.current = true;
    if (match && !disabled && now.how === "matched") onChange(venueFill(kind, rec, null, now.choice), "match", now.choice);
  }, [book, match, disabled, now, kind, rec, onChange]);

  // Words that only look like a venue: ask the book's look-alike rule, after the typing stops.
  const askLooks = !!book && shown === NO_VENUE && now.how === "none" && typed.length >= 3;
  const looksKey = typed.toLowerCase();
  useEffect(() => {
    if (!askLooks || similarCache.has(looksKey)) return;
    let on = true;
    const t = setTimeout(() => {
      similarVendors(typed).then((m) => { similarCache.set(looksKey, m); if (on) setLooks({ text: looksKey, matches: m }); });
    }, 450);
    return () => { on = false; clearTimeout(t); };
  }, [askLooks, looksKey, typed]);
  const looksLike = !askLooks ? [] : looks?.text === looksKey ? looks.matches : similarCache.get(looksKey) ?? [];
  const suggestion = askLooks
    ? looksLike.map((m) => choices.find((c) => c.vendorId === m.id && c.primary) ?? choices.find((c) => c.vendorId === m.id)).find(Boolean) ?? null
    : null;

  const pick = (c: VenueChoice) => { setErr(null); onChange(venueFill(kind, rec, was, c), "pick", c); };
  const unlink = () => { setErr(null); onChange({ text: { vendor_id: null } }, "pick", null); };
  const choose = (v: string) => {
    if (v === NEW_VENUE) { setAdding(true); setNm(rec.vendor_id ? "" : typed); setErr(null); return; }
    setAdding(false);
    if (v === NO_VENUE) { unlink(); return; }
    const c = choices.find((x) => x.value === v);
    if (c) pick(c);
  };

  // A venue added, or found, through the book: read the book again, then pick it.
  const settle = async (vendorId: string, siteId: string | null, said: string) => {
    const fresh = await reload(true);
    const list = fresh.book ? venueChoices(fresh.book.venues, fresh.book.sites, [vendorId]) : [];
    const c = (siteId ? list.find((x) => x.siteId === siteId) : null)
      ?? list.find((x) => x.vendorId === vendorId && x.primary) ?? list.find((x) => x.vendorId === vendorId) ?? null;
    setBusy(false);
    if (!c) { setErr(`It is in the venue book, but the book did not come back with it${fresh.error ? ` (${fresh.error})` : ""} — pick it from the list.`); return; }
    setAdding(false); setNm(""); setSimilar(null);
    pick(c);
    toast(said);
  };

  const seedFor = async (name: string) => {
    const seed = newVenueSeed(kind, rec, !!rec.vendor_id, name);
    if (typeof seed.address === "string" && seed.lat == null) {
      const g = await geocode(seed.address).catch(() => null);
      if (g) { seed.lat = g.lat; seed.lng = g.lng; }
    }
    return seed;
  };

  const add = async (decision?: ResolveDecision) => {
    const name = nm.trim();
    if (!name || busy) return;
    setBusy(true); setErr(null);
    const r = await resolveVendor(name, { source, extra: await seedFor(name), decision });
    if (r.kind === "similar") { setSimilar(r.candidates); setBusy(false); return; }
    if (r.kind === "error") { setErr(`Couldn't add it — ${r.message}`); setBusy(false); return; }
    await settle(r.id, null, r.kind === "created" ? `${name} is in the venue book — waiting on the owner's approval` : `${name} was already in the venue book — linked to it`);
  };

  const addAsPlace = async (c: VendorMatch) => {
    const name = nm.trim();
    if (!name || busy) return;
    setBusy(true); setErr(null);
    const seed = await seedFor(name);
    const made = await addVendorLocation(c.id, {
      label: name,
      address: typeof seed.address === "string" ? seed.address : null,
      location_text: typeof seed.location_text === "string" ? seed.location_text : null,
      lat: typeof seed.lat === "number" ? seed.lat : null,
      lng: typeof seed.lng === "number" ? seed.lng : null,
    });
    if (!made) { setErr(`Couldn't add “${name}” as a place of ${c.name}.`); setBusy(false); setSimilar(null); return; }
    await settle(c.id, made.id, `“${name}” is a place of ${c.name} now`);
  };

  const failed = book ? null : error;
  const note = venueNote({ kind, now, shown, rec, saved: saved === undefined ? rec.vendor_id : saved, failed, count: choices.length });
  const linked = now.how === "linked" ? now.choice : null;
  const offer = now.how === "matched" && shown === NO_VENUE ? now.choice : null;
  const opt = (c: VenueChoice) => <option key={c.value} value={c.value}>{c.pending ? `${c.label} · pending approval` : c.label}</option>;
  const seedAddress = !rec.vendor_id && kind === "stop" ? (rec.address ?? "").trim() : "";

  return (
    <div className={fieldClass} style={style}>
      <span id={id}>{label}</span>
      <select aria-labelledby={id} className={inputClass} value={book ? shown : ""} disabled={disabled || !book}
        onChange={(e) => choose(e.target.value)}>
        {!book ? (
          <option value="">{error ? "Couldn't load the venue book" : "Loading the venue book…"}</option>
        ) : (
          <>
            <option value={NO_VENUE}>No venue linked</option>
            {now.how === "gone" && <option value={now.value}>{`${now.name ?? "Its venue"} — not in the venue book`}</option>}
            {groups.map((g) => (g.label
              ? <optgroup key={g.key} label={g.label}>{g.choices.map(opt)}</optgroup>
              : g.choices.map(opt)))}
            <option value={NEW_VENUE}>+ Add a venue to the book…</option>
          </>
        )}
      </select>
      {adding && (
        <>
          <div className="vnew-row">
            <input className="ev-input" value={nm} onChange={(e) => setNm(e.target.value)} placeholder="The venue's name" aria-label="The new venue's name"
              maxLength={120} autoFocus onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
            <button type="button" className="adm-btn" onClick={() => add()} disabled={busy || !nm.trim()}>{busy ? "Adding…" : "Add"}</button>
            <button type="button" className="ev-arch-btn" onClick={() => { setAdding(false); setErr(null); }} disabled={busy}>Cancel</button>
          </div>
          <p className="lp-note">{`It goes in the venue book now${seedAddress ? `, at ${seedAddress}` : ""}, waiting on the owner's approval.`}</p>
        </>
      )}
      {err && <p className="lp-ask" role="alert">{err}</p>}
      {suggestion ? (
        // Words that only look like a venue: the look-alike, with the one tap that links it.
        <p className="lp-note">
          {`Not linked to a venue — “${typed}” looks like ${suggestion.label} in the venue book.`}{" "}
          <button type="button" className="rec-link" onClick={() => pick(suggestion)}>Use {suggestion.label}</button>
        </p>
      ) : note && (
        <p className="lp-note">
          {note}
          {offer && <> <button type="button" className="rec-link" onClick={() => pick(offer)}>Link it</button></>}
          {!offer && shown === NO_VENUE && typed && !adding && book && (
            <> <button type="button" className="rec-link" onClick={() => choose(NEW_VENUE)}>Add “{typed}” to the book</button></>
          )}
          {/* The door to the book's approvals only where leaving loses nothing — not from a form mid-edit. */}
          {linked?.pending && !match && canOf(profile).admin && <> <button type="button" className="rec-link" onClick={() => goPlanTab("vendors", { setSection })}>Review it ›</button></>}
        </p>
      )}
      {contact && linked && <VenueContact venue={linked.venue} />}
      {similar && (
        <VendorResolve name={nm.trim()} candidates={similar} busy={busy}
          onUse={(c) => { setSimilar(null); setBusy(true); settle(c.id, null, `Linked to ${c.name}`); }}
          onAddLocation={(c) => addAsPlace(c)}
          onCreateDistinct={() => { setSimilar(null); add({ createDistinct: true }); }}
          onClose={() => setSimilar(null)} />
      )}
    </div>
  );
}
