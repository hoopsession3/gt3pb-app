-- ── 0429 — A TEXT IS SENT ONCE FOR WHAT HAPPENED ───────────────────────────────────────────────────────────────────
-- 2026-10-18. R22 of the 10/10 audit (API F11; Ryan, 2026-10-17: "Keep working to improve to a 10"). Paste into
-- Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. A message to a customer named nothing of what it was about: the Pass pressed twice told the member twice that
-- their order was ready; a stop called off whose first call died part way never told its packs, because a second call
-- couldn't know who had heard; a provider's webhook told again sent its shipping notice again.
--
-- WHAT. The app names what happened — "order-ready:<order>", "stop-canceled:<stop>:pack:<pack>" (lib/notify onceKey) —
-- and the same name twice is one message. An email is held to it by Resend (its Idempotency-Key, kept a day). A text is
-- held to it here: public.message_sent keeps each text's key — claimed just before the text goes, marked sent when it
-- went, let go again if it didn't, and taken over by the next call when a claim was never marked in two minutes (the
-- call that claimed it died on the way: a text missed is worse than one doubled). The service role's alone, ninety days
-- — push_sent's shape (0419), for the push function's own.
--
-- set lock_timeout (database F16): one new table — nothing else is touched.
-- existing rows: none — a new table.
-- changelog: below.

set lock_timeout = '5s';

create table if not exists public.message_sent (
  event_key  text primary key check (char_length(event_key) between 3 and 220),
  claimed_at timestamptz not null default now(),   -- the text about to go (lib/notify claimText)
  sent_at    timestamptz                            -- when the provider took it; null while it is going, or if the call died
);
alter table public.message_sent enable row level security;   -- no policy: the app's server (service role) alone
revoke all on public.message_sent from public, anon, authenticated;
grant select, insert, update, delete on public.message_sent to service_role;
create index if not exists message_sent_claimed_idx on public.message_sent (claimed_at);
comment on table public.message_sent is
  'One row per text the app sent for something that happened (0429): its key names it (text:order-ready:<id>, text:stop-canceled:<stop>:pack:<id>, …) — claimed just before the text goes, marked sent when it went, let go if it did not, and taken over by the next call when never marked within two minutes; so the same thing told twice is texted once. Emails are held to the same keys by Resend. Kept ninety days.';

do $$ begin perform cron.unschedule('message-sent-sweep'); exception when others then null; end $$;
do $$ begin
  perform cron.schedule('message-sent-sweep', '19 7 * * *', $q$delete from public.message_sent where claimed_at < now() - interval '90 days'$q$);
exception when others then
  raise notice '0429: pg_cron is not here — the sweep is: delete from public.message_sent where claimed_at < now() - interval ''90 days''';
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A message is sent once', 'fix', 'Ordering',
   'Telling a customer something names what it is about — this order ready, this stop called off for this pack — and the same thing told twice is one email and one text: a button pressed twice, or a call retried after it stopped part way, no longer tells them twice, and a retry now reaches whoever the first try missed.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_class where relname = 'message_sent' and relrowsecurity;                                     -- 1
--   select has_table_privilege('anon', 'public.message_sent', 'select');                                                -- false
--   select count(*) from cron.job where jobname = 'message-sent-sweep';                                                 -- 1
select public.record_migration('0429_a_text_is_sent_once_for_what_happened');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
