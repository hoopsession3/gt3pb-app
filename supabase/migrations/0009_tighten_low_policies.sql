-- 0009 — tighten low-severity write policies found in the input stress test

-- rsvps: was WITH CHECK (true) → an RSVP could be attributed to another user.
drop policy if exists "anyone rsvp" on public.rsvps;
create policy "anyone rsvp" on public.rsvps for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

-- push_subscriptions: update was USING(true) WITH CHECK(true) → anyone could
-- update any device's subscription. Scope to anon rows or the owner (keeps the
-- upsert-on-endpoint resubscribe flow working, incl. anon→signed-in).
drop policy if exists "sub update" on public.push_subscriptions;
create policy "sub update" on public.push_subscriptions for update to anon, authenticated
  using (user_id is null or user_id = auth.uid())
  with check (user_id is null or user_id = auth.uid());
