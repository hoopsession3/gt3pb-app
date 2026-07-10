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
}): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin.from("alerts").insert({
      severity: a.severity,
      category: a.category,
      title: a.title.slice(0, 180),
      body: a.body.slice(0, 300),
      link: a.link ?? "/admin",
      target_user_id: a.targetUserId ?? null,
    });
  } catch { /* best effort — alerting must never break a money/order write */ }
}
