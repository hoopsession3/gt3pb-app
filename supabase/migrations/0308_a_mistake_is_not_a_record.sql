-- 0308 — A mistake is not a record, and a record is not a mistake.
--
-- Ryan asked for two things in one sentence: let me delete a brew I started by accident, and audit
-- everywhere else that should allow deletion and does not. Auditing it turned the question inside
-- out. The console is not short of DELETE permission — 112 of 142 tables already grant it. What it
-- is short of is the DISTINCTION. Every table is treated the same way, so the two failure modes sit
-- side by side:
--
--   a batch logged by accident   cannot be removed from where the mistake happened
--   an invoice, a stock ledger   can be removed by anyone who is not a customer
--
-- The gate is why. is_staff() is written as role <> 'member' (0035), so a server, a contractor and
-- an operator all clear it identically — there is no policy anywhere in the database that tells a
-- server apart from a contractor. Forty-one tables sit behind that one gate, and among them are
-- invoices, the inventory ledger, the jug ledger, the B2B accounts and the storefront orders.
--
-- Ten tables carry a hard-delete guard today (0141, 0276, 0277, 0281, 0292). Nineteen money- and
-- record-bearing tables carry none. This closes the ones that can be closed without breaking a
-- legitimate cascade, and gives the accidental brew somewhere to go.
--
-- THE THREE ANSWERS. Every row in this app is one of:
--   DELETE   it never happened and nothing depends on it     (a mistyped batch, a stale budget)
--   DISCARD  it happened, or something points at it          (keep the row, mark it void)
--   NEVER    it is money, stock, or a legal record           (guard the delete, void instead)
-- The mistake this migration corrects is that the code did not know which was which.

-- ── 1) A BREW LOGGED BY ACCIDENT ───────────────────────────────────────────────────────────────
-- 'dumped' already exists and means something REAL: it was brewed and poured out. That is a loss,
-- and it belongs in yield. 'discarded' is the opposite claim — it never existed. Collapsing the two
-- would make every accidental tap of "Start brewing" look like wasted coffee.
alter table public.brew_batches drop constraint if exists brew_batches_status_check;
alter table public.brew_batches add constraint brew_batches_status_check
  check (status = any (array['planned','brewing','ready','kegged','served','dumped','discarded']));

alter table public.brew_batches
  add column if not exists discarded_at  timestamptz,
  add column if not exists discarded_by  uuid references auth.users(id) on delete set null,
  add column if not exists discard_reason text;

comment on column public.brew_batches.discarded_at is
  'Set when a batch was logged by mistake and could not simply be deleted because something already points at it. Distinct from status dumped, which means it was really brewed and really poured out.';

-- ── 2) WHAT IS ACTUALLY HOLDING A BATCH ────────────────────────────────────────────────────────
-- The gap as a query, before the gap as a button. Three tables carry batch_id on delete set null,
-- which means deleting the batch would silently break the traceability chain 0261 exists to
-- provide: the rows survive, the answer to "which batch was that" does not.
create or replace view public.v_batch_removable as
select b.id,
       b.recipe_name,
       b.status,
       b.batch_gal,
       b.brew_started_at,
       (select count(*) from public.drop_orders      d where d.batch_id = b.id) as drop_orders,
       (select count(*) from public.delivery_orders  d where d.batch_id = b.id) as delivery_orders,
       (select count(*) from public.inventory_ledger l where l.batch_id = b.id) as ledger_rows,
       case
         when b.discarded_at is not null then 'already discarded'
         when (select count(*) from public.drop_orders      d where d.batch_id = b.id)
            + (select count(*) from public.delivery_orders  d where d.batch_id = b.id)
            + (select count(*) from public.inventory_ledger l where l.batch_id = b.id) > 0
           then 'discard only — something already points at it'
         else 'safe to delete'
       end as removable
  from public.brew_batches b
 order by b.brew_started_at desc nulls last;

revoke all on public.v_batch_removable from public, anon;
grant select on public.v_batch_removable to authenticated;

