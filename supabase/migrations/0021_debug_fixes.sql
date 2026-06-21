-- 0021 — fixes from the functional debug pass (user + operator surfaces).

-- ── (#9) Referral conversion was silently dead for pay-at-truck pre-orders ──────────
-- 0016 gated conversion on new.paid = true, but in-person pre-orders are recorded
-- paid=false and the operator only ever advances `status` (never sets paid). So a
-- referred member who pre-orders + is handed their cups never converted. The pickup
-- itself (status -> 'done') is already operator-gated and unforgeable (only is_admin()
-- can update an order's status), so the paid flag was never what made this safe — the
-- operator's hand on the order is. Restore the 0013 design: convert on pickup of any
-- real purchase (total over the floor), card or cash.
create or replace function public.award_points() returns trigger
language plpgsql security definer set search_path = public as $$
declare ref uuid; existing int := 0; grant_cents int := 500; floor_cents int := 500;
begin
  if new.status = 'done' and old.status is distinct from 'done' and new.user_id is not null then
    update public.profiles set points = points + greatest(coalesce(array_length(new.items, 1), 1), 1) where id = new.user_id;
    if new.total_cents >= floor_cents then
      select referred_by into ref from public.profiles where id = new.user_id and referred_by is not null and referral_converted = false;
      if ref is not null then
        select count(*) into existing from public.referral_events where referee = new.user_id;
        if existing = 0 then
          update public.profiles set referral_converted = true, credit_cents = credit_cents + grant_cents where id = new.user_id;
          update public.profiles set credit_cents = credit_cents + grant_cents where id = ref;
          insert into public.referral_events (referrer, referee, converting_order, referrer_credit_cents, referee_credit_cents)
            values (ref, new.user_id, new.id, grant_cents, grant_cents);
        end if;
      end if;
    end if;
  end if;
  return new;
end; $$;

-- ── (#10) Going offline left live_status.current_stop_id pointing at the old stop ───
-- The customer truck page then headlined the just-departed location. Clear the stop
-- so the mirror is internally consistent the moment the truck goes offline.
create or replace function public.admin_set_offline()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.stops set status = 'upcoming' where status = 'live';
  insert into public.live_status (id, is_live, current_stop_id) values (1, false, null)
  on conflict (id) do update set is_live = false, current_stop_id = null;
end; $$;

-- ── (#8) RSVP could never be cancelled — rsvps had INSERT + SELECT policies but no
-- UPDATE policy, so the cancel/re-RSVP UPDATE matched zero rows (no error) and the
-- optimistic UI lied. Add an owner-scoped UPDATE policy.
drop policy if exists "own rsvps update" on public.rsvps;
create policy "own rsvps update" on public.rsvps for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── (#12) Waitlist insert didn't bind user_id to the caller — anyone could write a
-- row attributed to another user's id. Match the convention used everywhere else.
drop policy if exists "interest insert" on public.subscription_interest;
create policy "interest insert" on public.subscription_interest for insert to anon, authenticated
  with check ((user_id is null or user_id = auth.uid()) and char_length(coalesce(email, '')) <= 200);

-- ── (#3) Reap orphaned 'pending' subscriptions — a create attempt that died after the
-- pending-row insert but before reaching Square would otherwise lock the member out of
-- subscribing forever (the one-active unique index keeps rejecting them). The server
-- route self-heals its own caller on retry; this cron covers members who never retry.
select cron.schedule(
  'reap-stale-pending-subs', '*/15 * * * *',
  $$delete from public.subscriptions where status = 'pending' and square_subscription_id is null and created_at < now() - interval '15 minutes'$$
);
