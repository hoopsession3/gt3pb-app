-- 0008 — input-handling hardening (RLS + bounds)
-- Closes two real holes found in the input stress test, plus storage bounds.

-- (1) CRITICAL — profiles: "own profile update" had no WITH CHECK and a table-wide
-- UPDATE grant, so a signed-in user could update ANY column of their own row
-- (is_admin, points, credit_cents) straight from the public anon key.
-- Restrict writeable columns to display_name; everything else is RPC/admin-only.
revoke update on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- (2) HIGH — orders: insert was WITH CHECK (true), so a client could forge a
-- paid order (free drinks at the pass), spoof another user, or inject statuses.
-- Clients may only place UNPAID, NEW orders for themselves. Paid orders must be
-- written server-side (service role) after Square confirms payment.
drop policy if exists "anyone place order" on public.orders;
create policy "place own order" on public.orders for insert to anon, authenticated
  with check (
    paid = false
    and status = 'new'
    and total_cents >= 0
    and (user_id is null or user_id = auth.uid())
  );

-- (3) MEDIUM — bound free-text on public-writable tables (anti-abuse / storage).
alter table public.booking_requests drop constraint if exists booking_len;
alter table public.booking_requests add constraint booking_len check (
  char_length(coalesce(name, '')) <= 200 and
  char_length(coalesce(email, '')) <= 200 and
  char_length(coalesce(phone, '')) <= 50 and
  char_length(coalesce(location_text, '')) <= 300 and
  char_length(coalesce(notes, '')) <= 2000
);
alter table public.stops  drop constraint if exists stop_notes_len;
alter table public.stops  add constraint stop_notes_len  check (char_length(coalesce(notes, '')) <= 1000);
alter table public.events drop constraint if exists event_title_len;
alter table public.events add constraint event_title_len check (char_length(coalesce(title, '')) <= 200);
