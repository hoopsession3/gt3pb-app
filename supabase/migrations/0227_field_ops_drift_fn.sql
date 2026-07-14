-- 0227_field_ops_drift_fn.sql — the nightly soak drift check as a callable RPC, so the automated
-- nightly watcher (a fresh scheduled session with no dashboard access) can run it over PostgREST.
-- Returns ONLY four counts (no rows, no PII; events/stops are world-readable anyway) — safe for
-- anon execute. The SQL is the 0224 header's drift query VERBATIM; all zeros = soak green.
create or replace function public.field_ops_drift()
returns table (chk text, n bigint)
language sql stable security definer set search_path = public as $$
  select 'field_ops missing'::text as chk, count(*) as n from (
    select id from events union all select id from stops
    except select id from field_ops) x
  union all
  select 'spine drift', count(*) from event_tasks
    where coalesce(event_id, stop_id) is not null and field_op_id is distinct from coalesce(event_id, stop_id)
  union all
  select 'orders drift', count(*) from orders
    where coalesce(event_id, stop_id) is not null and field_op_id is distinct from coalesce(event_id, stop_id)
  union all
  select 'stale spine (unlinked rows)', count(*) from event_tasks
    where field_op_id is not null and event_id is null and stop_id is null
$$;
revoke all on function public.field_ops_drift() from public;
grant execute on function public.field_ops_drift() to anon, authenticated;
