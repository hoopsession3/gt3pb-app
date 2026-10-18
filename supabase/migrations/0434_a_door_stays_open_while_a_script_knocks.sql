-- ── 0434 — A DOOR STAYS OPEN FOR THE CUSTOMER WHILE A SCRIPT KNOCKS ────────────────────────────────────────────────────
-- 2026-10-18. R29 of the 10/10 audit (API F1; Ryan, 2026-10-17: "Keep working to improve to a 10"). Paste into Supabase →
-- SQL Editor → Run. A second run changes nothing.
--
-- WHY. Every public door that rings the crew or reaches Square has a ceiling for everyone together, and a handful of
-- addresses could spend it for everybody: two addresses' booking requests silenced every catering lead for the hour
-- (book:global, thirty an hour), ten kept card checkout shut (checkout:global, sixty a minute), and the other card doors
-- the same way (card:all, a hundred and twenty a minute) — every real customer refused for a script's sake.
--
-- WHAT.
--   · rate_limit_peek(): whether a bucket is under its cap in this window — asked, never counted (rate_limit_hit counts
--     every ask). The server's alone. So a ceiling can be asked of what already happened — cards Square refused, a
--     minute's twenty and card payments pause for the rest of it — instead of every try a script can make.
--   · booking_requests.quiet: a lead kept past the hour's thirty, and not announced one by one (the push function skips
--     it; the crew are told once that a burst came, and where it is). Nobody asking is turned away.
--
-- set lock_timeout (database F16): one function, one column — its default a constant, so no rewrite; a moment's lock.
-- existing rows: every lead so far is not quiet (the default).
-- changelog: below.

set lock_timeout = '5s';

-- ── asked, not counted ──────────────────────────────────────────────────────────────────────────────────────────────
-- The window is rate_limit_hit's own (0419), to the millisecond: the same bucket, the same window, the same count. True
-- is UNDER the cap — the next rate_limit_hit would be let through — as rate_limit_hit answers.
create or replace function public.rate_limit_peek(p_bucket text, p_window_ms int, p_max int)
returns boolean language sql stable security definer set search_path = public as $$
  select p_max is not null and p_max >= 1 and p_window_ms is not null and p_window_ms >= 1
     and coalesce((select h.count from public.rate_limit_hits h
                    where h.bucket = p_bucket
                      and h.window_start = to_timestamp(floor(extract(epoch from now()) * 1000 / p_window_ms) * p_window_ms / 1000.0)), 0) < p_max
$$;
revoke all on function public.rate_limit_peek(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_peek(text, int, int) to service_role;
comment on function public.rate_limit_peek(text, int, int) is
  'Whether a rate_limit_hit bucket is under its cap in the current window, without counting (0434). The server''s alone: the card doors ask it of the minute''s refused cards before Square is asked.';

-- ── a lead past the hour's thirty: kept, not announced ──────────────────────────────────────────────────────────────
alter table public.booking_requests add column if not exists quiet boolean not null default false;
comment on column public.booking_requests.quiet is
  'Kept past the hour''s ceiling for everyone together (0434, /api/book): the push function announces it to nobody, and the crew are told once an hour that a burst came. Nobody asking is turned away.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A script can''t close the doors on customers', 'security', 'Checkout',
   'A burst of booking requests no longer turns real ones away — every request is kept, and past thirty an hour the crew hear once that a burst came. Card payments pause for a minute only after twenty cards are refused in one, instead of after a number of tries anyone could make, and the crew are told.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select has_function_privilege('anon', 'public.rate_limit_peek(text, integer, integer)', 'execute');          -- f
--   select has_function_privilege('service_role', 'public.rate_limit_peek(text, integer, integer)', 'execute');  -- t
--   select count(*) from information_schema.columns where table_name = 'booking_requests' and column_name = 'quiet'; -- 1
select public.record_migration('0434_a_door_stays_open_while_a_script_knocks');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
