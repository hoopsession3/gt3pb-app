-- 0130 — the 86 lifecycle, made operationally honest:
-- 1) WHO/WHEN: flipping sold_out stamps sold_out_at + sold_out_by (auth.uid), cleared on un-86 —
--    the manager can show "86'd 2:14pm" and the flip is attributable.
-- 2) A NEW SERVICE DAY UN-86s EVERYTHING: "86" means sold out TODAY. At 4am Eastern (08:00 UTC)
--    every sold_out flag clears automatically, so nothing stays accidentally dead on Wednesday
--    because someone forgot after Saturday. An item that should stay off longer belongs on
--    active=false (off the menu), not 86 — that's the semantic split.
alter table public.products add column if not exists sold_out_at timestamptz;
alter table public.products add column if not exists sold_out_by uuid;

create or replace function public.stamp_86() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.sold_out and not coalesce(old.sold_out, false) then
    new.sold_out_at := now();
    new.sold_out_by := auth.uid();
  elsif not new.sold_out and coalesce(old.sold_out, false) then
    new.sold_out_at := null;
    new.sold_out_by := null;
  end if;
  return new;
end $$;
drop trigger if exists products_stamp_86 on public.products;
create trigger products_stamp_86 before update on public.products for each row execute function public.stamp_86();

create or replace function public.reset_daily_86s() returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.products set sold_out = false, sold_out_at = null, sold_out_by = null where sold_out;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.reset_daily_86s() from public, anon, authenticated;

do $$ begin
  perform cron.schedule('reset-daily-86s', '0 8 * * *', 'select public.reset_daily_86s()');
exception when others then null; end $$;
