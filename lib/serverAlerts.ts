import { supabaseAdmin } from "./supabaseAdmin";
import type { AlertCategory, AlertSeverity } from "./alertKinds";
import { alertSubject } from "./alertSubject";
import { errorMessage } from "./errorMessage";

// Raise an in-app alert from a server route. The INSERT is the whole contract: the
// alerts_push_fanout database trigger (migration 0157) delivers web push + Teams for every alert
// row, no matter who wrote it — server routes here, client components (lib/clientAlerts.ts), or
// the pg_cron SQL producers (brew ladder, task-due, stale-order). The direct push invoke that used
// to live here was one half of a split-brain delivery contract (the other half assumed a webhook
// that didn't exist); do NOT reintroduce it — that recreates the double-fire.
// BEST-EFFORT by contract — a money/order write must NEVER fail because alerting did.
export async function raiseAlert(a: {
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  body: string;
  link?: string;
  targetUserId?: string | null;
  kind?: string;        // 0174 action contract — names the inline handler
  subjectId?: string;   // the row the kind acts on (polymorphic by kind)
}): Promise<void> {
  if (!supabaseAdmin) return;
  const row = {
    severity: a.severity,
    category: a.category,
    title: a.title.slice(0, 180),
    // 600 (R10b): a paid order's alert lists its drinks, and 300 cut the list off. The lock screen never shows it.
    body: a.body.slice(0, 600),
    link: a.link ?? "/crew",
    target_user_id: a.targetUserId ?? null,
    kind: a.kind ?? null,
    // The column is a uuid. A key that is not one (a Square dispute id, a business day) used to be
    // written as-is, refused by the database, and swallowed by the catch below — the alert never
    // existed. lib/alertSubject makes it a stable uuid instead; a uuid passes through untouched.
    subject_id: alertSubject(a.kind, a.subjectId),
  };
  // THE ANSWER IS READ (R10b, 2026-10-16 — the 10/10 audit). supabase-js answers a refused insert; it does not throw.
  // The answer was never read, so the alerts that matter most — the ones raised because the database was failing (a
  // paid order that would not save) — vanished while the customer was told "we've alerted the crew". Asked twice; still
  // refused, it is said in the platform's log and, for a critical, sent another way (alertNotWritten).
  let why = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { error } = await supabaseAdmin.from("alerts").insert(row);
      if (!error) return;
      why = error.message || String(error.code ?? "refused");
    } catch (e) {
      why = errorMessage(e, 200);
    }
  }
  await alertNotWritten(a, why);
}

/** An alert the database would not take: one line in the platform's log always, and a critical emailed straight to
 *  ALERT_FALLBACK_EMAIL when it is set — not through the database that just refused it. True when it went out that way.
 *  Never throws. */
async function alertNotWritten(a: { severity: AlertSeverity; category: AlertCategory; title: string; body: string; kind?: string }, why: string): Promise<boolean> {
  console.error(`[alert-not-written] ${JSON.stringify({ severity: a.severity, category: a.category, kind: a.kind ?? null, title: a.title.slice(0, 180), why: why.slice(0, 200) })}`);
  const to = process.env.ALERT_FALLBACK_EMAIL, key = process.env.RESEND_API_KEY, from = process.env.NOTIFY_FROM_EMAIL;
  if (a.severity !== "critical" || !to || !key || !from) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [to], subject: `Critical — ${a.title}`.slice(0, 200),
        text: `${a.body}\n\nThis alert could not be written to the app (the database refused it: ${why.slice(0, 160)}). Open the crew app once it is back, and check Square.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch {
    return false;   // the log line above stands
  }
}

// RAISE IT ONCE, WHILE IT IS STILL OPEN.
//
// raiseAlert above is a plain insert, which is right for something that genuinely happened once. It
// is wrong for a producer that can run again on the same subject — the Square webhook re-runs its
// body when a prior attempt died mid-processing (its own comment says so), and 0327 exists because
// twenty copies of one condition taught an owner to scroll past the word "critical".
//
// This is the contract 0329's watchdog enforces in plpgsql: at most ONE unacknowledged alert per
// (kind, subject). After it is acknowledged a new one may open — somebody who cleared it is asking
// to be told again. The rule lives twice on purpose, here and in SQL, because the cron producers
// cannot call TypeScript and this cannot call a cron function. Naming that is the difference between
// a known pair and the accidental drift this repo keeps finding in pairs of files.
//
// THE TABLE HOLDS IT NOW, FOR EVERY PRODUCER (2026-10-11, 0372). A plain raiseAlert of a kind and
// subject that is already open, for the same person or the team, folds into the open line in the
// database — counted, its words refreshed, no second push. This still asks first: a webhook's re-run
// of the same event is not a second raise, so it is not counted as one.
//
// Returns whether it actually raised, so a caller can tell "already open" from "written".
export async function raiseAlertOnce(
  a: Parameters<typeof raiseAlert>[0] & { kind: string; subjectId: string },
): Promise<boolean> {
  if (!supabaseAdmin) return false;
  try {
    // The SAME subject raiseAlert will write — asked about any other way, a key that is not a uuid
    // makes this read fail every time, and a failed read raises (below): a new alert on every call.
    // An empty key has nothing to dedupe on, so it is raised, like a read that could not answer.
    const subject = alertSubject(a.kind, a.subjectId);
    if (subject) {
      const { data, error } = await supabaseAdmin.from("alerts")
        .select("id").eq("kind", a.kind).eq("subject_id", subject).is("ack_at", null).limit(1);
      // A FAILED READ IS NOT AN EMPTY LIST. If we cannot tell whether one is already open, raise it:
      // a duplicate chargeback alert is a nuisance, a missing one is a deadline nobody saw.
      if (!error && data && data.length > 0) return false;
    }
  } catch { /* fall through and raise */ }
  await raiseAlert(a);
  return true;
}
