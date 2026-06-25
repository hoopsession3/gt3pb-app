-- 0084 — seed brew gear as assets + baseline maintenance cadences.
-- Populates the Asset Maintenance log from day one: the grinder, the brewing vessels, kegs, and the
-- CO2 system, each with a first dated entry whose next_due_on sets the recurring cadence. Dates are
-- relative to when this runs (deploy), so "due in a month" means a month from go-live. Idempotent:
-- assets seeded by name, each cadence entry seeded once (by asset + summary).

-- ── 1) the gear (assets) ──
insert into public.assets (name, make_model, brand, category, use_case, qty, notes)
select v.name, v.make_model, 'GT3 Brew', '{brew}'::text[], v.use_case, v.qty, v.notes
from (values
  ('Timemore grinder',        'Timemore burr grinder', 'Coarse grind for cold brew (1:13 spec)', 1, 'Burrs are a consumable — dry-brush only, never wash with water, do not oil burrs.'),
  ('Toddy (commercial)',      'Toddy commercial cold-brew system', 'Cold-brew vessel — 2.5 gal, filter bag', 1, 'Filter bag system. Rinse per use; deep clean + sanitize on cadence.'),
  ('Cold Brew Avenue vessel', 'Stainless cold-brew vessel ~5 gal', 'Cold-brew vessel — 5 gal, basket + tap', 1, 'Perforated filter basket + bottom tap. Watch tap seals and basket.'),
  ('Corny kegs (5 gal)',      'Ball-lock corny keg', 'Keg pack-out + dispense', 4, 'Sanitize each use; O-rings/poppets are wear parts.'),
  ('Nitrogen system (N2)',    'N2 tank + regulator', 'Pure-nitro cold brew dispense', 1, 'Pure nitrogen (not CO2). Tank needs DOT hydrostatic test every 5 years; regulator + lines leak-checked on cadence.'),
  ('Nitro tap (stout faucet)','Stout faucet w/ restrictor plate', 'Nitro pour / cascade', 1, 'Restrictor plate clogs — flush daily in service, deep clean on cadence for a clean cascade.')
) as v(name, make_model, use_case, qty, notes)
where not exists (select 1 from public.assets a where a.name = v.name);

-- ── 2) baseline maintenance entries (set the cadence) ──
-- helper pattern: insert a dated entry for an asset with next_due_on = cadence, once per (asset,summary).
insert into public.asset_maintenance (asset_id, kind, performed_on, summary, next_due_on, performed_by)
select a.id, x.kind, current_date, x.summary, (current_date + x.cadence)::date, 'GT3'
from (values
  ('Timemore grinder',        'clean',   'Deep clean burrs + chamber (dry-brush; cleaning tablets monthly)', interval '1 month'),
  ('Toddy (commercial)',      'clean',   'Deep clean + sanitize vessel and filter bag',                       interval '1 month'),
  ('Cold Brew Avenue vessel', 'clean',   'Deep clean + inspect basket, seals and tap',                        interval '1 month'),
  ('Corny kegs (5 gal)',      'service', 'Sanitize, inspect and replace O-rings / poppets as needed',          interval '3 months'),
  ('Nitrogen system (N2)',    'inspect', 'N2 leak-check + regulator inspection',                               interval '1 month'),
  ('Nitrogen system (N2)',    'inspect', 'DOT hydrostatic test of N2 tank (5-year requirement)',               interval '5 years'),
  ('Nitro tap (stout faucet)','clean',   'Disassemble + clean stout faucet and restrictor plate',              interval '14 days')
) as x(asset_name, kind, summary, cadence)
join public.assets a on a.name = x.asset_name
where not exists (
  select 1 from public.asset_maintenance am where am.asset_id = a.id and am.summary = x.summary
);
