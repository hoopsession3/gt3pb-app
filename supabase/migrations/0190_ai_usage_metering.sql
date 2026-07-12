-- 0190 — AI usage metering
-- Persist one row per Claude call so the owner can SEE spend (until now token counts were only
-- printed to server logs — invisible, un-summed, un-priced). callClaude logs here fire-and-forget via
-- the service role. Staff can read; nobody writes from the client. Cost is computed at log time from
-- lib/aiPricing so historical rows keep the price that was in effect when they ran.
--   • agent            — which copilot made the call (label threaded through callClaude)
--   • model            — the API model id (drives which pricing tier applied)
--   • *_tokens         — input / output / cache-write / cache-read, straight from the API usage block
--   • cost_cents       — computed dollars×100 (float; sub-cent precision preserved for summing)

create table if not exists public.ai_usage (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  agent              text not null default 'unknown',
  model              text not null default '',
  input_tokens       int not null default 0,
  output_tokens      int not null default 0,
  cache_write_tokens int not null default 0,
  cache_read_tokens  int not null default 0,
  cost_cents         numeric not null default 0,
  user_id            uuid,
  created_at         timestamptz not null default now()
);

-- Query shapes: "spend since <date>" and "spend by agent/model" → index the time axis.
create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);
create index if not exists ai_usage_agent_idx   on public.ai_usage (agent);

-- Tenant stamp (house pattern) — profile tenant wins; service-role inserts fall to the founding tenant.
drop trigger if exists stamp_tenant_tg on public.ai_usage;
create trigger stamp_tenant_tg before insert on public.ai_usage
  for each row execute function public.stamp_tenant();

alter table public.ai_usage enable row level security;

-- Read: staff only (spend is sensitive). Write: service role only (supabaseAdmin bypasses RLS) — there
-- is deliberately NO insert/update policy, so the client can never forge or edit a usage row.
drop policy if exists "ai_usage staff read" on public.ai_usage;
create policy "ai_usage staff read" on public.ai_usage
  for select using ((select public.is_staff()));

-- Tenant isolation (restrictive) — matches every other tenant_id table.
drop policy if exists "tenant isolation" on public.ai_usage;
create policy "tenant isolation" on public.ai_usage as restrictive
  for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

grant select on public.ai_usage to authenticated;

-- verify: expect the table with 10 columns and RLS on.
-- select count(*) as cols from information_schema.columns where table_name='ai_usage';
-- select relrowsecurity from pg_class where relname='ai_usage';
