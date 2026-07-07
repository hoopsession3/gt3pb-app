-- 0129 — guest reviews. Members leave a rating + word after pickup; staff can also add reviews
-- pulled from Google / Instagram / the feedback album. Nothing shows publicly until a staffer
-- approves it, and everything is scrubbed + anonymized by lib/reviews.ts before it reaches a screen.
create table if not exists public.reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  name       text,                                        -- name at submit time; anonymized on display
  rating     int  not null check (rating between 1 and 5),
  body       text,
  source     text not null default 'app',                 -- app | google | instagram | manual
  approved   boolean not null default false,              -- must be approved before it shows on the display
  created_at timestamptz not null default now()
);
create index if not exists reviews_approved on public.reviews(approved, created_at desc);

alter table public.reviews enable row level security;

-- Public (incl. the logged-out truck display) reads ONLY approved reviews.
drop policy if exists "reviews public read approved" on public.reviews;
create policy "reviews public read approved" on public.reviews for select using (approved);

-- A signed-in member may leave their own review (goes in unapproved).
drop policy if exists "reviews insert own" on public.reviews;
create policy "reviews insert own" on public.reviews for insert to authenticated with check (auth.uid() = user_id);

-- Staff moderate: read all, approve, edit, add manual, delete.
drop policy if exists "reviews staff all" on public.reviews;
create policy "reviews staff all" on public.reviews for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

grant select on public.reviews to anon, authenticated;
grant insert, update, delete on public.reviews to authenticated;
