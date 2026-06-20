-- 0007 — fix missing table-level grants on orders + booking_requests
-- RLS policies were correct but Postgres evaluates GRANTs before RLS,
-- so UPDATE was silently denied even for admins.

grant update on public.orders to authenticated;

-- booking_requests had no grants at all (insert from the Book form was broken in prod too)
grant insert, select, update on public.booking_requests to anon, authenticated;
