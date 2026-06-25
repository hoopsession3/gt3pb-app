-- 0095 — STOP MENU. Make a truck stop carry the same menu/rig/site flags an event does, so
-- "Generate pack list from menu" works identically for a stop. Mirrors the event menu columns
-- (0024-era) exactly, so packListFor() can run off a stop row unchanged.

alter table public.stops add column if not exists rig               text;     -- 'cart' | 'trailer_plus_cart'
alter table public.stops add column if not exists power_available   boolean;  -- null = unknown
alter table public.stops add column if not exists water_available   boolean;
alter table public.stops add column if not exists menu_nitro        boolean not null default false;
alter table public.stops add column if not exists menu_nature_aid   boolean not null default false;
alter table public.stops add column if not exists menu_salted_maple boolean not null default false;
alter table public.stops add column if not exists menu_bottles      boolean not null default false;
alter table public.stops add column if not exists menu_broth        boolean not null default false;
