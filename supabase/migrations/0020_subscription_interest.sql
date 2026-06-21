-- 0020 — subscription waitlist (Phase 0). Captures demand before the Square
-- recurring-billing investment. Anyone can express interest; only admins read it.
create table if not exists public.subscription_interest (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text,
  pack_size text check (pack_size in ('6','12','18') or pack_size is null),
  created_at timestamptz not null default now()
);
alter table public.subscription_interest enable row level security;
drop policy if exists "interest insert" on public.subscription_interest;
create policy "interest insert" on public.subscription_interest for insert to anon, authenticated
  with check (char_length(coalesce(email, '')) <= 200);
drop policy if exists "interest read admin" on public.subscription_interest;
create policy "interest read admin" on public.subscription_interest for select using (public.is_admin());
