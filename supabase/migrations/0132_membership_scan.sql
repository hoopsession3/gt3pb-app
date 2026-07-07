-- 0132 — membership-card scan. Staff look up a member by their card code (referral_code, or user id
-- as fallback) and add a stamp for a walk-up purchase. Both SECURITY DEFINER + staff-gated so a
-- customer can never credit themselves — mirrors the operator-gated loyalty model (0012).

create or replace function public.member_by_code(p_code text)
returns table(display_name text, points int, founding_member boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  return query
    select p.display_name, p.points, p.founding_member
    from public.profiles p
    where p.referral_code = p_code or p.id::text = p_code
    limit 1;
end $$;

create or replace function public.award_manual_point(p_code text)
returns int
language plpgsql security definer set search_path = public as $$
declare new_points int;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  update public.profiles p set points = points + 1
    where p.referral_code = p_code or p.id::text = p_code
    returning points into new_points;
  return new_points;
end $$;

grant execute on function public.member_by_code(text) to authenticated;
grant execute on function public.award_manual_point(text) to authenticated;
