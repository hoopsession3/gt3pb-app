// RECORDS — what the app considers a THING, and how to address one.
//
// The problem this exists to fix, stated from the survey rather than from a feeling: there is no
// route or URL anywhere in this app that addresses a single record. `?s=<section>` is the deepest
// link that exists. Everything follows from that. Of thirteen core entities exactly ONE — tasks —
// has a detail view you can open from anywhere; three have a defensible home that nothing links to;
// eight have none; and shop_orders has no interface at all, so a customer can place an order that
// nobody on the crew can look at.
//
// The symptom Ryan keeps hitting is the same every time: a name is on the screen and tapping it does
// nothing. Fifteen of those were catalogued — the customer on an order, the person in the org chart,
// the account on a delivery, the vendor on an expense — and each one is only fixable one screen at a
// time until a record has an ADDRESS.
//
// So: a record is a (kind, id) pair. It can be opened from anywhere, it survives a reload, and it
// can be pasted to somebody else. The pattern is not invented here — TaskSheet already proved it
// with a provider and openTask(id, source). This generalises that to every kind of thing.
//
// Adding a kind is two lines here plus one detail component. That is the point: the next entity
// should not need another architecture conversation.

export const RECORD_KINDS = ["person", "customer", "shop_order", "event", "stop"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const RECORD_LABEL: Record<RecordKind, string> = {
  person: "Crew member",
  customer: "Customer",
  // Added second, and it took two lines here plus one component — which was the claim this file
  // made when it was written. shop_orders was the entity with no interface AT ALL: a customer could
  // pay and nobody on the crew could look at the order.
  shop_order: "Shop order",
  // Third, and the claim held again: two lines here plus one component. An event is touched by nine
  // tables and 24 screens and had no record at all — the worst scattering the audit found.
  event: "Event",
  // Fourth. Sixteen tables reference a stop — more than the event — and the audit's note about
  // "three editors that disagree about which owns its identity" turned out to be four.
  stop: "Truck stop",
};

export const isRecordKind = (v: unknown): v is RecordKind =>
  typeof v === "string" && (RECORD_KINDS as readonly string[]).includes(v);

export type RecordRef = { kind: RecordKind; id: string };

/** The URL form: ?r=customer:9f3a…  One param, readable, and safe to paste into a message. */
export const recordParam = (r: RecordRef): string => `${r.kind}:${r.id}`;

/**
 * WHICH ALERTS NAME A RECORD.
 *
 * The 0174 alert contract has carried `subject_id` — the row an alert is about — since long before
 * anything could open a row. So an alert already knew exactly which order it meant, and "Open →"
 * dropped you at /crew: the top of a six-thousand-line page. /api/shop/checkout's failure alert
 * literally reads "It's paid and queued — submit it by hand", naming a queue that did not exist and
 * pointing nowhere near it.
 *
 * A kind in this map means: this alert is ABOUT one record, and Open should show you that record.
 * Anything not listed keeps the section routing in alertDest, which is right for alerts that are
 * about a screen rather than a row.
 */
export const ALERT_KIND_RECORD: Record<string, RecordKind> = {
  shop_order_new: "shop_order",
  fulfillment: "shop_order",
};

/** The ref an alert points at, or null if it points at a screen instead of a row. */
export function recordForAlert(kind: string | null | undefined, subjectId: string | null | undefined): RecordRef | null {
  const k = kind ? ALERT_KIND_RECORD[kind] : undefined;
  if (!k || !subjectId) return null;
  // Reuse the same strict parse rather than a second, looser one — an alert with a malformed
  // subject must fall through to the section route, not open an empty sheet.
  return parseRecordParam(`${k}:${subjectId}`);
}

/**
 * Parse the ?r= parameter. Deliberately strict: an unknown kind, a missing id, or anything that is
 * not shaped like an id returns null rather than opening an empty sheet. A link that half-works is
 * worse than one that plainly does not — that is the lesson from the goal link in TaskSheet, which
 * has been pointing at `?section=goals` (wrong parameter name, and a section that does not exist)
 * and silently landing people on My Day.
 */
export function parseRecordParam(v: string | null | undefined): RecordRef | null {
  if (!v) return null;
  const i = v.indexOf(":");
  if (i <= 0) return null;
  const kind = v.slice(0, i);
  const id = v.slice(i + 1).trim();
  if (!isRecordKind(kind) || !id) return null;
  // ids in this app are uuids; anything else is a malformed or hand-edited link
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return { kind, id };
}
