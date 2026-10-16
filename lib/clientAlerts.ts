import { supabase } from "./supabase";
import type { AlertCategory, AlertSeverity } from "./alertKinds";
import { isUuid } from "./uuid";
import { apiUrl } from "./native";
import { errorMessage } from "./errorMessage";

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
    const { error } = await supabase.from("alerts").insert({
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
    if (error) alertNotWritten(a.title, error.message);
  } catch (e) { alertNotWritten(a.title, errorMessage(e, 400)); }
}

// AN ALERT THE DATABASE WOULD NOT TAKE IS SAID (R10b, 2026-10-16 — the 10/10 audit). The insert's answer was never read,
// so a refused alert from a crew phone vanished. It goes to the app's own error report now (App health, deduped and
// capped there), never in the way of the work that raised it.
function alertNotWritten(title: string, why: string): void {
  try {
    if (typeof window === "undefined") return;
    const body = JSON.stringify({ message: `An alert could not be written: ${title}`.slice(0, 400), stack: why.slice(0, 400),
      url: window.location.pathname.slice(0, 300), ua: navigator.userAgent.slice(0, 200), fatal: false });
    void fetch(apiUrl("/api/errors/report"), { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch { /* never throw from here */ }
}
