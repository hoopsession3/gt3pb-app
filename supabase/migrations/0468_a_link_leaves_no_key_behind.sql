-- ── 0468 — A LINK LEAVES NO KEY BEHIND (IMS8 A2, link records hygiene) ──────────────────────────────────────────────
-- 2026-11-01. Ryan: "Prepare 0468 to prevent raw investor-link tokens from entering admin_audit… No raw tokens,
-- authorization secrets, or complete sensitive share rows in audit logs. Revocation must be final unless an explicitly
-- authorized replacement-link workflow creates a new token. Verify cross-tenant isolation for audit records." Needs 0467.
-- A second run changes nothing.
--
-- THE GAP (verified in Postgres, IMS8 audit S1). Every link create, edit and investor OPEN wrote the whole vision_shares
-- row — its secret token included — into admin_audit (0447 attached 0260's generic log_admin_audit). admin_audit had no
-- business column and was readable by any business's admin. Revoked links' tokens stayed there. An admin could also
-- clear revoked_at (un-revoke), or edit a link's token or open counts, through the API.
--
-- WHAT CHANGES.
--   · A link's audit line is built from NAMED fields only — an allow-list, as 0464 for what a link sends: who it's for,
--     asks on/off, expiry, revoked, pin, creator, created, and the scope (program / plan / need / room / money / research
--     ids). Never the token, never the open counters, never any column added later. An investor opening a link writes no
--     audit line (the counters live on the link). The generic 0260 trigger no longer runs on vision_shares.
--   · admin_audit carries tenant_id: stamped from the audited row's own tenant_id, else the caller's business. Read only
--     within your own business (a restrictive policy alongside 0260's "audit admin read"), as audit_log has been since
--     its start. Rows written before this migration: given their row's tenant_id; where the row has none and exactly one
--     business exists, that business (it is the only one that could have written it); with more than one business, left
--     NULL — which no one can read through the API (fail closed).
--   · admin_audit is append-only by grant too, not only by the absence of policies: insert/update/delete/truncate revoked
--     from anon and authenticated; anon can't select. Only the definer triggers write.
--   · Revocation is final: once revoked_at is set it can't be cleared or changed, and a revoked link can't be edited. A
--     replacement is a new link with a new token. A link's token, creator, business and creation time never change. The
--     open counters change only through the link's own door (vision_shared marks its own update; nothing else can).
--   · created_by is stamped on insert (it was never set). New links default to asks OFF (show_asks default false), as the
--     app does since 0467 v3 — so a link made through the API without saying is narrower, not wider.
--
-- HISTORICAL CLEANUP — NOT IN THIS MIGRATION. Removing tokens from audit lines already written is a separate, explicitly
-- authorized script (IMS8-0468-CLEANUP.sql) with before/after counts. Production had 0 such lines when last read.
--
-- set lock_timeout (database F16): one column added to admin_audit (nullable, no default — no rewrite), one backfill
-- update of admin_audit, one policy added, grants revoked, two trigger functions added, one trigger replaced, one
-- column default changed, vision_shared replaced (one line: it marks its own counter update).
-- existing rows: admin_audit.tenant_id backfilled as above; no vision_shares row changed.
-- rollback: drop trigger vision_share_audit_tg, vision_share_guard_tg on vision_shares; recreate admin_audit_vision_shares
--   (0447); drop policy "audit tenant isolation" on admin_audit; alter table admin_audit drop column tenant_id; re-run
--   0467's vision_shared; alter table vision_shares alter column show_asks set default true; re-grant as before.
-- changelog: none — the activity log and the links' own records; nothing a customer sees.

set lock_timeout = '5s';

-- ── The activity log: per business, append-only ─────────────────────────────────────────────────────────────────────
alter table public.admin_audit add column if not exists tenant_id uuid;
create index if not exists admin_audit_tenant_idx on public.admin_audit (tenant_id, created_at desc);
update public.admin_audit a set tenant_id = coalesce(
    (case when coalesce(a.new_row, a.old_row) ->> 'tenant_id' ~ '^[0-9a-f-]{36}$' then (coalesce(a.new_row, a.old_row) ->> 'tenant_id')::uuid end),
    (select t.id from public.tenants t where (select count(*) from public.tenants) = 1))
 where a.tenant_id is null;
drop policy if exists "audit tenant isolation" on public.admin_audit;
create policy "audit tenant isolation" on public.admin_audit as restrictive for all
  using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()));
revoke insert, update, delete, truncate on public.admin_audit from anon, authenticated;
revoke select on public.admin_audit from anon;

create or replace function public.log_admin_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pk   text;
  diff text;