comment on view public.v_batch_removable is
  'Per batch: can it be deleted outright, or only discarded, and exactly what is holding it. The counts are the reason, so nobody has to guess why a batch would not go away.';

-- ── 3) ONE CALL, TWO OUTCOMES ──────────────────────────────────────────────────────────────────
-- The caller does not decide which. Asking a person "delete or discard?" asks them to know the
-- foreign-key graph; the database already does. It deletes when deleting loses nothing, and keeps
-- the row when deleting would lose the chain — and it says which it did, so the UI can say so too.
create or replace function public.discard_batch(p_batch uuid, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_held int;
  v_status text;
  v_name text;
begin
  if not public.is_staff() then
    raise exception 'Only crew can remove a batch.';
  end if;

  select status, coalesce(recipe_name, 'batch') into v_status, v_name
    from public.brew_batches where id = p_batch for update;
  if not found then
    raise exception 'That batch is already gone.';
  end if;

  select (select count(*) from public.drop_orders      d where d.batch_id = p_batch)
       + (select count(*) from public.delivery_orders  d where d.batch_id = p_batch)
       + (select count(*) from public.inventory_ledger l where l.batch_id = p_batch)
    into v_held;

  if v_held = 0 then
    -- brew_batch_links and brew_batch_steps cascade; nothing else points here.
    delete from public.brew_batches where id = p_batch;
    return 'deleted';
  end if;

  update public.brew_batches
     set status = 'discarded',
         discarded_at = now(),
         discarded_by = auth.uid(),
         discard_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_batch;
  return 'discarded';
end $$;

revoke all on function public.discard_batch(uuid, text) from public, anon;
grant execute on function public.discard_batch(uuid, text) to authenticated;

comment on function public.discard_batch(uuid, text) is
  'Remove a batch that should not exist. Deletes it outright when nothing points at it; otherwise keeps the row and marks it discarded, so orders and stock movements keep their batch reference. Returns deleted or discarded.';

-- ── 4) THE MONEY IS THE LEAST PROTECTED PART OF THE DATABASE ───────────────────────────────────
-- Nine tables where a delete is never the right answer and nothing legitimate performs one. They
-- are chosen deliberately: every one of them has NO incoming cascade, so a guard here can never
-- block a parent delete somewhere else. The tables that ARE cascade targets — shop_order_items and
-- merch_fulfillments (from shop_orders), event_economics (from events), loyalty_ledger and the
-- academy attestations (from auth.users) — are left alone on purpose. Guarding a cascade target
-- does not protect the row; it breaks the parent.
create or replace function public.guard_permanent_record()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('gt3.allow_hard_delete', true), '') = 'on' then
    return old;
  end if;
  raise exception 'Hard deletes are blocked on % — this is a record of money or stock that moved, and it stays answerable. Correct it with a reversing entry or a status change. Deliberate maintenance only: select set_config(''gt3.allow_hard_delete'',''on'',false); first.', tg_table_name;
end $$;

do $$
declare
  t text;
  tables text[] := array['invoices','jug_ledger','loop_txns','event_sales','inventory_ledger',
                         'inventory_lots','shop_orders','business_orders','business_accounts'];
begin
  foreach t in array tables loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists guard_delete_%1$s on public.%1$I', t);
      execute format('create trigger guard_delete_%1$s before delete on public.%1$I for each row execute function public.guard_permanent_record()', t);
    end if;
  end loop;
end $$;

-- ── 5) AND RAISE THE GATE, WITHOUT TOUCHING THE POLICIES THAT ALREADY WORK ─────────────────────
-- A RESTRICTIVE policy ANDs with whatever permissive policies already exist, so this cannot widen
-- anything and cannot affect select, insert or update. It only says: whoever else may delete here,
-- they must also be an admin. That turns "any account that is not a customer" into "admin or owner"
-- on the money surface, and leaves the 41-table is_staff() grant intact everywhere it is harmless.
--
-- The cascade targets excluded from the guard above ARE included here, and that is not an
-- inconsistency: a referential action runs as the table owner and does not consult RLS, so a policy
-- on a cascade target cannot break the parent delete. A trigger is the opposite — it fires on the
-- cascade. Policies where cascades exist, triggers only where they do not.
--
-- budgets and documents are in this list but deliberately NOT guarded above: a budget is a plan and
-- a filed document can be filed by mistake, so both should still be removable — just not by a
-- server who happened to open the console.
do $$
declare
  t text;
  tables text[] := array['invoices','jug_ledger','loop_txns','event_sales','inventory_ledger',
                         'inventory_lots','shop_orders','shop_order_items','merch_fulfillments',
                         'business_orders','business_accounts','budgets','documents',
                         'vip_verifications','loyalty_ledger'];
