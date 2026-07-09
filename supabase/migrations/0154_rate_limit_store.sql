-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0154 · SHARED-STORE RATE LIMITING  (Layer 1, closes the delivery waitlist gap)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- app/api/delivery/waitlist/route.ts capped abuse with a module-global in-memory counter — on
-- Vercel serverless each lambda instance gets its own counter and cold starts reset it, so a "30/min"
-- cap was actually "30/min per warm instance," not a real global limit. Fixed with a tiny Postgres-
-- backed fixed-window counter any route can share. Server-only (service role); nothing client-facing.

create table if not exists public.rate_limit_hits (
  bucket      text not null,          -- e.g. 'delivery-waitlist'
  window_start timestamptz not null,  -- floor(now() to the window size) — the fixed window's start
  count       int not null default 0,
  primary key (bucket, window_start)
);
-- Old windows accumulate forever without this — a bucket queried maybe once a minute doesn't need
-- history older than a few windows back.
create index if not exists rate_limit_hits_window_idx on public.rate_limit_hits(window_start);
-- No anon/authenticated grant exists on this table at all (only the SECURITY DEFINER function
-- below touches it, and that's revoked from those roles too) — RLS is defense-in-depth, matching
-- every other table in this schema, not a behavior change.
alter table public.rate_limit_hits enable row level security;

-- Atomic increment-and-check: bumps the current window's count and returns whether the caller is
-- still under the cap. One round trip, race-safe (the upsert's ON CONFLICT DO UPDATE serializes
-- concurrent hits to the same window at the row level).
create or replace function public.rate_limit_hit(p_bucket text, p_window_ms int, p_max int)
returns boolean language plpgsql security definer set search_path = public as $$
declare w timestamptz; n int;
begin
  w := to_timestamp(floor(extract(epoch from now()) * 1000 / p_window_ms) * p_window_ms / 1000.0);
  insert into public.rate_limit_hits (bucket, window_start, count) values (p_bucket, w, 1)
    on conflict (bucket, window_start) do update set count = rate_limit_hits.count + 1
    returning count into n;
  -- Best-effort cleanup of stale windows for this bucket — cheap (indexed), runs on ~1/20 of calls
  -- so it doesn't add latency to every request.
  if random() < 0.05 then
    delete from public.rate_limit_hits where bucket = p_bucket and window_start < now() - interval '1 hour';
  end if;
  return n <= p_max;
end $$;
revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;

-- verify:
--   select proname from pg_proc where proname = 'rate_limit_hit';  -- 1 row
--   select public.rate_limit_hit('smoke-test', 60000, 5);  -- true (first hit in the window)
