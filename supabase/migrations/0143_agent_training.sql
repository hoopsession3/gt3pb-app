-- 0143 — AI AGENT TRAINING: owner corrections, grounding, conversation history. Idempotent.
--
-- The problem this fixes: the freeform agents (Operator Mode / "Ask GT3") answered recipe & fact
-- questions from a STATIC knowledge file with no way for the owner to correct a wrong answer — so
-- a hallucinated "200 g cacao" stuck. Now: owners add corrections (text + optional media proof)
-- that get injected as an AUTHORITATIVE override into the agents' prompts, every agent answer is
-- logged so you can go back and turn any wrong one into a correction, and recipe questions ground
-- in the real brew_recipes data. This is "training" in the grounding sense (curated truth the
-- agent must obey), not model fine-tuning.

-- 1) owner corrections / knowledge the agents must obey
create table if not exists public.agent_knowledge (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  agent       text not null default 'all',   -- 'all' | 'operator' | 'brew' | 'concierge' | 'chief'
  title       text not null,
  body        text not null,                 -- the correct fact, in the owner's words — what the AI grounds on
  media_url   text,                          -- optional proof (a recipe card / receipt photo)
  media_type  text,
  active      boolean not null default true,
  created_by  uuid references auth.users(id),
  author_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists agent_knowledge_idx on public.agent_knowledge(agent, active, created_at desc);
alter table public.agent_knowledge enable row level security;
drop policy if exists "knowledge staff read" on public.agent_knowledge;
create policy "knowledge staff read" on public.agent_knowledge for select using ((select public.is_staff()));
drop policy if exists "knowledge owner write" on public.agent_knowledge;
create policy "knowledge owner write" on public.agent_knowledge for all
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.role in ('owner','admin') or p.is_admin)))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.role in ('owner','admin') or p.is_admin)));

-- 2) every agent answer, logged — the history you can return to and correct from
create table if not exists public.agent_convos (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  agent       text not null,
  question    text,
  answer      text,
  user_id     uuid references auth.users(id),
  author_name text,
  created_at  timestamptz not null default now()
);
create index if not exists agent_convos_idx on public.agent_convos(agent, created_at desc);
alter table public.agent_convos enable row level security;
drop policy if exists "convos staff read" on public.agent_convos;
create policy "convos staff read" on public.agent_convos for select using ((select public.is_staff()));
drop policy if exists "convos staff insert" on public.agent_convos;
create policy "convos staff insert" on public.agent_convos for insert with check ((select public.is_staff()));

-- 3) media bucket for correction proof (recipe cards, receipts) — mirrors the brand bucket
insert into storage.buckets (id, name, public) values ('training', 'training', true) on conflict (id) do nothing;
drop policy if exists "training media public read" on storage.objects;
create policy "training media public read" on storage.objects for select using (bucket_id = 'training');
drop policy if exists "training media staff write" on storage.objects;
create policy "training media staff write" on storage.objects for all to authenticated
  using (bucket_id = 'training' and (select public.is_staff()))
  with check (bucket_id = 'training' and (select public.is_staff()));

-- 4) durability: audit both, tenant-stamp both, restrictive isolation (knowledge is deletable by
-- owners on purpose — no hard-delete guard here; the audit log preserves the history either way).
do $$
declare t text; tables text[] := array['agent_knowledge','agent_convos'];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
    execute format('drop trigger if exists stamp_tenant_tg on public.%1$I', t);
    execute format('create trigger stamp_tenant_tg before insert on public.%1$I for each row execute function public.stamp_tenant()', t);
    execute format('drop policy if exists "tenant isolation" on public.%1$I', t);
    execute format('create policy "tenant isolation" on public.%1$I as restrictive for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant())', t);
  end loop;
end $$;

-- verify:
--   select to_regclass('public.agent_knowledge'), to_regclass('public.agent_convos');       -- both non-null
--   select id from storage.buckets where id = 'training';                                    -- 'training'
--   select count(*) from pg_policy where polrelid='public.agent_knowledge'::regclass;        -- >= 3
