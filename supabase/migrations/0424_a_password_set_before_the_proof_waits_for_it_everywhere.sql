-- ── 0424 — A PASSWORD SET BEFORE THE PROOF WAITS FOR IT, ON EVERY ACCOUNT (HELD) ─────────────────────────────────────
-- 2026-10-17. R18 of the 10/10 audit (the R18 review, third and fourth passes; Ryan, 2026-10-17: "Keep working to improve
-- to a 10"). HELD (supabase/held.json): it is not in APPLY_ALL_PENDING.sql. Paste it by itself, with its own yes, once
-- this round's iPhone build is on the phones. A second run changes nothing, and pasting 0423 again after it keeps it.
--
-- WHY. Anyone who knows an address can make an account under it with a password of their own: the row waits, unproven,
-- and the address is sent a confirmation. When its owner later proves the address — the emailed code, or the link — the
-- account they come into is the stranger's, with the stranger's password still on it, and the stranger signs in beside
-- them: their orders, their card on file, their credit. 0423 takes that password wherever a crew role is at stake; every
-- customer account still keeps it. It waits because an iPhone build from before R18 sets nothing again after the code:
-- a member joining with a password there would lose the password they just typed, without a word — and nothing an old
-- build runs can be changed from here. R18's build sets it again right after the code (components/SignIn), and anyone
-- whose password was taken is asked to choose one when next signed in (components/AuthProvider, profiles.
-- password_taken_at).
--
-- WHAT. password_scope_everywhere() — 0423's switch for how far its rule reaches — answers true: password_waits_for_proof
-- (0423's, unchanged) takes a password set before the proof on every account when its address is first proven, by
-- itself or by an owner's hand, and marks it; an account its person made with an emailed code is not asked to choose one
-- (GoTrue's random password, nobody's). An account made already confirmed (Confirm email off, the dashboard's Auto
-- Confirm) still keeps its password — nothing was proven, so nothing is taken.
--
-- WHEN. Once R18's build is on the phones — the App Store's, and TestFlight's for the crew (Ryan's call) — paste this
-- alone, then take its entry out of supabase/held.json. Until then a member account a stranger made keeps the stranger's
-- password once its owner proves the address, as it always has (and loses it the day it is brought onto the crew —
-- 0423's take_signup_password).
--
-- set lock_timeout (database F16): a function only — no table is locked — but the rule is the rule.
-- existing rows: none — the rule reads the next proof; a password already on a confirmed account is never touched.
-- changelog: below.

set lock_timeout = '5s';

create or replace function public.password_scope_everywhere() returns boolean
  language sql stable set search_path = public as 'select true';   -- stable: never folded into a plan cached before it
revoke all on function public.password_scope_everywhere() from public, anon, authenticated;
comment on function public.password_scope_everywhere() is
  'Whether a password set before an address is proven is taken at the proof on every account (true, from 0424) or only where a crew role is at stake (false, 0423).';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('An account is only ever its owner''s', 'fix', 'Account',
   'If someone made an account with your email before you did, the password they set stops working the moment you prove the email is yours — and you choose your own.',
   '2026-10-17', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select public.password_scope_everywhere();                                                                       -- t
--   select count(*) from public.schema_migrations where version like '0424%';                                       -- 1
select public.record_migration('0424_a_password_set_before_the_proof_waits_for_it_everywhere');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor (the R18 review, third pass)
