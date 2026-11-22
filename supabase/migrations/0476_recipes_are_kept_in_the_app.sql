-- 0476 · RECIPES ARE KEPT IN THE APP (HELD — see supabase/held.json)
--
-- Why (Ryan, 2026-11-20): "The goal is for her to maintain recipes from her phone with her existing account." The drink
-- recipes lived only in code (lib/academyCookbook.ts), so every correction was a code change and a deploy, and Ask GT3
-- sent a crew member who found a mistake to Plan → Notes. This keeps each recipe's versions in the app:
--   · any crew member (is_staff) of the business may save a DRAFT correction and SUBMIT it for review;
--   · an owner or admin (is_admin) PUBLISHES a submitted version, or DECLINES it, and may RESTORE an earlier one;
--   · exactly one version of a recipe is published at a time; publishing retires the one before (kept, restorable);
--   · the recipe screen and Ask GT3 read the PUBLISHED version only (lib/recipeBook.ts, server side) — drafts and
--     submissions never reach an answer. Until a recipe has a published version, both read the built-in cookbook.
--
-- No new privileged function the API can call: every read and write goes through these policies as the caller. The one
-- trigger runs as its owner (as the house's audit triggers do: it reads the caller's id and retires the version before)
-- with EXECUTE revoked from every API role, so the audit's count of callable SECURITY DEFINER functions stays 140.
--
-- Rollback: drop table public.recipe_versions cascade; drop function public.recipe_versions_guard(); and take 0476 off
-- the ledger. The built-in cookbook is untouched by this migration, so the app falls back to it at once.
-- lock-timeout: none — a new table only; no existing table is altered or locked
-- changelog: none — the crew's recipe editor; reviewed before it ships

create table if not exists public.recipe_versions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  product_key  text not null check (product_key ~ '^[a-z0-9_]{1,40}$'),
  status       text not null default 'draft' check (status in ('draft', 'submitted', 'published', 'retired', 'declined')),
  body         jsonb not null check (jsonb_typeof(body) = 'object' and length(body::text) <= 20000),
  note         text check (note is null or length(note) <= 2000),
  based_on     uuid references public.recipe_versions(id) on delete set null,
  created_by   uuid not null default auth.uid(),
  created_at   timestamptz not null default now(),
  submitted_at timestamptz,
  decided_by   uuid,
  decided_at   timestamptz,
  published_at timestamptz,
  version_no   int
);
create unique index if not exists recipe_versions_one_published on public.recipe_versions (tenant_id, product_key) where status = 'published';
create index if not exists recipe_versions_by_key on public.recipe_versions (tenant_id, product_key, created_at desc);
create index if not exists recipe_versions_based_on on public.recipe_versions (based_on);

alter table public.recipe_versions enable row level security;
drop policy if exists "tenant isolation" on public.recipe_versions;
create policy "tenant isolation" on public.recipe_versions as restrictive for all
  using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()));
-- Read: what is or was published, by any crew member; your own drafts and submissions; everything, for owners/admins.
drop policy if exists "recipes read" on public.recipe_versions;
create policy "recipes read" on public.recipe_versions for select using (
  (select public.is_staff()) and (status in ('published', 'retired') or created_by = (select auth.uid()) or (select public.is_admin())));
-- Write a draft or a submission of your own (never a published one — that is a decision, below).
drop policy if exists "recipes draft" on public.recipe_versions;
create policy "recipes draft" on public.recipe_versions for insert with check (
  (select public.is_staff()) and created_by = (select auth.uid()) and status in ('draft', 'submitted')
  and decided_by is null and decided_at is null and published_at is null and version_no is null);
-- Change: your own draft or submission; or, for owners/admins, any version (publish, decline, restore).
drop policy if exists "recipes change" on public.recipe_versions;
create policy "recipes change" on public.recipe_versions for update
  using ((select public.is_staff()) and ((created_by = (select auth.uid()) and status in ('draft', 'submitted')) or (select public.is_admin())))
  with check ((select public.is_staff()) and ((created_by = (select auth.uid()) and status in ('draft', 'submitted')) or (select public.is_admin())));
-- Delete: your own unsent draft; owners/admins any draft or declined version. Published and retired versions are history.
drop policy if exists "recipes discard" on public.recipe_versions;
create policy "recipes discard" on public.recipe_versions for delete using (
  status in ('draft', 'declined') and ((created_by = (select auth.uid()) and status = 'draft') or (select public.is_admin())));

-- The rules a policy can't see (it can't compare the row before and after): who moved it, to what, and what that means.
create or replace function public.recipe_versions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare admin boolean := coalesce(public.is_admin(), false);
begin
  if tg_op = 'UPDATE' then
    if new.product_key <> old.product_key or new.created_by <> old.created_by or new.tenant_id <> old.tenant_id then
      raise exception 'a version keeps its recipe and its author' using errcode = '42501';
    end if;
    if not admin then
      -- The author edits and submits; a decision (publish, decline, retire) is an owner's or an admin's.
      if new.status not in ('draft', 'submitted') then
        raise exception 'only an owner or an admin publishes or declines a recipe' using errcode = '42501';
      end if;
      if new.decided_by is distinct from old.decided_by or new.published_at is distinct from old.published_at or new.version_no is distinct from old.version_no then
        raise exception 'a decision is an owner''s or an admin''s' using errcode = '42501';
      end if;
    elsif new.status in ('published', 'retired') and old.status in ('published', 'retired') and new.body is distinct from old.body then
      raise exception 'a published version is history: save a new draft instead' using errcode = '22023';
    end if;
    if new.status = 'submitted' and old.status <> 'submitted' then new.submitted_at := now(); end if;
    if new.status = 'published' and old.status <> 'published' then
      -- One published at a time: the one before is retired, kept, and can be restored.
      update public.recipe_versions set status = 'retired'
       where tenant_id = new.tenant_id and product_key = new.product_key and status = 'published' and id <> new.id;
      new.decided_by := auth.uid(); new.decided_at := now(); new.published_at := now();
      if new.version_no is null then
        new.version_no := coalesce((select max(version_no) from public.recipe_versions where tenant_id = new.tenant_id and product_key = new.product_key), 0) + 1;
      end if;
    end if;
    if new.status = 'declined' and old.status <> 'declined' then new.decided_by := auth.uid(); new.decided_at := now(); end if;
  end if;
  return new;
end $$;
revoke all on function public.recipe_versions_guard() from public, anon, authenticated;
drop trigger if exists recipe_versions_guard on public.recipe_versions;
create trigger recipe_versions_guard before update on public.recipe_versions for each row execute function public.recipe_versions_guard();

grant select, insert, update, delete on public.recipe_versions to authenticated;
revoke all on public.recipe_versions from anon;

select public.record_migration('0476_recipes_are_kept_in_the_app');
