-- 0107 — add the new red wheeled cooler (YETI Roadie 48) to the gear register so the load-out
-- accounts for it. Dimensions are YETI's published exterior spec (handle collapsed): 20.1 L ×
-- 19.8 W × 20.6 H in (≈ 4.7 cu ft), 28.3 lb empty. Source: yeti.com Roadie 48 Wheeled Cooler.
insert into public.assets (tenant_id, name, make_model, brand, category, use_case, kb_status, qty, len_in, width_in, height_in, weight_lb, notes)
select '00000000-0000-0000-0000-000000000001',
       'YETI Roadie 48 Wheeled Cooler',
       'YETI Roadie 48 wheeled hard cooler, telescoping periscope handle (Rescue Red)',
       'GT3 Performance Bar',
       array['Event Equipment']::text[],
       'Cold-hold + transport for bottles/ingredients; rolls from the vehicle to the booth.',
       'Reviewed', 1, 20.1, 19.8, 20.6, 28.3,
       'YETI published exterior spec (handle collapsed). Interior ~14.5×11.4×15.8 in.'
where not exists (
  select 1 from public.assets where name in ('YETI Roadie 48 Wheeled Cooler', 'Rolling Cooler (red, wheeled)')
);