begin
  if (tg_op = 'UPDATE') then
    select string_agg(format('%s: %s → %s', key, coalesce(o.value, '∅'), coalesce(n.value, '∅')), ' · ' order by key)
      into diff
      from jsonb_each_text(to_jsonb(old)) as o(key, value)
      full join jsonb_each_text(to_jsonb(new)) as n(key, value) using (key)
     where o.value is distinct from n.value
       and key not in ('updated_at', 'created_at');
    if diff is null then return new; end if;   -- timestamp-only touch → not a change worth a line
  end if;
  pk := coalesce(
    to_jsonb(coalesce(new, old)) ->> 'id',
    to_jsonb(coalesce(new, old)) ->> 'key',
    to_jsonb(coalesce(new, old)) ->> 'category',
    to_jsonb(coalesce(new, old)) ->> 'product_key');
  -- 0468: the line belongs to the audited row's business (else the caller's).
  insert into public.admin_audit (actor, action, table_name, row_pk, summary, old_row, new_row, tenant_id)
  values (auth.uid(), tg_op, tg_table_name, pk, diff,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
          coalesce(case when to_jsonb(coalesce(new, old)) ->> 'tenant_id' ~ '^[0-9a-f-]{36}$' then (to_jsonb(coalesce(new, old)) ->> 'tenant_id')::uuid end,
                   public.effective_tenant()));
  return coalesce(new, old);
end $$;
revoke all on function public.log_admin_audit() from public, anon, authenticated;

-- ── A link's audit line: named fields only ──────────────────────────────────────────────────────────────────────────
-- What a link's line may say. Never the token, never the counters, never a column added later.
create or replace function public.vision_share_audit_fields(r public.vision_shares)
returns jsonb language sql immutable set search_path = public as $$
  select case when r is null then null else jsonb_build_object(
    'id', r.id, 'tenant_id', r.tenant_id, 'label', r.label, 'show_asks', r.show_asks, 'expires_at', r.expires_at,
    'revoked_at', r.revoked_at, 'pinned_at', r.pinned_at, 'created_by', r.created_by, 'created_at', r.created_at,
    'program_ids', r.program_ids, 'plan_ids', r.plan_ids, 'need_plans', r.need_plans, 'layout_ids', r.layout_ids,
    'money_plans', r.money_plans, 'research_plans', r.research_plans) end
$$;
revoke all on function public.vision_share_audit_fields(public.vision_shares) from public, anon, authenticated;

create or replace function public.vision_share_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then public.vision_share_audit_fields(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then public.vision_share_audit_fields(new) end;
  diff text;
begin
  if tg_op = 'UPDATE' then
    select string_agg(format('%s: %s → %s', key, coalesce(a.value, '∅'), coalesce(b.value, '∅')), ' · ' order by key)
      into diff
      from jsonb_each_text(o) as a(key, value) full join jsonb_each_text(n) as b(key, value) using (key)
     where a.value is distinct from b.value;
    if diff is null then return new; end if;   -- an investor's open (counters only) — not an audit line
  end if;
  insert into public.admin_audit (actor, action, table_name, row_pk, summary, old_row, new_row, tenant_id)
  values (auth.uid(), tg_op, 'vision_shares', coalesce(new.id, old.id)::text, diff, o, n, coalesce(new.tenant_id, old.tenant_id));
  return coalesce(new, old);
end $$;
revoke all on function public.vision_share_audit() from public, anon, authenticated;
drop trigger if exists admin_audit_vision_shares on public.vision_shares;
drop trigger if exists vision_share_audit_tg on public.vision_shares;
create trigger vision_share_audit_tg after insert or update or delete on public.vision_shares
  for each row execute function public.vision_share_audit();

-- ── A link's record: what can't change ──────────────────────────────────────────────────────────────────────────────
create or replace function public.vision_share_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();                -- who made it (null only for the server or the SQL editor)
    new.created_at := now();
    new.opens := 0; new.last_opened_at := null;
    return new;
  end if;
  if old.revoked_at is not null then
    raise exception 'A turned-off link stays off. Make a new link instead.' using errcode = 'PT403';
  end if;
  if new.token is distinct from old.token or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at or new.tenant_id is distinct from old.tenant_id then
    raise exception 'A link''s key, maker, business and start never change. Make a new link instead.' using errcode = 'PT403';
  end if;
  if (new.opens is distinct from old.opens or new.last_opened_at is distinct from old.last_opened_at)
     and coalesce(current_setting('gt3.share_open', true), '') <> 'on' then
    raise exception 'Only an opened link counts its opens.' using errcode = 'PT403';
  end if;
  return new;
end $$;
revoke all on function public.vision_share_guard() from public, anon, authenticated;
drop trigger if exists vision_share_guard_tg on public.vision_shares;
create trigger vision_share_guard_tg before insert or update on public.vision_shares
  for each row execute function public.vision_share_guard();

alter table public.vision_shares alter column show_asks set default false;

-- The door, by token: as 0467, marking its own counter update (vision_share_guard lets only this through).
create or replace function public.vision_shared(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.vision_shares;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  select * into s from public.vision_shares
   where token = p_token and revoked_at is null and (expires_at is null or expires_at > now());
  if not found then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  perform set_config('gt3.share_open', 'on', true);
  update public.vision_shares set opens = opens + 1, last_opened_at = now() where id = s.id;
  perform set_config('gt3.share_open', 'off', true);
  return public.vision_share_payload(s);
end $$;
revoke all on function public.vision_shared(text) from public, anon, authenticated;
grant execute on function public.vision_shared(text) to anon, authenticated;

select public.record_migration('0468_a_link_leaves_no_key_behind');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
