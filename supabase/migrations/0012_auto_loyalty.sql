-- 0012 — automatic loyalty
-- Award points when an order is marked picked up (status -> done) by the operator.
-- Operator-gated (admin flips status), so points can't be self-granted via a
-- forged client order. 1 point per drink in the order. SECURITY DEFINER so it can
-- write profiles.points (which is otherwise RLS/grant-locked to display_name).
create or replace function public.award_points() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' and new.user_id is not null then
    update public.profiles
      set points = points + greatest(coalesce(array_length(new.items, 1), 1), 1)
      where id = new.user_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_award_points on public.orders;
create trigger trg_award_points after update on public.orders
  for each row execute function public.award_points();
