-- Ryan: verifying a bottle-owner proof should let staff CHOOSE Founding vs Founding VIP, not grant
-- both automatically every time ("No I should be ask to select founding member or VIP member" /
-- "verification overlaps"). granted_tier records that choice; the vip_verified flag (0249) now only
-- flips on when staff explicitly pick the VIP grant, not on every verify.

alter table public.vip_verifications
  add column if not exists granted_tier text check (granted_tier in ('founding', 'founding_vip'));

create or replace function public.mark_customer_vip_verified() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'verified' and new.customer_id is not null and new.granted_tier = 'founding_vip' then
    update public.customers set vip_verified = true where id = new.customer_id and vip_verified is distinct from true;
  end if;
  return new;
end $$;

-- Recreated (not just replaced) so the trigger also fires if granted_tier is corrected after the
-- fact without status changing — e.g. staff tapped the wrong verify button and fix it via a direct
-- update. Function body still gates on status = 'verified', so this can't fire on a pending/rejected row.
drop trigger if exists mark_customer_vip_verified_tg on public.vip_verifications;
create trigger mark_customer_vip_verified_tg after insert or update of status, granted_tier on public.vip_verifications
  for each row execute function public.mark_customer_vip_verified();

-- Backfill history for rows verified before this column existed, from the customer's actual
-- current vip_verified state (ground truth) rather than assuming every past verify was VIP.
update public.vip_verifications v
set granted_tier = case when c.vip_verified then 'founding_vip' else 'founding' end
from public.customers c
where v.customer_id = c.id and v.status = 'verified' and v.granted_tier is null;

-- Verified rows with no linked customer somehow (shouldn't happen given the 0204 auto-link trigger,
-- but defensive) — don't leave granted_tier null on a verified row.
update public.vip_verifications
set granted_tier = 'founding_vip'
where status = 'verified' and granted_tier is null;
