-- 0306 — Every finite list gets one owner, and that owner is the database.
--
-- THE FINDING BEHIND THIS FILE. An interface audit of the operator console turned up twelve places
-- where a screen asks for more than the decision contains. Nine of them share a single cause: GT3
-- keeps TWO sources of truth for the same concepts — constants in lib/, and tables here. A screen
-- written against the constant got a picker. A screen written in a hurry got a text box. Same
-- column, same values, two contracts, nothing reconciling them.
--
--   inventory_items.unit     picker over a UNITS constant in InventoryLibrary; free text in
--                            InventoryAI and SmartIntake, which write the same column
--   inventory_items.status   TWO DIFFERENT hard-coded lists — one ends "Low, Out", the other ends
--                            "Consumed, Returned" — for one column, in two editors
--   markets                  a markets TABLE used by the crew roster, and a MARKETS CONSTANT used
--                            by Gear, Offer letters, Field ops and Spend. Two lists of the cities,
--                            able to disagree, one of them unchangeable without a deploy
--
-- WHY ONE TABLE AND NOT FIVE. Units, statuses and document types are small closed vocabularies with
-- identical needs: a stable key, a label to show, an order, and the ability to retire a value
-- without deleting history. Five near-identical two-column tables is five migrations, five RLS
-- policies and five places to forget. option_sets is one table keyed by set_key. Anything with its
-- own columns, relationships or lifecycle — markets, vendors, profiles — stays its own table; this
-- is only for lists that are genuinely just a list.
--
-- WHAT THIS DOES NOT DO. It does not delete the constants. They become the SEED and the offline
-- fallback: a picker reads the table and falls back to the constant if the fetch fails, so a
-- network blip degrades to today's behaviour instead of an empty dropdown. The constant stops being
-- a second source of truth and becomes a cached copy of the first.

create table if not exists public.option_sets (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  set_key   text not null,                    -- 'inventory_unit', 'inventory_status', 'doc_kind', …
  value     text not null,                    -- what gets stored on the row
  label     text,                             -- what a person reads; falls back to value
  sort      int  not null default 100,
  active    boolean not null default true,    -- retire a value without orphaning old rows
  note      text,
  created_at timestamptz not null default now(),
  unique (set_key, value)
);
create index if not exists option_sets_key_idx on public.option_sets (set_key, sort, value);

alter table public.option_sets enable row level security;
drop policy if exists "options readable" on public.option_sets;
-- Guests never see these — every picker they back sits behind a staff screen.
create policy "options readable" on public.option_sets for select to authenticated
  using ((select public.is_staff()));
drop policy if exists "options admin write" on public.option_sets;
create policy "options admin write" on public.option_sets for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "tenant isolation" on public.option_sets;
create policy "tenant isolation" on public.option_sets as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
grant select on public.option_sets to authenticated;

drop trigger if exists stamp_tenant_tg on public.option_sets;
create trigger stamp_tenant_tg before insert on public.option_sets
  for each row execute function public.stamp_tenant();
drop trigger if exists audit_option_sets on public.option_sets;
create trigger audit_option_sets after insert or update or delete
  on public.option_sets for each row execute function public.audit_row();

comment on table public.option_sets is
  'The small closed vocabularies the UI offers as pickers — inventory units, inventory statuses, document kinds. One row per option. Written because the same column was a picker on one screen and a free-text box on another, and because inventory status had two different hard-coded lists in two editors. The lib/ constants are now seeds and offline fallbacks, not a second source of truth.';

-- ── seeds ──────────────────────────────────────────────────────────────────────────────────────
-- Units, verbatim from InventoryLibrary's UNITS. The empty-string member of that constant is not
-- seeded: "no unit yet" is the absence of a choice, which a picker expresses with its own blank
-- option, not with a row that means nothing.
insert into public.option_sets (set_key, value, label, sort)
select 'inventory_unit', v.value, v.label, v.sort from (values
  ('each','each',10), ('case','case',20), ('pack','pack',30), ('gallon','gallon',40),
  ('lb','lb',50), ('oz','oz',60), ('set','set',70), ('box','box',80)
) as v(value, label, sort)
where not exists (select 1 from public.option_sets o
                   where o.set_key = 'inventory_unit' and o.value = v.value);

