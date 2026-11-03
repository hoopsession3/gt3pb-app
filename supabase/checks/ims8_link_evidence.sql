-- IMS8 — A LINK'S LIFE, AS EVIDENCE (read-only; counts and flags only — never a token, a label or a payload).
-- For the live link test (make one, open it signed out, turn it off). Changes nothing and deletes nothing: a turned-off test
-- link and its activity lines are kept as evidence (0468: a turned-off link stays off; admin_audit is append-only).
-- Run 2026-11-03 after the deploy of f14c3dc6: 0 links, 0 activity lines for links — no test link had reached production.
select
  (select count(*) from public.vision_shares)                                                     as links,
  (select count(*) from public.vision_shares where revoked_at is null)                            as live,
  (select count(*) from public.vision_shares where revoked_at is not null)                        as turned_off,
  (select count(*) from public.vision_shares where published is not null)                         as published,
  (select coalesce(max(revision), 0) from public.vision_shares)                                   as highest_revision,
  (select coalesce(sum(opens), 0) from public.vision_shares)                                      as opens,
  (select count(*) from public.vision_shares where revoked_at is not null and opens > 0)          as turned_off_after_opening,
  (select count(*) from public.admin_audit where table_name = 'vision_shares')                    as activity_lines,
  (select count(*) from public.admin_audit where table_name = 'vision_shares' and action = 'INSERT') as made_lines,
  (select count(*) from public.admin_audit where table_name = 'vision_shares' and action = 'UPDATE') as changed_lines,
  (select count(*) from public.admin_audit where table_name = 'vision_shares'
      and (coalesce(old_row, '{}'::jsonb) ? 'token' or coalesce(new_row, '{}'::jsonb) ? 'token'
           or coalesce(old_row, '{}'::jsonb) ? 'published' or coalesce(new_row, '{}'::jsonb) ? 'published')) as lines_with_token_or_payload,   -- 0
  (select count(*) from public.admin_audit where table_name = 'vision_shares' and tenant_id is null) as lines_without_business;      -- 0
