-- 0122 — owner-editable front-end copy. The marketing strings on the storefront (home statement,
-- CTA, menu prompt, sign-off) were hardcoded in the components, so changing a word meant a code
-- deploy. This keeps overrides keyed to a stable id; the app reads default-or-override (defaults live
-- in lib/copy.ts), so nothing is ever blank and the site works before anything is edited. Public read
-- (the storefront renders it); only admins/owners write.
create table if not exists public.site_copy (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

alter table public.site_copy enable row level security;
grant select on public.site_copy to anon, authenticated;
grant insert, update, delete on public.site_copy to authenticated;

drop policy if exists "copy public read" on public.site_copy;
create policy "copy public read" on public.site_copy for select using (true);
drop policy if exists "copy admin write" on public.site_copy;
create policy "copy admin write" on public.site_copy for all
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- live updates so an edit shows on open storefronts without a refresh
alter publication supabase_realtime add table public.site_copy;
