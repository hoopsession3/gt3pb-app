-- ── 0468 CLEANUP — tokens out of audit lines already written (separate; needs the owner's explicit yes to run) ───────
-- Before 0468, every investor-link create, edit and open copied the link's whole row — its secret token included — into
-- admin_audit (0447 attached 0260's generic trigger). 0468 stops new ones. This removes the token (and the open counters,
-- which say nothing useful) from the lines already there, and says how many it touched. Run AFTER 0468, in the Supabase
-- SQL editor, as one transaction. A second run touches nothing.
--
-- ROLLBACK: none by design. A token taken out must not be recoverable — that is the point. The only undo is the
-- database's point-in-time backup, which is the owner's. Read the "before" row first; if it's 0, there is nothing to do.
--
-- Production, last read (2026-11-01, read-only): 0 audit lines for vision_shares → this is a no-op there today.
begin;
select count(*) filter (where (old_row ? 'token') or (new_row ? 'token')) as lines_with_a_token_before,
       count(*) as link_lines
  from public.admin_audit where table_name = 'vision_shares';
update public.admin_audit
   set old_row = case when old_row is null then null else old_row - 'token' - 'opens' - 'last_opened_at' end,
       new_row = case when new_row is null then null else new_row - 'token' - 'opens' - 'last_opened_at' end,
       summary = (select string_agg(part, ' · ') from unnest(string_to_array(summary, ' · ')) as part
                   where part !~ '^(token|opens|last_opened_at): ')
 where table_name = 'vision_shares' and ((old_row ? 'token') or (new_row ? 'token') or summary ~ '(^| · )(token|opens|last_opened_at): ');
select count(*) filter (where (old_row ? 'token') or (new_row ? 'token') or summary ~ '(^| · )token: ') as lines_with_a_token_after,
       count(*) as link_lines
  from public.admin_audit where table_name = 'vision_shares';
commit;
