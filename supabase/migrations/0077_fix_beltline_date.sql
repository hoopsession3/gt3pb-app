-- 0077 — fix BeltLine date. It's June 27 (Saturday, World Cup weekend — same weekend as the
-- Mercedes-Benz show on the 28th), not July 27 as first entered. Targeted update by name.

update public.stops
   set starts_at = timestamptz '2026-06-27 11:00:00-04'
 where name = 'Atlanta BeltLine — World Cup Weekend';
