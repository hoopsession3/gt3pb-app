-- 0230 — the webhook INBOX + terminal-state guard. Two proven gaps:
--   1. Square retries/replays re-run the whole webhook body (alerts re-fire, mirrors re-write) —
--      nothing records "we already handled event X". Canonical fix: a webhook_events inbox keyed by
--      the provider's event id. The route inserts FIRST; a duplicate means "skip, already handled"
--      (or "retry", if the first attempt died before processed_at was stamped).
--   2. A STALE subscription event can overwrite a terminal state: the route guards active-revival,
--      but a delayed 'paused' update happily overwrites 'canceled' (probe-proven). The member's
--      cancel is their intent — it must be terminal at the DATABASE, not just in one code path.
--
-- The route change (same ship) does insert-first + processed_at stamping; this migration makes the
-- data model enforce both invariants even if some future code path forgets.

-- ── 1. the inbox ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.webhook_events (
  id           text primary key,                     -- the provider's event id (Square event_id)
  provider     text not null default 'square',
  type         text,
  payload      jsonb,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,                          -- null = accepted but not (yet) fully processed
  error        text
);
alter table public.webhook_events enable row level security;
-- service-role only: no client policies, no grants. The route (service key) and cron touch it.

-- 30-day retention, same pattern as alert retention (0113): the inbox is a dedupe ledger, not an archive.
create or replace function public.purge_webhook_events() returns void
language sql security definer set search_path = public as $$
  delete from public.webhook_events where received_at < now() - interval '30 days';
$$;
do $$ begin perform cron.schedule('purge-webhook-events', '43 7 * * *', 'select public.purge_webhook_events()'); exception when others then null; end $$;

-- ── 2. terminal states live in the schema ─────────────────────────────────────────────────────────
-- 'canceled' is terminal: nothing overwrites it (mirror semantics — silently keep, never error, so a
-- stale Square retry gets its 200 and stops retrying). 'past_due' only clears on a real payment
-- ('active') or a cancel.
create or replace function public.subscriptions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'canceled' and new.status is distinct from 'canceled' then
    new.status := old.status;
  elsif old.status = 'past_due' and new.status not in ('active', 'canceled', 'past_due') then
    new.status := old.status;
  end if;
  return new;
end $$;
drop trigger if exists trg_subscriptions_guard on public.subscriptions;
create trigger trg_subscriptions_guard before update on public.subscriptions
  for each row execute function public.subscriptions_guard();

-- verify:
--   select jobname from cron.job where jobname = 'purge-webhook-events';  -- 1 row
--   update a 'canceled' subscription to 'paused' -> status stays 'canceled'.
