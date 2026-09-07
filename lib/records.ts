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

export const RECORD_KINDS = ["person", "customer"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const RECORD_LABEL: Record<RecordKind, string> = {
  person: "Crew member",
  customer: "Customer",
};

export const isRecordKind = (v: unknown): v is RecordKind =>
  typeof v === "string" && (RECORD_KINDS as readonly string[]).includes(v);

export type RecordRef = { kind: RecordKind; id: string };

/** The URL form: ?r=customer:9f3a…  One param, readable, and safe to paste into a message. */
export const recordParam = (r: RecordRef): string => `${r.kind}:${r.id}`;

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
