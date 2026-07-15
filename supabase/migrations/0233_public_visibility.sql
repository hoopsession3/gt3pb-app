-- 0233 — public visibility, decided in ONE place (the P0 from the cohesion audit: /events served
-- internal admin/ops events AND private_booking gigs to signed-out guests — only archived_at was
-- filtered client-side).
--
-- The rule, written once as a STORED GENERATED column (mirror-proof: the 0222 events→field_ops
-- mirrors upsert explicit column lists, so a generated column can never be forgotten or drift —
-- each table computes it from its own row):
--   public  =  not archived
--          AND it's a customer occasion: any stop, or an event whose category is 'event'
--              (admin/ops are internal) and whose archetype isn't a private booking.
--
-- Enforced at the DOOR: the 0001 "public read events" policy was using(true). Guests and members
-- now see only is_public rows; staff see everything. Server routes (agents, outlook, webhook) use
-- the service role and are untouched.

-- ── the rule, on events ───────────────────────────────────────────────────────────────────────────
alter table public.events add column if not exists is_public boolean
  generated always as (
    archived_at is null
    and coalesce(category, 'event') = 'event'
    and (archetype is null or archetype <> 'private_booking')
  ) stored;
create index if not exists events_public_idx on public.events (day) where is_public;

-- ── the same rule, on the field_ops spine (kind-aware; stops are always customer-facing) ──────────
alter table public.field_ops add column if not exists is_public boolean
  generated always as (
    archived_at is null
    and (
      kind = 'stop'
      or (coalesce(category, 'event') = 'event'
          and (archetype is null or archetype <> 'private_booking'))
    )
  ) stored;

-- ── the door — on BOTH tables (panel catch: 0222 shipped field_ops with using(true) + anon grant,
--    so the MIRROR re-leaked every row this migration hides on events; one rule, both doors) ───────
drop policy if exists "public read events" on public.events;
create policy "public read events" on public.events for select
  using (is_public or (select public.is_staff()));

drop policy if exists "field ops read" on public.field_ops;
create policy "field ops read" on public.field_ops for select
  using (is_public or (select public.is_staff()));
-- (field_ops_drift() is SECURITY DEFINER — the nightly anon drift probe is unaffected.)

-- verify:
--   anon probe: GET /rest/v1/events?select=id,category,archetype&category=neq.event  -- 0 rows
--   anon probe: GET /rest/v1/field_ops?select=id&is_public=eq.false                  -- 0 rows
--   select count(*) from events where is_public and (category <> 'event' or archetype = 'private_booking');  -- 0
--   select count(*) from field_ops fo join events e on e.id = fo.id where fo.is_public <> e.is_public;  -- 0
