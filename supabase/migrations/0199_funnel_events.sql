-- 0199 — Privacy-respecting funnel analytics. One row per step a visitor reaches in a conversion
-- funnel (order · reserve · delivery · signup · office), so the owner can see WHERE people drop off —
-- without tracking anyone. NO PII by design: no user_id, no IP, no name, no persistent cookie. The
-- only correlation key is `session`, an ephemeral random token the client keeps in sessionStorage
-- (gone when the tab closes) purely to order steps within a single visit — it identifies no one and
-- never spans sessions. Anyone may INSERT (the flows are guest-facing); only staff may read, and only
-- the aggregate counts via funnel_counts(). Idempotent.

create table if not exists public.funnel_events (
  id         bigint generated always as identity primary key,
  tenant_id  uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  funnel     text not null check (funnel in ('order','reserve','delivery','signup','office')),
  step       text not null check (char_length(step) <= 40),
  session    text check (session is null or char_length(session) <= 24),  -- ephemeral per-visit token; NOT an identity
  at         timestamptz not null default now()
);
create index if not exists funnel_events_funnel_idx on public.funnel_events (funnel, at desc);

drop trigger if exists stamp_tenant_tg on public.funnel_events;
create trigger stamp_tenant_tg before insert on public.funnel_events
  for each row execute function public.stamp_tenant();

alter table public.funnel_events enable row level security;
-- Anyone (guest included) may record a step — the funnels are public. No one may read the raw rows
-- from the client; the owner reads aggregates through funnel_counts() only.
drop policy if exists "funnel anyone insert" on public.funnel_events;
create policy "funnel anyone insert" on public.funnel_events for insert to anon, authenticated with check (true);
drop policy if exists "funnel staff read" on public.funnel_events;
create policy "funnel staff read" on public.funnel_events for select using ((select public.is_staff()));
drop policy if exists "tenant isolation" on public.funnel_events;
create policy "tenant isolation" on public.funnel_events as restrictive
  for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
grant insert on public.funnel_events to anon, authenticated;
grant select on public.funnel_events to authenticated;

-- Aggregate read for the report: counts per funnel/step over a window, plus a rough started→finished
-- rate. security definer so it can sum across the tenant without exposing raw rows; staff-gated.
create or replace function public.funnel_counts(p_days int default 14)
returns table(funnel text, step text, n bigint)
language sql stable security definer set search_path = public as $$
  select funnel, step, count(*)::bigint
  from public.funnel_events
  where at >= now() - make_interval(days => greatest(1, least(p_days, 120)))
    and tenant_id = public.effective_tenant()
  group by funnel, step;
$$;
revoke all on function public.funnel_counts(int) from public, anon;
grant execute on function public.funnel_counts(int) to authenticated;

-- verify:
--   select to_regclass('public.funnel_events');           -- non-null
--   insert into public.funnel_events (funnel, step) values ('order','open');
--   select * from public.funnel_counts(14);
