-- 0086 — brew production log fields. brew_batches already holds the run (recipe, vessel, gallons,
-- brew/ready times, OG, Signal Score, yield, status); a real "GT3 Brew Lab Production" log also needs
-- traceability: which coffee lot went in, who brewed it, and the sensory notes. Add those so every
-- batch is a permanent, recallable production record (the due-diligence story).

alter table public.brew_batches add column if not exists coffee_lot  text;  -- bean origin + roast date / lot # (traceability)
alter table public.brew_batches add column if not exists brewer      text;  -- who brewed it
alter table public.brew_batches add column if not exists taste_notes text;  -- sensory / cupping notes
