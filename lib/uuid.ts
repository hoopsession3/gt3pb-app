// THE uuid test — one home.
//
// Every id this app makes is a Postgres uuid, and by 2026-10-04 four files carried their own copy of
// this pattern: lib/tenantScope (a mistyped tenant env var), lib/records (a hand-edited record link),
// and two written that morning for alert subjects (alerts.subject_id is a uuid column, and a key that
// is not one makes the database refuse the whole alert — see lib/alertSubject). Four copies of a
// regex is four chances for one of them to be wrong; scripts/smoke.cjs now fails if the pattern
// appears anywhere else.
//
// Its own file, and tiny, on purpose: the browser's alert door (lib/clientAlerts) needs it, and
// importing it from a larger module put 1 KB onto /driver (measured by the weight ratchet).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a value is a canonical, hyphenated uuid string. */
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
