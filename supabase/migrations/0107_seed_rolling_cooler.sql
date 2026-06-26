-- 0107 — add the new red wheeled cooler to the gear register so the load-out accounts for it.
-- Dimensions are a packed ESTIMATE for a large wheeled cooler with the telescoping handle collapsed
-- (~28×17×18 in ≈ 5 cu ft); tune to the tape in Gear & manuals → Edit → Load-out size.
insert into public.assets (tenant_id, name, make_model, brand, category, use_case, kb_status, qty, len_in, width_in, height_in, weight_lb, notes)
select '00000000-0000-0000-0000-000000000001',
       'Rolling Cooler (red, wheeled)',
       'Large wheeled hard cooler with telescoping pull handle',
       'GT3 Performance Bar',
       array['Event Equipment']::text[],
       'Cold-hold + transport for bottles/ingredients; rolls from the vehicle to the booth.',
       'Drafted', 1, 28, 17, 18, 17,
       'Dimensions are an estimate (handle collapsed) — measure and update in the load-out size field.'
where not exists (select 1 from public.assets where name = 'Rolling Cooler (red, wheeled)');
