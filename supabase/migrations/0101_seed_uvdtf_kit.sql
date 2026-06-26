-- 0101 — seed the UVDTF bottle-labeling kit into gear (assets) + the labels into inventory, with a
-- cold-apply how-to. UVDTF (UV Direct-To-Film) transfers are a HARD-SURFACE, NO-HEAT peel-and-stick —
-- that's how the bottle labels go on. The heat press / Teflon sheets are the separate DTF *apparel*
-- workflow (heat); seeded too so all the gear is tracked. Idempotent (by name / summary).

alter table public.asset_maintenance add column if not exists how_to text;

-- ── gear (assets) ──
insert into public.assets (name, make_model, brand, category, use_case, qty, notes)
select v.name, v.make_model, 'GT3 Performance Bar', '{labeling}'::text[], v.use_case, v.qty, v.notes
from (values
  ('UVDTF labeling station',  'Squeegee/card + 70% alcohol wipes', 'Apply UVDTF labels to bottles (cold, no heat)', 1, 'UVDTF = hard-surface peel-and-stick. No heat. Keep a card/squeegee + alcohol wipes + the alignment ruler here.'),
  ('HTVRONT Auto Heat Press 2','HTVRONT Auto Heat Press 2', 'DTF apparel / merch transfers (HEAT)', 1, 'For DTF garment transfers — NOT for UVDTF bottle labels (those are cold-apply). Time/temp per the transfer maker.'),
  ('PTFE Teflon sheets',       '3-pack PTFE Teflon sheet', 'Protective sheet for the heat press', 3, 'Reusable. Protects the platen + transfer when pressing apparel.'),
  ('Vowlove alignment ruler',  'Vowlove T-shirt / transfer ruler guide', 'Center + straighten a transfer before applying', 1, 'Use to place a label/transfer straight and centered.')
) as v(name, make_model, use_case, qty, notes)
where not exists (select 1 from public.assets a where a.name = v.name);

-- ── the consumable (inventory): UVDTF labels from Jiffy Land ──
insert into public.inventory_items (name, qty, qty_event_ready, reorder_point, status, unit, use_cases, required_for, critical, notes)
select 'UVDTF bottle labels (Jiffy Land)', 0, 0, 100, 'On Hand', 'label',
       '{bottles,labeling}'::text[], '{bottle service}'::text[], false,
       'Vendor: Jiffy Land. One label per bottle (10oz/16oz). Order ~5% spares for misapplies. UVDTF = cold peel-and-stick on clean glass.'
where not exists (select 1 from public.inventory_items i where i.name = 'UVDTF bottle labels (Jiffy Land)');

-- ── the how-to (cold UVDTF application to a bottle) ──
insert into public.asset_maintenance (asset_id, kind, performed_on, summary, how_to, next_due_on, performed_by)
select a.id, 'how_to', current_date, 'Apply UVDTF labels to bottles',
  E'UVDTF is a COLD, no-heat, hard-surface transfer — perfect for glass bottles. Per bottle:\n1) The bottle must be clean, dry and at room temp. Wipe the spot with a 70% alcohol wipe and let it flash off — any oil/film and it will lift later.\n2) A UVDTF transfer has two layers: the printed design on a backing, plus a clear top "application" film. Make sure the design is fully stuck to the clear top film: rub the whole transfer with a card, then SLOWLY peel away the paper/backing layer, leaving the design on the clear film.\n3) Line it up. Use the alignment ruler to place it straight and centered on the bottle; on a round bottle, touch the center down first.\n4) Lay it down from the center outward, smoothing as you go so no air bubbles get trapped. Curved glass: ease it around, don''t stretch it.\n5) Burnish HARD — rub every part of the design firmly with the squeegee/card (edges + small details especially). This is what makes it stick.\n6) SLOWLY peel the clear top film back at a low angle. If any part of the design lifts with the film, lay it back, burnish that spot again, and re-peel.\n7) Press the edges down once more with your finger. Let it sit ~24 hrs before heavy handling/refrigeration for the strongest bond.\nNOTE: UVDTF needs NO heat press. The heat press + Teflon sheets are for DTF *apparel* transfers, a different job.',
  null, 'GT3'
from public.assets a
where a.name = 'UVDTF labeling station'
  and not exists (select 1 from public.asset_maintenance am where am.asset_id = a.id and am.summary = 'Apply UVDTF labels to bottles');
