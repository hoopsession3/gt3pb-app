import { supabase } from "./supabase";
import type { AlertCategory, AlertSeverity } from "./alertKinds";
import { isUuid } from "./uuid";

// THE client-side alert producer. Components used to hand-build raw `alerts` inserts (six different
// payload shapes across DropOps/DeliveryOps/DriverRun/Studio/StrategyCollab/crew) — and none of
// them fanned out to push/Teams, because fan-out lived only in the server helper's direct invoke.
// Fan-out is now a database trigger on the alerts INSERT itself (migration 0157), so one insert —
// from anywhere — is the whole job. Best-effort by contract: an operational write must never fail
// because alerting did.
export async function raiseAlertClient(a: {
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  body?: string;
  link?: string;
  targetUserId?: string | null;
  kind?: string;
  subjectId?: string;
  createdBy?: string | null;
}): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("alerts").insert({
      severity: a.severity,
      category: a.category,
      title: a.title.slice(0, 180),
      body: (a.body ?? "").slice(0, 300) || null,
      link: a.link ?? "/crew",
      target_user_id: a.targetUserId ?? null,
      kind: a.kind ?? null,
      // alerts.subject_id is a uuid: anything else makes the database refuse the whole row, and this
      // helper swallows failures by contract — the alert would vanish. Every browser producer passes a
      // row id today; one that does not loses its dedupe key here, not its alert. (The server door,
      // lib/serverAlerts, can make a stable uuid from an external key; the browser has no SHA-1 to
      // do that synchronously, and has no producer that needs it.)
      subject_id: isUuid(a.subjectId) ? a.subjectId : null,
      created_by: a.createdBy ?? null,
    });
  } catch { /* best-effort */ }
}
