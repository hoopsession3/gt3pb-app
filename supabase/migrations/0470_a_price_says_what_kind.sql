-- ── 0470 — A PRICE SAYS WHAT KIND OF PRICE IT IS (IMS7) ──────────────────────────────────────────────────────────
-- 2026-10-31. Ryan, 2026-10-31: "Authorize the necessary migration to distinguish Estimated · Listed · Quoted · Actual. A
-- seller's advertised price is not an actual expenditure. Preserve historical values and their original provenance. Do
-- not silently reinterpret existing records. Identify ambiguous historical costs and require appropriate
-- reconciliation." A second run changes nothing.
--
-- THE GAP. A library cost's basis was actual, estimated or scenario (0461). Accepting a researched price from a maker's
-- or a seller's page recorded it as ACTUAL (0462, std_accept_facts) — an advertised price called money spent — and the
-- Manage form's one choice for a real price was "Actual (a price paid or quoted)", two different things.
--
-- WHAT CHANGES.
--   · Bases: estimated · listed (a price a maker or seller publishes) · quoted (a price offered to GT3) · actual (paid) ·
--     scenario (kept: it's a what-if figure, and existing rows may hold it).
--   · std_accept_facts: a researched price is LISTED (a maker's, seller's or independent page), QUOTED when it's GT3's own
--     record, ESTIMATED when inferred — never actual. A person says actual, in Manage. Everything else in it is 0462's.
--   · Nothing already recorded is changed. Every cost recorded as ACTUAL before this is flagged (cost_basis_flag) for a
--     person to say what it is: 'actual_from_a_listing' where an accepted researched price from a published page set it;
--     'actual_paid_or_quoted' where a person chose the old "paid or quoted" option. The flag clears itself when a person
--     sets the basis, the amount or the source again. Production, counted before writing this (2026-10-31): 0 library
--     assets, 0 costs — so no row is flagged there today; the rule is for any copy that has them.
--
-- set lock_timeout (database F16): one table — one nullable column (no rewrite), one constraint replaced (validated:
-- it only widens the bases allowed), one trigger; one function replaced. existing rows: none changed except the flag.
-- rollback: re-run 0461's std_materials_lib_said and 0462's std_accept_facts (after re-labelling any listed/quoted
-- cost); drop the trigger, its function and cost_basis_flag.
-- changelog: none — the owners' library.

set lock_timeout = '5s';

alter table public.std_materials drop constraint if exists std_materials_lib_said;
alter table public.std_materials add constraint std_materials_lib_said check (
      (status_reason is null or length(status_reason) <= 500)
  and (studio_kind is null or studio_kind ~ '^[a-z0-9_]{1,40}$')
  and (w_in is null or (w_in > 0 and w_in <= 2400)) and (d_in is null or (d_in > 0 and d_in <= 2400)) and (h_in is null or (h_in > 0 and h_in <= 2400))
  and (finishes is null or length(finishes) <= 500)
  and (supplier is null or length(supplier) <= 160)
  and (supplier_url is null or (supplier_url ~ '^https://' and length(supplier_url) <= 1000))
  and (image_url is null or (image_url ~ '^https://' and length(image_url) <= 1000))
  and (cost_cents is null or (cost_cents >= 0 and cost_cents <= 100000000))
  and (cost_unit is null or length(cost_unit) <= 40)
  and (cost_basis is null or cost_basis in ('actual','quoted','listed','estimated','scenario'))
  and (cost_source is null or length(cost_source) <= 300)
  and (install_notes is null or length(install_notes) <= 1000)
  and (maintenance_notes is null or length(maintenance_notes) <= 1000)
  and pillars <@ array['movement','stillness','light','fuel']::text[]);

alter table public.std_materials add column if not exists cost_basis_flag text;
alter table public.std_materials drop constraint if exists std_materials_cost_basis_flag;
alter table public.std_materials add constraint std_materials_cost_basis_flag check (cost_basis_flag is null or cost_basis_flag in ('actual_from_a_listing','actual_paid_or_quoted'));

-- Flag, never reinterpret: what was recorded as actual stays actual until a person says otherwise. A second run
-- flags only what isn't flagged and still says actual with nobody having set it since (the flag clears itself then).
update public.std_materials m set cost_basis_flag = case
    when exists (select 1 from public.std_asset_facts f where f.material_id = m.id and f.field = 'cost_cents' and f.review in ('accepted','corrected')
                  and f.source_class in ('manufacturer','supplier','independent')) then 'actual_from_a_listing'
    else 'actual_paid_or_quoted' end
 where m.cost_basis = 'actual' and m.cost_basis_flag is null
   and not exists (select 1 from public.schema_migrations s where s.version like '0470%');

-- The flag clears when a person (or an accepted fact) sets the cost again — its basis, amount or source — or when a
-- person confirms the basis as it stands (Manage sends the flag cleared).
create or replace function public.std_cost_basis_flag_clear()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cost_basis is distinct from old.cost_basis or new.cost_cents is distinct from old.cost_cents or new.cost_source is distinct from old.cost_source then
    new.cost_basis_flag := null;
  elsif new.cost_basis_flag is not null and new.cost_basis_flag is distinct from old.cost_basis_flag and auth.uid() is not null then
    new.cost_basis_flag := old.cost_basis_flag;   -- set only by this migration; a person may clear it (saying the basis), never set it
  end if;
  return new;
end $$;
revoke all on function public.std_cost_basis_flag_clear() from public, anon, authenticated;
drop trigger if exists std_cost_basis_flag_clear_tg on public.std_materials;
create trigger std_cost_basis_flag_clear_tg before update on public.std_materials for each row execute function public.std_cost_basis_flag_clear();

create or replace function public.std_accept_facts(p_ids uuid[], p_corrections jsonb default '{}', p_bulk boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare f public.std_asset_facts; v jsonb; n int := 0; v_tenant uuid := public.effective_tenant();
  spec_cols text[] := array['maker','product_ref','w_in','d_in','h_in','composition','finishes','supplier','supplier_url','install_notes','maintenance_notes','image_url'];
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Only an owner or admin accepts facts.' using errcode = 'PT403'; end if;
  if jsonb_typeof(coalesce(p_corrections, '{}')) <> 'object' then raise exception 'Corrections are an object of fact id to value.' using errcode = 'PT422'; end if;
  for f in select * from public.std_asset_facts where id = any(p_ids) and tenant_id = v_tenant order by retrieved_at for update loop
    if f.review <> 'pending' then raise exception 'A fact already reviewed (%) is kept as it was.', f.review using errcode = 'PT409'; end if;
    if p_bulk then
      if f.risk = 'high' or f.method = 'inferred' or f.source_class = 'ai_inference' then
        raise exception 'Bulk acceptance takes only low-risk, sourced facts — % needs its own decision.', f.field using errcode = 'PT409';
      end if;
      if exists (select 1 from public.std_fact_conflicts c where c.material_id = f.material_id and c.field = f.field) then
        raise exception 'The facts about % disagree — decide them one at a time.', f.field using errcode = 'PT409';
      end if;
      if p_corrections ? f.id::text then raise exception 'A correction is its own decision, not part of a bulk acceptance.' using errcode = 'PT409'; end if;
    end if;
    v := coalesce(p_corrections -> f.id::text, f.value);
    -- What was accepted before for this field is superseded; the new value is the specification.
    update public.std_asset_facts set review = 'superseded' where material_id = f.material_id and field = f.field and review in ('accepted','corrected') and id <> f.id;
    update public.std_asset_facts set review = case when p_corrections ? f.id::text then 'corrected' else 'accepted' end,
      corrected_value = case when p_corrections ? f.id::text then v end, reviewed_by = auth.uid(), reviewed_at = now()
     where id = f.id;
    if f.field in ('w_in','d_in','h_in') then
      execute format('update public.std_materials set %I = ($1)::numeric where id = $2', f.field) using v #>> '{}', f.material_id;
    elsif f.field = any(spec_cols) then
      execute format('update public.std_materials set %I = $1 where id = $2', f.field) using v #>> '{}', f.material_id;
    elsif f.field = 'cost_cents' then
      update public.std_materials set cost_cents = (v #>> '{}')::numeric::int, cost_unit = coalesce(f.unit, cost_unit),
        -- 0470: a price a source published is LISTED, never actual; GT3's own record of one is QUOTED until a person says
        -- it was paid (actual); an inference is an estimate.
        cost_basis = case f.source_class when 'ai_inference' then 'estimated' when 'gt3' then 'quoted' else 'listed' end,
        cost_source = left(coalesce(f.source_title, f.source_ref, 'Accepted fact'), 300), cost_as_of = f.retrieved_at::date
       where id = f.material_id;
    end if;
    n := n + 1;
  end loop;
  if n <> coalesce(cardinality(p_ids), 0) then raise exception 'Some of those facts aren''t this tenant''s or don''t exist.' using errcode = 'PT404'; end if;
  return n;
end $$;
revoke all on function public.std_accept_facts(uuid[], jsonb, boolean) from public, anon, authenticated;
grant execute on function public.std_accept_facts(uuid[], jsonb, boolean) to authenticated;

-- verify (numbers only):
--   select cost_basis_flag, count(*) from public.std_materials group by 1;   -- every 'actual' before this, flagged
select public.record_migration('0470_a_price_says_what_kind');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
