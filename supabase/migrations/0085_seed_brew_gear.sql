-- 0085 — seed brew gear as assets + baseline maintenance cadences.
-- Populates the Asset Maintenance log from day one: the grinder, the brewing vessels, kegs, and the
-- CO2 system, each with a first dated entry whose next_due_on sets the recurring cadence. Dates are
-- relative to when this runs (deploy), so "due in a month" means a month from go-live. Idempotent:
-- assets seeded by name, each cadence entry seeded once (by asset + summary).

-- ── 0) ensure the how_to column exists (added here, not in 0083, so it lands whether or not 0083
--    was already applied before this how-to work existed) ──
alter table public.asset_maintenance add column if not exists how_to text;

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

-- ── 2) baseline maintenance entries (set the cadence + a beginner how-to) ──
-- Each entry carries next_due_on (the cadence) and a step-by-step how_to written assuming zero prior
-- knowledge — one step per line. Seeded once per (asset, summary).
insert into public.asset_maintenance (asset_id, kind, performed_on, summary, how_to, next_due_on, performed_by)
select a.id, x.kind, current_date, x.summary, x.how_to, (current_date + x.cadence)::date, 'GT3'
from (values
  ('Timemore grinder', 'clean', 'Deep clean burrs + chamber', interval '1 month', E'1) Unplug it (if electric). Empty the bean hopper and the grounds cup.\n2) Take the top off per the manual — usually unscrew the hopper and lift out the upper burr.\n3) With the dry brush (no water), sweep all grounds and oily dust out of BOTH burrs and the chamber, working top-down so it falls out.\n4) Once a month, run a capful of grinder cleaning tablets (e.g. Grindz) through, then grind a small scoop of coffee to push any residue out.\n5) Wipe the outside with a dry or barely-damp cloth. NEVER rinse the burrs with water — steel burrs rust.\n6) Reassemble, set the coarse setting, pulse-grind a little coffee to re-season before your next batch.'),

  ('Toddy (commercial)', 'clean', 'Deep clean + sanitize vessel and filter', interval '1 month', E'1) Lift out the filter and discard the grounds. Rinse the cloth/paper filter in warm water only — NO soap on a cloth filter (it holds the taste). Store it wet in clean water in the fridge per Toddy.\n2) Empty and rinse the brewing vessel.\n3) Wash the vessel with warm water and a mild, unscented food-safe detergent using a soft brush — no abrasive pads inside.\n4) Rinse until there are zero suds.\n5) Sanitize: mix a no-rinse food-grade sanitizer (Star San per label), coat the inside 1–2 minutes, then drain. Do NOT rinse it off — no-rinse means no-rinse.\n6) Air-dry upside down on a clean rack. Store dry.'),

  ('Cold Brew Avenue vessel', 'clean', 'Deep clean + inspect basket, seals and tap', interval '1 month', E'1) Pull the filter basket out, dump and rinse the grounds.\n2) Wash the basket, lid and vessel with warm water + mild food-safe detergent and a soft brush.\n3) Open the bottom tap and run warm water + a thin bottle brush THROUGH it — gunk hides in the tap.\n4) Look at the tap gasket and any O-rings/seals: if they are cracked, stiff or flattened, replace them (cheap).\n5) Sanitize every part with no-rinse sanitizer (Star San), 1–2 min contact, then drain.\n6) Air-dry, reassemble, and check the tap closes fully with no drip.'),

  ('Corny kegs (5 gal)', 'service', 'Sanitize, inspect, replace O-rings / poppets', interval '3 months', E'1) RELIEVE THE PRESSURE first — pull the pressure-relief valve until it stops hissing — before you open the lid.\n2) Open the lid, dump, and rinse the inside with warm water.\n3) Wash inside with warm water + an unscented keg cleaner (PBW is the standard) and a soft brush. Clean the dip tubes too.\n4) Pull the gas and liquid posts (deep socket), take out the little poppets, and clean them and the dip tubes.\n5) Inspect the lid O-ring and the post O-rings. Replace any that are flat, cracked or that leaked — do it on schedule, they are cheap.\n6) Reassemble. Sanitize the whole keg with no-rinse sanitizer (Star San): add a little, seal, shake, then push it out through both posts. Drain.\n7) Store either bone-dry, or sealed with a few PSI and a splash of sanitizer so nothing grows.'),

  ('Nitrogen system (N2)', 'inspect', 'N2 leak-check + regulator inspection', interval '1 month', E'1) With the tank valve open and the system pressurized, brush soapy water on EVERY connection: tank-to-regulator, regulator-to-line, line-to-keg.\n2) Watch for bubbles growing = a leak. Tighten that fitting or replace its washer/O-ring, then test again.\n3) Read the gauges: the tank gauge shows how much N2 is left — if it is low, swap or refill the cylinder. Set the working pressure to your nitro spec.\n4) Make sure the cylinder is chained/strapped upright so it cannot fall (a falling tank is dangerous).\n5) Wipe off the soapy water and log the date.'),

  ('Nitrogen system (N2)', 'inspect', 'DOT hydrostatic test of N2 tank (5-yr)', interval '5 years', E'This is a legal safety test for the high-pressure cylinder — you do NOT do it yourself.\n1) Find the stamped date on the cylinder collar/neck. Cylinders must be hydro-tested every 5 years.\n2) When it is within ~6 months of 5 years, take it to your gas supplier — usually you just exchange it for a freshly-tested full one.\n3) Log the new test/exchange date so it is never overlooked.'),

  ('Nitro tap (stout faucet)', 'clean', 'Clean stout faucet + restrictor plate', interval '7 days', E'A clogged restrictor disc is the #1 cause of a flat, no-cascade nitro pour. Weekly:\n1) Turn off the gas and relieve the pressure.\n2) Unscrew the faucet from the shank and take the spout apart. The key part is the small RESTRICTOR DISC/PLATE with tiny holes, sitting just behind the spout.\n3) Soak all the parts in warm water with a little food-safe beer-line cleaner (BLC). Use the small brush/pin to clear EVERY tiny hole in the disc — blocked holes = no cascade.\n4) Rinse everything very well (BLC residue tastes bad).\n5) Reassemble snug and pour a test glass — you want a full cascade and a tight creamy head.\n6) DAILY in service: at minimum pull the spout and flush the disc with hot water.')
) as x(asset_name, kind, summary, cadence, how_to)
join public.assets a on a.name = x.asset_name
where not exists (
  select 1 from public.asset_maintenance am where am.asset_id = a.id and am.summary = x.summary
);
