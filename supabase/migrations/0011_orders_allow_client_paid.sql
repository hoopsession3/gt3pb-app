-- 0011 — allow client-recorded paid orders (no server-side recording, per owner choice)
-- Keeps the other 0008 guards (own user, status=new, total>=0) but drops the
-- paid=false requirement so the existing client card flow can mark an order paid
-- after Square confirms. TRADE-OFF: a paid order is now client-asserted (forgeable
-- via the anon key). Acceptable at current scale; the hardened path is to record
-- paid orders server-side in /api/checkout with a service-role key (see roadmap).
drop policy if exists "place own order" on public.orders;
create policy "place own order" on public.orders for insert to anon, authenticated
  with check (status = 'new' and total_cents >= 0 and (user_id is null or user_id = auth.uid()));
