// A random id in the uuid's shape — its own file, on purpose.
//
// It sat in lib/heartbeat until R15, when an office booking needed one too (components/OfficeOrder: the form's key, so a
// booking sent twice is made once) on a guest page that must not load the crew's heartbeat. R15 first put it beside
// isUuid in lib/uuid — and lib/uuid rides in the shell on every route (components/AppShell → RecordSheet → lib/records
// checks a record link with it), so every route carried this function: +130 bytes gzipped, measured by the weight
// ratchet, which tipped /truck, /events and /agreement over their ceilings. Here, it loads only where an id is made.

/** A random id in the uuid's shape (v4). getRandomValues, not randomUUID: the app's page is not always a secure
 *  context the way a browser counts one, and randomUUID is only offered to those. */
export function mintId(fill: (b: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const b = fill(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
