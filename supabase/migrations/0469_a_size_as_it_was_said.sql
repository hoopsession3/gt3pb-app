-- ── 0469 — A SIZE AS IT WAS SAID, AND ONLY A SIZE (IMS7 correctness) ────────────────────────────────────────────────
-- 2026-10-31. Ryan, 2026-10-31: "Normalize supported units to inches… Preserve original measurement, unit, source, and
-- normalized value… Authorize a database migration enforcing positive finite dimensions where dimensions are provided.
-- First inspect existing rows… Preserve valid nulls… Do not apply a migration that unexpectedly rejects existing
-- legitimate records." A second run changes nothing. Paste it BEFORE the deploy that carries this patch: the intake now
-- writes the two new columns.
--
-- WHAT WAS FOUND. The library's own sizes were already held to positive and finite (0461: std_materials w/d/h null or
-- > 0 and ≤ 2400 — NaN fails the ≤), and a placed thing's (0447: width and depth > 0, height ≥ 0 — a flat thing has
-- none). The research facts (0462) weren't: a size fact's value was whatever the intake made of it, and the intake made
-- "6 ft" into 6 by stripping what wasn't a digit (fixed in lib/measure, this patch). Production, read before writing
-- this (2026-10-31, counts only): 0 research facts, 0 library assets, 19 placed things — all with valid sizes.
--
-- WHAT CHANGES. std_asset_facts gains original_value and original_unit: a size as its source printed it ("1,830 mm"),
-- beside the inches it was read as. A size fact (w_in, d_in, h_in) must now be a positive number of inches up to 2400,
-- in inches (unit 'in' or none) — and so must a correction to one. Every other field is untouched; nulls stay nulls.
-- If any existing row breaks the new rule, this stops before changing anything and says how many (nothing is
-- reinterpreted or deleted to make it fit).
--
-- set lock_timeout (database F16): one table; two nullable columns (no rewrite), two checks (validated against what's
-- there — none today). existing rows: none changed.
-- rollback: alter table public.std_asset_facts drop constraint std_facts_size, drop constraint std_facts_size_corrected,
-- drop column original_value, drop column original_unit.
-- changelog: none — the owners' library intake.

set lock_timeout = '5s';

-- Look first: a row the new rule would refuse stops the migration, counted, before any constraint is added.
do $$
declare bad int;
begin
  select count(*) into bad from public.std_asset_facts
   where field in ('w_in','d_in','h_in')
     and not (jsonb_typeof(value) = 'number' and (value #>> '{}')::numeric > 0 and (value #>> '{}')::numeric <= 2400 and (unit is null or unit = 'in')
              and (corrected_value is null or (jsonb_typeof(corrected_value) = 'number' and (corrected_value #>> '{}')::numeric > 0 and (corrected_value #>> '{}')::numeric <= 2400)));
  if bad > 0 then
    raise exception '0469 stopped: % size fact(s) aren''t a positive number of inches up to 2400. Nothing was changed — review them first.', bad using errcode = 'PT409';
  end if;
end $$;

alter table public.std_asset_facts add column if not exists original_value text;
alter table public.std_asset_facts add column if not exists original_unit text;
alter table public.std_asset_facts drop constraint if exists std_facts_original;
alter table public.std_asset_facts add constraint std_facts_original check ((original_value is null or length(original_value) <= 120) and (original_unit is null or length(original_unit) <= 40));


alter table public.std_asset_facts drop constraint if exists std_facts_size;
alter table public.std_asset_facts add constraint std_facts_size check (
  field not in ('w_in','d_in','h_in')
  or (jsonb_typeof(value) = 'number' and (value #>> '{}')::numeric > 0 and (value #>> '{}')::numeric <= 2400 and (unit is null or unit = 'in')));
alter table public.std_asset_facts drop constraint if exists std_facts_size_corrected;
alter table public.std_asset_facts add constraint std_facts_size_corrected check (
  field not in ('w_in','d_in','h_in') or corrected_value is null
  or (jsonb_typeof(corrected_value) = 'number' and (corrected_value #>> '{}')::numeric > 0 and (corrected_value #>> '{}')::numeric <= 2400));

-- verify (numbers only):
--   select count(*) from public.std_asset_facts where original_value is not null;   -- 0 (first run)
select public.record_migration('0469_a_size_as_it_was_said');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
