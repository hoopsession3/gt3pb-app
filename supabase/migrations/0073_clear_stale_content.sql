-- 0073 — clear stale demo CONTENT off the company calendar. The "Duncan Town Square" posts are
-- leftover test content (the Duncan event is already archived by 0072). Unschedule them so they
-- leave the calendar; they stay as drafts in Studio. Owner confirmed all current data was test.
update public.content_items set scheduled_for = null
  where title ilike 'Duncan%'
     or event_id in (select id from public.events where archived_at is not null);
