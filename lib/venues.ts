// THE VENUE A STOP OR AN EVENT IS AT (2026-10-05, the form audit, part 4). Ryan: "if relational
// database, generate pick list … when I fill out it's hard to know what's relational."
//
// A stop's or an event's place was asked for six different ways. FieldOpSheet had a "Where" box and
// an "Address" box, and matched the stop's NAME against the vendor book on save — the place was not
// what it matched. The prep hub's editor had the two boxes and no link at all. The event card had a
// vendor <select> AND a "Location / venue" box above each other, and linking wrote the vendor's name
// into the box and ignored the database's answer. Route had the same <select> again, with a "Which
// location?" list that wrote nulls over a stop's address and pin. The calendar's quick-add and the
// event copilot each turned typed words into a vendor on save. Six screens, one fact.
//
// This file is the rule they all share now, and components/VenuePick is the one control:
//
//   · WHAT THE PICK LISTS (venueChoices) — the vendor book's venues: not archived, not a supplier
//     (0298's kind — Sprouts is somewhere we buy, not somewhere we pour), a pending one marked so. A
//     venue with more than one place on file (vendor_locations, 0226) is listed once per place.
//   · IN WHAT ORDER (venueGroups) — by name, and by city when the book holds more than one, the
//     record's own city first.
//   · WHERE IT STARTS (currentVenue) — the venue the record is linked to, at the place its address
//     says; else the one venue its words already spell (its "Where", its name, its address — exactly
//     one, ignoring case and spacing), which a form that saves takes and every screen offers; else
//     nothing.
//   · WHAT A PICK FILLS IN (venueFill) — the place, by lib/pickFill's one rule: a field that is
//     empty, or still holds what the last venue put there, takes the new venue's; a typed one stays.
//     A stop takes the venue's name, place text, address and pin; an event its place line. A pin
//     goes with the address it belongs to, or not at all.
//   · THE LINE UNDER IT (venueNote) — where the venue is and whether it is pinned, whether the stop's
//     address disagrees with it (v_stop_gaps' addr_drift, said before saving instead of after),
//     whether it is waiting on approval, and what an unlinked record means.
//
// Not stops.vendor_location_id: 0315 left that column to Ryan, and the book holds no venue with a
// second place yet. Which place a stop is at is read from its address, as Route always has.
//
// Pure, so scripts/smoke.cjs holds every rule here to the cases that motivated it.

import { follow } from "./pickFill";
import { MARKETS, MARKET_LABEL, isMarket } from "./markets";

export type BookVenue = {
  id: string; name: string; status?: string | null; kind?: string | null; market?: string | null;
  address?: string | null; location_text?: string | null; lat?: number | null; lng?: number | null;
  poc_name?: string | null; poc_phone?: string | null; poc_email?: string | null; service_dates?: string | null;
  archived_at?: string | null;
};
export type BookSite = {
  id: string; vendor_id: string; label: string | null;
  address?: string | null; location_text?: string | null; lat?: number | null; lng?: number | null;
  is_primary?: boolean | null; sort?: number | null; archived_at?: string | null;
};
export type VenuePlace = { address: string | null; location_text: string | null; lat: number | null; lng: number | null };
export type VenueChoice = {
  /** The pick's value: `v:<vendor id>`, or `s:<vendor_locations id>` for one of several places. */
  value: string;
  vendorId: string;
  siteId: string | null;
  /** The venue's own name — what a stop's name follows. */
  name: string;
  /** How the list says it: the name, or "Name — Place" for one of several. */
  label: string;
  /** What an event's place reads at this venue. */
  line: string;
  market: string | null;
  pending: boolean;
  primary: boolean;
  place: VenuePlace;
  venue: BookVenue;
};

/** The pick's value for "not linked to a venue". */
export const NO_VENUE = "";
/** The pick's value while a venue is being added to the book. */
export const NEW_VENUE = "__new";

const txt = (s: unknown): string => (typeof s === "string" ? s.trim() : "");
const key = (s: unknown): string => txt(s).replace(/\s+/g, " ").toLowerCase();
const hasPin = (r: { lat?: number | null; lng?: number | null } | null | undefined): boolean => r?.lat != null && r?.lng != null;
const isMain = (label: unknown) => key(label) === "main" || key(label) === "";