-- Statuses: the UNION of the two lists that were live, because both were being written to the same
-- column and rows exist under both. Picking one list would have orphaned the other's rows.
insert into public.option_sets (set_key, value, label, sort, note)
select 'inventory_status', v.value, v.label, v.sort, v.note from (values
  ('On Hand','On Hand',10,null),
  ('In Transit','In Transit',20,null),
  ('Backorder','Backorder',30,null),
  ('Low','Low',40,'From the AI intake editor''s list.'),
  ('Out','Out',50,'From the AI intake editor''s list.'),
  ('Consumed','Consumed',60,'From the library editor''s list.'),
  ('Returned','Returned',70,'From the library editor''s list.')
) as v(value, label, sort, note)
where not exists (select 1 from public.option_sets o
                   where o.set_key = 'inventory_status' and o.value = v.value);

-- Document kinds, from the placeholder that was enumerating them in SmartIntake: "permit / coi /
-- receipt…". When a placeholder has to list the valid answers, the control was the wrong one.
insert into public.option_sets (set_key, value, label, sort)
select 'doc_kind', v.value, v.label, v.sort from (values
  ('permit','Permit',10), ('coi','Certificate of insurance',20), ('receipt','Receipt',30),
  ('invoice','Invoice',40), ('contract','Contract',50), ('inspection','Inspection',60),
  ('other','Other',99)
) as v(value, label, sort)
where not exists (select 1 from public.option_sets o
                   where o.set_key = 'doc_kind' and o.value = v.value);

-- Menu timing. Three values, already a typed union in lib/menu.ts, and a free-text box in the menu
-- editor whose placeholder read "BEFORE / DURING / AFTER".
insert into public.option_sets (set_key, value, label, sort)
select 'menu_timing', v.value, v.label, v.sort from (values
  ('BEFORE','Before',10), ('DURING','During',20), ('AFTER','After',30)
) as v(value, label, sort)
where not exists (select 1 from public.option_sets o
                   where o.set_key = 'menu_timing' and o.value = v.value);

-- ── the lists a picker actually asks for ───────────────────────────────────────────────────────
create or replace view public.v_options as
select set_key, value, coalesce(label, value) as label, sort
  from public.option_sets
 where active
 order by set_key, sort, value;

revoke all on public.v_options from public, anon;
grant select on public.v_options to authenticated;

comment on view public.v_options is
  'Active options for every picker, ordered. One fetch backs every small dropdown in the console.';

-- Categories and vendors are NOT seeded into option_sets — they are open sets that grow from real
-- use, and vendors is already its own table with eighteen call sites. A picker over what has
-- actually been used, with free entry still allowed, is the honest control for those.
create or replace view public.v_inventory_categories as
select distinct btrim(category) as category, market
  from public.inventory_items
 where coalesce(btrim(category), '') <> ''
 order by 1;

revoke all on public.v_inventory_categories from public, anon;
grant select on public.v_inventory_categories to authenticated;

comment on view public.v_inventory_categories is
  'Categories actually in use on the shelf, per market. Backs a suggest-list rather than a closed picker: category is an open set, so the control offers what exists without forbidding a new one.';

-- ── the jurisdictions the permit checker can actually match ────────────────────────────────────
-- The State and County boxes are free text, and lib/compliance.ts matches them against these
-- columns. A near miss — "Ga." or "Fulton County" — matches zero rules and renders a permit list
-- that looks complete. That is the worst failure shape in the app: silent, and regulatory.
create or replace view public.v_compliance_jurisdictions as
select r.state,
       nullif(btrim(coalesce(r.county, '')), '') as county,
       count(*) filter (where r.active)          as active_rules
  from public.compliance_rules r
 where coalesce(btrim(r.state), '') <> ''
 group by 1, 2
 order by 1, 2 nulls first;

revoke all on public.v_compliance_jurisdictions from public, anon;
grant select on public.v_compliance_jurisdictions to authenticated;

comment on view public.v_compliance_jurisdictions is
  'Every state/county pair the permit rules can answer for, with how many active rules back it. The State and County inputs pick from this, so a typo can no longer read as "no permits needed".';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Lists you pick from now come from one place','improvement','System',
   'Several screens asked you to type a value that another screen offered as a dropdown — the same box, the same column, two different ways to fill it. Stock units were a picker in one editor and free text in two others. Stock status had two different lists of options depending on which screen you opened. The permit checker matched a state and county you typed by hand, so a small difference in spelling quietly returned no rules at all and looked like nothing was required. Every one of those lists now lives in the database, in one place, and every screen reads the same one. Where a list is open-ended rather than fixed — categories, vendors — you are offered what is already in use without being stopped from adding something new.',
   '2026-09-07', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0306_one_owner_per_list',
  'option_sets + v_options, category and jurisdiction views. Constants become seeds and fallbacks.');

-- verify:
--   select set_key, count(*) from public.v_options group by 1 order by 1;
--   select * from public.v_compliance_jurisdictions;
