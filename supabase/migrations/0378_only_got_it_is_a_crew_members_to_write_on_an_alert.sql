-- ── 0378 — ONLY "GOT IT" IS A CREW MEMBER'S TO WRITE ON AN ALERT ──────────────────────────────────────────────────
-- 0157's policy "alerts staff update" lets a crew member update an alert of their own business, and Supabase grants
-- every column of every table to authenticated, so through PostgREST a crew member could rewrite another person's alert
-- (its title, its body, who it is for) or set escalated_at, which 0373 answers with one more push to every owner. The
-- app writes two columns from a phone: ack_at and ack_by (lib/useMyAlerts: "Got it", "Got it" on all, and its undo).
-- So a signed-in person may update those two and nothing else. Everything else that writes an alert is the service role
-- (the server's raises) or a security definer function (0372's fold, 0373's escalation, 0374's ring), which run as the
-- table's owner: column grants do not reach them. The policies are unchanged — which rows a person may acknowledge is
-- still 0157's question. Found by the wave-2 alerts review (2026-10-11).
-- changelog: none — a permission narrowed to what the app already does; nothing a person sees changes.

revoke update on table public.alerts from anon, authenticated;
grant update (ack_at, ack_by) on table public.alerts to authenticated;

-- verify:
--   select has_column_privilege('authenticated', 'public.alerts', 'ack_at', 'UPDATE');   -- t
--   select has_column_privilege('authenticated', 'public.alerts', 'title', 'UPDATE');    -- f
--   select has_column_privilege('anon', 'public.alerts', 'ack_at', 'UPDATE');            -- f
select public.record_migration('0378_only_got_it_is_a_crew_members_to_write_on_an_alert');
