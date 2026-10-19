// WHAT THE APP'S SERVER ASKS THE DATABASE IS STILL THERE (R24, 2026-10-18 — the 10/10 audit, database F8 and F6,
// operations F11 and F19). /api/health asks (0430 ops_alive) and the half-hourly production check fails on the answer:
// whether cron_watch — the job that watches the others — still finishes, whether each job below is there and on, and
// whether each push webhook below is on its table and switched on. Names go to the database; only counts come back.
//
// CRON_JOBS — the jobs the database runs on a schedule, each with the migration that made it (the first of its life: a
// later one that unschedules and schedules it again keeps it). Counted only once that migration is in the ledger, so one
// not yet pasted is not "missing". scripts/r24.test.mjs reads every migration's cron.schedule and cron.unschedule, in
// order, and fails when this list and theirs differ: a migration that makes a job adds it here, one that ends a job takes
// it out.
export const CRON_JOBS: ReadonlyArray<readonly [job: string, madeBy: string]> = [
  ["alert-autoexpire", "0258_alert_autoexpire"],
  ["alert-stale-orders", "0120_stale_order_alert"],
  ["archive-stale-stops", "0228_ops_hygiene"],
  ["brew-due-alerts", "0084_brew_alert_ladder"],
  ["checkout-claims-sweep", "0439_a_checkouts_key_is_kept_as_long_as_it_can_matter"],
  ["cron-watch", "0419_a_push_is_sent_once_for_what_happened_and_a_limit_counts_what_it_lets_in"],
  ["device-tests-close", "0374_ring_this_phone"],
  ["erasure-followups-watch", "0404_an_account_is_erased_before_anything_outside_it"],
  ["escalate-criticals", "0373_a_critical_nobody_picks_up_rings_the_owners_again"],
  ["fire-cup-reminders", "0394_remind_me_when_cup_orders_open"],
  ["founder-digest", "0208_founder_digest"],
  ["goal-checkin", "0263_exec_rhythm"],
  ["heartbeat-watchdog", "0255_ops_heartbeat_watchdog"],
  ["message-sent-sweep", "0429_a_text_is_sent_once_for_what_happened"],
  ["monday-audit", "0264_gt3_command_registry"],
  ["monday-audit-reminder", "0405_a_weeks_audit_is_a_record"],
  ["office-generation", "0356_the_weekly_run_comes_from_the_program"],
  ["pass-watchdog", "0376_nobody_on_the_pass_during_service_is_an_alert"],
  ["prune-device-heartbeats", "0375_a_device_on_the_pass_checks_in_every_minute"],
  ["purge-webhook-events", "0230_webhook_inbox"],
  ["push-device-sweep", "0428_the_studio_room_is_its_editors_and_a_phone_nobody_keeps_is_let_go"],
  ["push-sent-sweep", "0419_a_push_is_sent_once_for_what_happened_and_a_limit_counts_what_it_lets_in"],
  ["rate-limit-sweep", "0419_a_push_is_sent_once_for_what_happened_and_a_limit_counts_what_it_lets_in"],
  ["reap-stale-pending-subs", "0421_files_are_their_owners_and_a_lost_answer_is_kept"],
  ["reclaim-reserve-holds", "0017_cron_holds"],
  ["release-pack-notices", "0399_a_pack_hears_about_its_day"],
  ["reset-daily-86s", "0130_86_lifecycle"],
  ["shop-order-stall-watchdog", "0329_a_paid_order_can_stop_moving_and_nobody_hears"],
  ["stop-recap-asks", "0228_ops_hygiene"],
  ["task-due-alerts", "0104_task_due_alerts"],
  ["tidy-acked-alerts", "0113_alert_retention"],
  ["tidy-audit-log", "0117_audit_retention"],
  ["tidy-stale-content", "0074_content_lifecycle"],
  ["webhook-watch", "0422_a_booking_once_a_stuck_event_said_the_tenant_asked_once"],
];

// PUSH_HOOKS — the triggers that carry an order, a booking, a sign-up, a task, a go-live or an alert to the push function
// ("table.trigger"). Ten were made in the dashboard as Database Webhooks and are in no migration (database F6), three by
// migrations that copy the alerts one (0373/0380, 0394, 0399). scripts/r24.test.mjs holds the list to the security
// snapshot: each is in production's, on — and every push_ trigger there that no migration makes is named here, so a webhook
// added in the dashboard is added here too.
export const PUSH_HOOKS: readonly string[] = [
  "alerts.alerts_push_escalation",
  "alerts.push_alerts_insert",
  "booking_requests.push_bookings_insert",
  "cup_reminders.cup_reminders_push",
  "delivery_orders.push_delivery_orders_insert",
  "drop_orders.push_drop_orders_insert",
  "event_tasks.push_event_tasks_update",
  "live_status.push_live_status_update",
  "orders.push_orders_insert",
  "orders.push_orders_update",
  "pack_notices.pack_notices_push",
  "profiles.push_profiles_insert",
  "subscriptions.push_subs_update",
];