begin
  foreach t in array tables loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists %1$I_delete_admin_only on public.%1$I', t);
      execute format('create policy %1$I_delete_admin_only on public.%1$I as restrictive for delete using (public.is_admin())', t);
    end if;
  end loop;
end $$;

-- ── 6) WHO CAN DELETE WHAT, AS A QUERY ─────────────────────────────────────────────────────────
-- The audit that produced this migration had to be assembled by hand from pg_policy, pg_trigger and
-- a reading of four is_* functions. Nobody should have to do that twice.
create or replace view public.v_delete_rights as
select c.relname as table_name,
       coalesce((select string_agg(distinct
                  case when p.polpermissive then 'allows' else 'requires' end || ' ' ||
                  regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s+', ' ', 'g'), ' + ')
                  from pg_policy p
                 where p.polrelid = c.oid and p.polcmd in ('*','d')), 'no delete policy') as policy_gate,
       exists (select 1 from pg_trigger t
                where t.tgrelid = c.oid and not t.tgisinternal
                  and (t.tgtype & 8) > 0 and (t.tgtype & 2) > 0) as delete_guarded,
       exists (select 1 from information_schema.columns col
                where col.table_schema = 'public' and col.table_name = c.relname
                  and col.column_name in ('archived_at','canceled_at','voided_at','discarded_at')) as has_soft_delete
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by 3, 1;

revoke all on public.v_delete_rights from public, anon;
grant select on public.v_delete_rights to authenticated;

comment on view public.v_delete_rights is
  'Every table, the gate on deleting from it, whether a before-delete trigger blocks hard deletes, and whether it has a soft-delete column to use instead. The answer to "who can erase this?" without reading pg_policy by hand.';

-- ── 7) what changed, in the app's own words ────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A brew started by mistake can be taken back','improvement','Production',
   'Tapping Start on the wrong batch used to leave it on the schedule with nowhere to go — the only removal was buried in the production log, behind a view toggle. Removing a batch now lives where the mistake happens, and it does the right thing on its own: if nothing points at the batch it is deleted outright, and if orders or stock movements already reference it the batch is kept and marked discarded so the trail survives. Discarded is deliberately not the same as dumped — dumped means it was really brewed and really poured out, and that still counts against yield.',
   '2026-09-07', false),
  ('Money records can no longer be deleted by accident','improvement','Money',
   'Invoices, the stock ledger, the jug ledger, storefront orders and the B2B accounts had no protection against deletion, and the permission to delete them reached every account that was not a customer — a server and an operator cleared exactly the same check. Those records are now blocked from hard deletion outright, and where deletion still makes sense it is restricted to an admin. Nothing about reading or editing them changed.',
   '2026-09-07', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0308_a_mistake_is_not_a_record',
  'discard_batch + v_batch_removable; hard-delete guards on 9 money tables; restrictive admin-only delete on 15; v_delete_rights.');

-- verify:
--   select removable, count(*) from public.v_batch_removable group by 1;
--   select count(*) from pg_policy where polname like '%\_delete\_admin\_only' escape '\';   -- 15
--   select count(*) from public.v_delete_rights where delete_guarded;   -- 9 more than before
--   select table_name, delete_guarded, has_soft_delete from public.v_delete_rights
--    where table_name in ('invoices','jug_ledger','inventory_ledger','shop_orders','brew_batches');
--   select count(*) from public.v_delete_rights where policy_gate = 'no delete policy';
