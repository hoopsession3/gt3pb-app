-- 0303 — A screen that healed itself is not a critical incident.
--
-- WHAT HAPPENED. At 8:30 PM on 2026-09-06 the owners' inbox got "Critical — App error — a screen
-- crashed", body "Failed to load chunk /_next/static/chunks/0pfvpf_6yqhu-.js?dpl=... from module
-- 74850 · /crew". Nothing was actually broken. A phone had /crew open across a deploy, asked for a
-- chunk filename from the previous build, and the error boundary healed it with one reload before
-- anybody could tap the link in the email.
--
-- TWO SEPARATE DEFECTS, BOTH IN HOW IT WAS REPORTED RATHER THAN WHAT HAPPENED.
--
--   1. app/error.tsx reported EVERY boundary hit as fatal on its first line and only checked for
--      deploy skew afterwards. Order of operations. So the self-heal that 0-something shipped
--      worked exactly as designed and still paged the owners, because the page had already been
--      sent by the time the heal was decided.
--
--   2. The dedup in /api/errors/report — one row and one alert per unique fingerprint, repeats
--      only bump a counter — never fired for this error, because the fingerprint is computed from
--      the message and a skew message contains the three things that change on EVERY build: the
--      content-hashed chunk filename, the Vercel deployment id, and an internal module number.
--      Every deploy minted a brand-new fingerprint. One critical email per deploy, indefinitely.
--
-- The fix is app-side (classifyCrash decides fatality BEFORE the report is sent; stableErrorKey
-- normalises the per-build noise out of the fingerprint), and both are pure functions in
-- lib/deploySkew with the real message from this email as a fixture in scripts/smoke.cjs.
--
-- WHAT THIS MIGRATION DOES. Records whether a logged client error was the stale-build family, so
-- the split is answerable from the data instead of by reading messages. Additive and defaulted:
-- every existing row reads false, which is what it meant before the column existed.

alter table public.client_errors
  add column if not exists skew boolean not null default false;

comment on column public.client_errors.skew is
  'True when the client identified this as a stale-build (deploy skew) crash. Those are healed by one reload and are filed FYI, not critical — the alert ladder keys off the same flag. A skew row that is ALSO fatal means the reload did not fix it, which is the case worth looking at.';

-- ── the alerting, as a query ───────────────────────────────────────────────────────────────────
-- What was actually worth waking up for, versus what merely reloaded itself. If skew_healed grows
-- and fatal stays flat, the app is fine and the deploys are frequent — that is the healthy shape.
create or replace view public.v_client_error_shape as
select
  case when skew and not fatal then 'skew · healed itself'
       when skew and fatal     then 'skew · reload did NOT fix it'
       when fatal              then 'crash · a screen went down'
       else 'error · non-fatal' end                     as shape,
  count(*)                                              as fingerprints,
  sum(count)                                            as occurrences,
  max(last_seen)                                        as most_recent
  from public.client_errors
 group by 1
 order by 2 desc;

revoke all on public.v_client_error_shape from public, anon;
grant select on public.v_client_error_shape to authenticated;

comment on view public.v_client_error_shape is
  'The error log split by what it actually was. Written after a healed deploy-skew reload sent a critical alert to the owners at 8:30 PM for a screen that had already fixed itself.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A screen that fixes itself stops paging you','fix','System',
   'When a phone has the app open and a new version ships, the page it is holding asks for a file that no longer exists. The app already noticed this and reloaded itself, losing nothing — but it sent a CRITICAL "a screen crashed" alert first and worked out it was harmless second, so every deploy that caught an open tab bought an emergency email for a non-event. Worse, the rule that collapses a repeated error into one alert could never catch this one, because the message contains the build number and so looked brand new every single time. Both fixed: a crash is classified before it is reported, a self-healed one is filed as an FYI, and the repeat-detection now ignores the parts of the message that change every deploy. A stale-build error that does NOT heal after three tries still raises a critical, because at that point something really is wrong.',
   '2026-09-07', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select * from public.v_client_error_shape;
--   select fatal, skew, count, message from public.client_errors order by last_seen desc limit 10;
