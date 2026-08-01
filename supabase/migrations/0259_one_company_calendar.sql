-- 0259 · ONE COMPANY CALENDAR (2026-08-01 — Ryan: "all events, truck stops, opportunities, and
-- meetings for prospects and pipelines should roll up to the one business calendar so I can see
-- everything in one stop pane", plus the Business-lane call: "when we click on business, should it
-- not focus on what we're doing to make the money?"). Two reshapes of the live work_streams rows,
-- mirroring DEFAULT_STREAMS (lib/streams.ts):
--
--   1. Business lane LEADS with "plan" — tapping Business now lands on the shared company
--      calendar (operations first), with Money demoted to a later stop in the lane.
--   2. The three new calendar categories join their lanes so the calendar's lane filter stays
--      complete: lead → Events (a booking request is event sales), pipe + meeting → Business.
--
-- Idempotent by guard (NOT array_append blindly — re-running must not double-add), and scoped by
-- key so tenant-customized lanes only gain what's missing.

update public.work_streams set sections = array_prepend('plan', sections)
 where key = 'business' and not ('plan' = any(sections));

update public.work_streams set categories = array_append(categories, 'lead')
 where key = 'events' and not ('lead' = any(categories));

update public.work_streams set categories = array_append(categories, 'pipe')
 where key = 'business' and not ('pipe' = any(categories));

update public.work_streams set categories = array_append(categories, 'meeting')
 where key = 'business' and not ('meeting' = any(categories));

-- Verify (prod, after apply):
--   select key, sections, categories from public.work_streams where key in ('business','events');
--   -- business.sections starts with 'plan'; business.categories ends 'pipe','meeting'; events has 'lead'
