-- 0056 — Studio v1.1: hold the Canva design + export + Webflow publish results on the piece.
-- Apply after 0055. Idempotent.

alter table public.content_items add column if not exists canva_design_id text;
alter table public.content_items add column if not exists canva_edit_url  text;   -- open in Canva to finish the design
alter table public.content_items add column if not exists export_url      text;   -- exported PNG/PDF (the finished graphic)
alter table public.content_items add column if not exists webflow_item_id text;
alter table public.content_items add column if not exists published_url    text;   -- live URL after Webflow publish
