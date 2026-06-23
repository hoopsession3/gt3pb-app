-- 0042 — AUDIT LOG + INTEGRITY GUARDS. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Trust layer: an append-only, tamper-resistant history of every change to money/ops-critical
-- tables (who/what/when/before/after), plus guards so loyalty + credit can't silently go bad —
-- the class of failure behind this session's duplicate-identity / mis-credited-points bug.

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  tenant_id   uuid,
  table_name  text not null,
  op          text not null,            -- INSERT | UPDATE | DELETE
  row_id      text,
  actor       uuid,                     -- auth.uid() of who made the change
  old_data    jsonb,
  new_data    jsonb,
  at          timestamptz not null default now()
);
create index if not exists audit_log_table_idx  on public.audit_log(table_name, at desc);
create index if not exists audit_log_tenant_idx on public.audit_log(tenant_id, at desc);
create index if not exists audit_log_actor_idx  on public.audit_log(actor, at desc);

alter table public.audit_log enable row level security;
drop policy if exists "audit staff read" on public.audit_log;
create policy "audit staff read" on public.audit_log for select using ((select public.is_staff()));
-- No insert/update/delete policy: only the SECURITY DEFINER trigger writes; the log is tamper-proof.

-- Generic, column-agnostic audit trigger (reads id/tenant_id out of jsonb so it works on any table).
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare rec jsonb;
begin
  rec := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  insert into public.audit_log(tenant_id, table_name, op, row_id, actor, old_data, new_data)
  values (
    nullif(rec->>'tenant_id','')::uuid,
    tg_table_name, tg_op, rec->>'id', (select auth.uid()),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  return null;
end; $$;

-- Attach to the tables where history matters most (guarded by to_regclass).
do $$
declare
  t text;
  tables text[] := array['orders','subscriptions','event_approvals','profiles','reserves','reserve_claims','assets','inventory_items'];
begin
  foreach t in array tables loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
    end if;
  end loop;
end $$;

-- Integrity guards: loyalty + credit can never go negative. NOT VALID = enforce all NEW writes
-- immediately without risking the migration on any legacy row; validate later once confirmed clean.
alter table public.profiles drop constraint if exists profiles_points_nonneg;
alter table public.profiles add constraint profiles_points_nonneg check (points >= 0) not valid;
alter table public.profiles drop constraint if exists profiles_credit_nonneg;
alter table public.profiles add constraint profiles_credit_nonneg check (credit_cents >= 0) not valid;
