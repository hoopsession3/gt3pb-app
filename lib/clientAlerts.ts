import { supabase } from "./supabase";
import type { AlertCategory, AlertSeverity } from "./alertKinds";

// THE client-side alert producer. Components used to hand-build raw `alerts` inserts (six different
// payload shapes across DropOps/DeliveryOps/DriverRun/Studio/StrategyCollab/admin) — and none of
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
}): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("alerts").insert({
      severity: a.severity,
      category: a.category,
      title: a.title.slice(0, 180),
      body: (a.body ?? "").slice(0, 300) || null,
      link: a.link ?? "/admin",
      target_user_id: a.targetUserId ?? null,
    });
  } catch { /* best-effort */ }
}
