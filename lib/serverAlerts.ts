import { supabaseAdmin } from "./supabaseAdmin";
import type { AlertCategory, AlertSeverity } from "./alertKinds";

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
  try {
    await supabaseAdmin.from("alerts").insert({
      severity: a.severity,
      category: a.category,
      title: a.title.slice(0, 180),
      body: a.body.slice(0, 300),
      link: a.link ?? "/crew",
      target_user_id: a.targetUserId ?? null,
      kind: a.kind ?? null,
      subject_id: a.subjectId ?? null,
    });
  } catch { /* best effort — alerting must never break a money/order write */ }
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
// Returns whether it actually raised, so a caller can tell "already open" from "written".
export async function raiseAlertOnce(
  a: Parameters<typeof raiseAlert>[0] & { kind: string; subjectId: string },
): Promise<boolean> {
  if (!supabaseAdmin) return false;
  try {
    const { data, error } = await supabaseAdmin.from("alerts")
      .select("id").eq("kind", a.kind).eq("subject_id", a.subjectId).is("ack_at", null).limit(1);
    // A FAILED READ IS NOT AN EMPTY LIST. If we cannot tell whether one is already open, raise it:
    // a duplicate chargeback alert is a nuisance, a missing one is a deadline nobody saw.
    if (!error && data && data.length > 0) return false;
  } catch { /* fall through and raise */ }
  await raiseAlert(a);
  return true;
}
