import { createHash } from "node:crypto";
import { isUuid } from "./uuid";

// AN ALERT'S SUBJECT, AS THE DATABASE WILL TAKE IT.
//
// alerts.subject_id is a uuid (0174), and it is half of the key every "raise it once" rule turns on
// (kind, subject). Some subjects are not rows of ours: a Square dispute is named by Square, a storm
// by the day it happened on. Passed through raw, the insert is refused — and raiseAlert is
// best-effort by contract, so the refusal is silent and the alert never exists. Measured, not
// supposed: scripts/db.alertnoise.test.mjs shows the database refusing both keys.
//
// So a key that is not already a uuid becomes a NAME-BASED one (RFC 4122 version 5): the same kind
// and key give the same uuid on every call, on every instance, which is exactly what the dedupe
// needs; a different kind with the same key gives a different one, so two producers cannot collide
// on a shared external id. A key that IS a uuid — a row of ours — passes through untouched, so
// every inline handler that loads its subject by id (AlertAction) keeps working.
//
// Server-only (node:crypto). The browser door, lib/clientAlerts, has no producer with an external
// key and refuses to send one rather than lose the alert.

/** This app's namespace for alert subjects. Fixed for ever: changing it re-keys every open alert. */
export const ALERT_SUBJECT_NS = "18d33fe8-cedf-47aa-9802-841e2c9b6593";

/** RFC 4122 §4.3, SHA-1. Exported so the smoke suite can hold it to the RFC's own test vector. */
export function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const b = Buffer.from(createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest().subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;   // version 5
  b[8] = (b[8] & 0x3f) | 0x80;   // RFC 4122 variant
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The subject_id to write for (kind, key): the key itself when it is a uuid, a stable uuid when it
 *  is not, null when there is none. Pure. */
export function alertSubject(kind: string | null | undefined, key: string | null | undefined): string | null {
  const k = (key ?? "").trim();
  if (!k) return null;
  if (isUuid(k)) return k;
  return uuidV5(`${kind ?? ""}:${k}`, ALERT_SUBJECT_NS);
}