/** A row the venue pick offers: in the book, and a place we pour (or both). */
export const isVenueRow = (v: BookVenue): boolean => !v.archived_at && v.status !== "archived" && v.kind !== "supplier";

/** The first non-empty value of each field, and the pin of the first row that has a whole one. */
function placeOf(...rows: ({ address?: string | null; location_text?: string | null; lat?: number | null; lng?: number | null } | null | undefined)[]): VenuePlace {
  const first = (k: "address" | "location_text") => rows.map((r) => txt(r?.[k])).find(Boolean) || null;
  const pinned = rows.find(hasPin);
  return { address: first("address"), location_text: first("location_text"), lat: pinned?.lat ?? null, lng: pinned?.lng ?? null };
}

/**
 * What the venue pick lists. `keep` names vendors listed even when they would not be — the one a
 * record is already linked to, so a stop filed to a company the book calls a supplier still says
 * where it is instead of showing blank.
 *
 * A venue's places: the ones on file (vendor_locations), plus its own address when no place on file
 * repeats it (0226 copied each vendor's address in as "Main"; one added later may not have been). One
 * place → one line, the venue. Several → a line per place, "Wine Express — Five Forks".
 */
export function venueChoices(book: readonly BookVenue[], sites: readonly BookSite[], keep: readonly (string | null | undefined)[] = []): VenueChoice[] {
  const kept = new Set(keep.filter(Boolean) as string[]);
  const live = sites.filter((s) => !s.archived_at);
  const out: VenueChoice[] = [];
  for (const v of book) {
    // Kept: a supplier the record is filed to. An archived row is never listed — the pick says it is gone.
    if (!isVenueRow(v) && !(kept.has(v.id) && !v.archived_at && v.status !== "archived")) continue;
    const name = txt(v.name) || "Unnamed venue";
    const mine = live.filter((s) => s.vendor_id === v.id);
    const ownAt = txt(v.address) ? "address" : txt(v.location_text) ? "location_text" : null;
    const own = !!ownAt && !mine.some((s) => key(s[ownAt]) === key(v[ownAt]));
    const base = { vendorId: v.id, name, market: v.market ?? null, pending: v.status === "pending", venue: v };
    if (Number(own) + mine.length <= 1) {
      const place = placeOf(v, mine[0]);
      out.push({ ...base, value: `v:${v.id}`, siteId: null, label: name, line: place.location_text || name, primary: true, place });
      continue;
    }
    if (own) {
      const place = placeOf(v);
      out.push({ ...base, value: `v:${v.id}`, siteId: null, label: name, line: place.location_text || name, primary: !mine.some((s) => s.is_primary), place });
    }
    for (const s of mine) {
      const site = isMain(s.label) ? null : txt(s.label);
      const place = { ...placeOf(s), location_text: txt(s.location_text) || site || null };
      out.push({ ...base, value: `s:${s.id}`, siteId: s.id, label: `${name} — ${site ?? "Main"}`, line: txt(s.location_text) || (site ? `${name} — ${site}` : name), primary: !!s.is_primary, place });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

/**
 * The list, grouped by city when the venues are in more than one — the record's own first, then the
 * markets in their order, then anything else, then the rows with no city. One city: one group, no
 * heading (a heading over everything says nothing).
 */
export function venueGroups(choices: readonly VenueChoice[], first?: string | null): { key: string; label: string | null; choices: VenueChoice[] }[] {
  const markets = [...new Set(choices.map((c) => c.market ?? ""))];
  if (markets.length <= 1) return choices.length ? [{ key: markets[0] ?? "", label: null, choices: [...choices] }] : [];
  const rank = (m: string) => (m && m === first ? -1 : (MARKETS as readonly string[]).includes(m) ? (MARKETS as readonly string[]).indexOf(m) : m ? MARKETS.length : MARKETS.length + 1);
  return markets
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((m) => ({ key: m, label: isMarket(m) ? MARKET_LABEL[m] : m || "No city on file", choices: choices.filter((c) => (c.market ?? "") === m) }));
}

/** A record's place as the pick reads it — the row, or the form editing it. */
export type PlaceRec = {
  vendor_id?: string | null; name?: string | null; location_text?: string | null; address?: string | null;
  lat?: number | null; lng?: number | null; market?: string | null;
};

export type VenueNow =
  | { how: "linked"; value: string; choice: VenueChoice }
  | { how: "gone"; value: string; name: string | null }
  | { how: "matched"; value: string; choice: VenueChoice; typed: string }
  | { how: "none"; value: typeof NO_VENUE };

/**
 * Where the pick stands for this record. Linked: its venue, at the place its address (else its place
 * text) says — else the venue's primary place. A link to a venue the pick does not list is "gone",
 * and keeps the venue's name when the book has it. Not linked: the one venue its own words already
 * spell (PersonPick resolves an old typed name the same way) — its "Where" first, then a stop's name,
 * then its address; two or more is no match: a guess is not knowledge.
 */
export function currentVenue(rec: PlaceRec, choices: readonly VenueChoice[], book: readonly BookVenue[] = []): VenueNow {
  if (rec.vendor_id) {
    const mine = choices.filter((c) => c.vendorId === rec.vendor_id);
    if (!mine.length) return { how: "gone", value: `v:${rec.vendor_id}`, name: txt(book.find((v) => v.id === rec.vendor_id)?.name) || null };
    // An event's place is the choice's line ("WineXpress — Downtown"); a stop's, its place words.
    const at = (want: string | null | undefined, of: (c: VenueChoice) => (string | null)[]) => (key(want) ? mine.filter((c) => of(c).some((x) => key(x) === key(want))) : []);
    const byAddress = at(rec.address, (c) => [c.place.address]), byText = at(rec.location_text, (c) => [c.place.location_text, c.line]);
    const choice = mine.length === 1 ? mine[0]
      : byAddress.length === 1 ? byAddress[0]
      : byText.length === 1 ? byText[0]
      : mine.find((c) => c.primary) ?? mine[0];
    return { how: "linked", value: choice.value, choice };
  }
  const spells = (typed: string | null | undefined, k: (c: VenueChoice) => string[]) => {
    const want = key(typed);
    if (!want) return null;
    const hits = choices.filter((c) => k(c).some((x) => key(x) === want));
    return hits.length === 1 ? hits[0] : null;
  };
  const named = (c: VenueChoice) => [c.label, ...(c.siteId ? [] : [c.name])];
  for (const [typed, k] of [
    [rec.location_text, named],
    [rec.name, named],
    [rec.address, (c: VenueChoice) => [c.place.address ?? ""]],
  ] as const) {
    const choice = spells(typed, k);
    if (choice) return { how: "matched", value: choice.value, choice, typed: txt(typed) };
  }
  return { how: "none", value: NO_VENUE };
}

/** The text fields a pick fills, and the pin, apart — a pin is two numbers, the form's fields are words. */
export type VenueFill = {
  text: { vendor_id: string | null; name?: string; location_text?: string; address?: string };
  /** Undefined: leave the pin as it is. Null: the old pin went with the old address (saving geocodes). */
  pin?: { lat: number; lng: number } | null;
};

/**
 * What picking `now` writes onto the record, when its fields were last filled from `was` (null: they
 * were typed, or empty). `now` null unlinks it and changes nothing else: the place stays where it is,
 * it is just not the venue's any more.
 *
 * Every text field follows lib/pickFill — what is still the old venue's (its place text, its name,
 * or its address: the screens that linked it wrote each of those) moves; what was typed stays. The
 * pin belongs to the address: the venue's own when the stop ends up at the venue's address (a saved
 * pin beats a fresh geocode of the same words), cleared when the address moved somewhere the venue
 * has no pin for, untouched when the stop kept its own address.
 */
export function venueFill(kind: "stop" | "event", cur: PlaceRec, was: VenueChoice | null, now: VenueChoice | null): VenueFill {
  if (!now) return { text: { vendor_id: null } };
  const wasPlace = was ? [was.place.location_text, was.line, was.label, was.name, was.place.address] : [];
  if (kind === "event") return { text: { vendor_id: now.vendorId, location_text: follow(cur.location_text, wasPlace, now.line) } };
  const address = follow(cur.address, was ? [was.place.address] : [], now.place.address);
  const out: VenueFill = {
    text: {
      vendor_id: now.vendorId,
      name: follow(cur.name, was ? [was.name, was.label] : [], now.name),
      location_text: follow(cur.location_text, wasPlace, now.place.location_text),
      address,
    },
  };
  if (hasPin(now.place) && key(address) === key(now.place.address)) out.pin = { lat: now.place.lat as number, lng: now.place.lng as number };
  else if (key(address) !== key(cur.address)) out.pin = null;
  return out;
}

/**
 * What a venue added from this record starts with: its city, and — for a stop that is not linked to
 * anything yet — the place typed on it, so the next visit there starts from it. A stop linked to some
 * other venue does not lend that venue's address to the new one.
 */
export function newVenueSeed(kind: "stop" | "event", rec: PlaceRec, linked: boolean, name: string): Record<string, string | number> {
  const seed: Record<string, string | number> = { kind: "venue" };
  if (isMarket(rec.market)) seed.market = rec.market;
  if (linked) return seed;
  const address = kind === "stop" ? txt(rec.address) : "";
  const place = txt(rec.location_text);
  if (address) seed.address = address;
  if (place && key(place) !== key(name) && key(place) !== key(address)) seed.location_text = place;
  if (address && hasPin(rec)) { seed.lat = rec.lat as number; seed.lng = rec.lng as number; }
  return seed;
}

/** The words a record has typed for its place, for "add it to the book" — its "Where", else a stop's name. */
export function typedPlace(kind: "stop" | "event", rec: PlaceRec): string {
  return txt(rec.location_text) || (kind === "stop" ? txt(rec.name) : "");
}

/**
 * The line under the pick. `saved` is the vendor id as the database has it, so a form can say what
 * saving will change; a screen that writes on the pick passes the record's own. Null: nothing to say.
 */
export function venueNote(o: {
  kind: "stop" | "event";
  now: VenueNow;
  /** The value on screen — NO_VENUE for words that spell a venue, offered until the record is linked. */
  shown: string;
  rec: PlaceRec;
  saved: string | null | undefined;
  failed: string | null;
  count: number;
}): string | null {
  const what = o.kind === "stop" ? "stop" : "event";
  if (o.failed) return `Couldn't load the venue book — ${o.failed}. The ${what} keeps the venue it has.`;
  if (o.shown === NEW_VENUE) return null;
  const n = o.now;
  if (n.how === "matched" && o.shown === NO_VENUE) return key(n.typed) === key(n.choice.label) ? `${n.choice.label} is in the venue book.` : `“${n.typed}” is ${n.choice.label} in the venue book.`;
  if (n.how === "none" || o.shown === NO_VENUE) {
    if (!o.count) return `No venues in the book yet — add this one, and the next ${what} there starts from it.`;
    // Nothing typed yet (a new stop on the calendar): nothing to say about it.
    if (!typedPlace(o.kind, o.rec) && !txt(o.rec.address)) return null;
    return o.kind === "stop"
      ? "Not linked to a venue: the place below is typed, and the next visit here will be typed again."
      : "Not linked to a venue: the place below is typed, and the next booking there will be typed again.";
  }
  if (n.how === "gone") return `${n.name ?? "Its venue"} is not in the venue book any more — pick where the ${what} is now.`;
  const c = n.choice;
  const parts: string[] = [];
  if (o.saved !== c.vendorId) parts.push(`Saving files it to ${c.label}.`);
  const at = c.place.address || c.place.location_text;
  const mine = txt(o.rec.address);
  if (o.kind === "stop" && mine && c.place.address && key(mine) !== key(c.place.address)) {
    parts.push(`The stop says ${mine}; ${c.label} is at ${c.place.address}. One of the two is out of date.`);
  } else if (at) {
    parts.push(o.kind === "stop" ? `${at} · ${hasPin(c.place) ? "pinned" : "not pinned yet"}.` : `${at}.`);
  } else {
    parts.push(`No address on file for ${c.label}.`);
  }
  if (c.pending) parts.push("Waiting on the owner's approval.");
  return parts.join(" ");
}
