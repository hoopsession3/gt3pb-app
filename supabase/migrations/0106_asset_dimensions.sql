-- 0106 — give assets physical dimensions so the load-out space agent can cross-reference the REAL
-- gear (exact volume) instead of keyword estimates. L×W×H in inches + weight in lb; volume is derived
-- in code. Only the TRANSPORTABLE gear is dimensioned here (lab/bench gear that never leaves the
-- building stays null and the load-out ignores it). Big-item dimensions researched from the
-- manufacturer/retailer; table/shelf dimensions taken from the model name; cart is a packed estimate.

alter table public.assets add column if not exists len_in    numeric;  -- longest side, inches
alter table public.assets add column if not exists width_in  numeric;
alter table public.assets add column if not exists height_in numeric;
alter table public.assets add column if not exists weight_lb numeric;

-- helper: set dims for an asset matched by name (no-op if that asset isn't present)
do $$
declare
  d record;
begin
  for d in
    select * from (values
      -- name (exact),                                                  len,   wid,   hei,   wt
      ('Summit Commercial Nitro & Cold-Brew Kegerator/Dispenser',       26.25, 23.75, 51.5,  190),  -- Summit SBC682CMTWIN (researched)
      ('HP 4.9 cu ft Chest Freezer',                                    24.84, 21.89, 33.5,  59),    -- Hotpoint HCM5QWWW (researched + typical height)
      ('VEVOR 1500lb Poly Dump Cart',                                   48,    28,    24,    70),    -- packed estimate (tub ~38×22 + handle/wheels)
      ('Vevor Mophorn Stainless Work Table 36x24',                      36,    24,    35,    55),    -- from model name (35in std table height)
      ('Hally NSF Stainless Prep Table 24x48',                          48,    24,    35,    50),    -- from model name
      ('Sakugi 3-Tier Metal Storage Shelves',                           18,    12,    30,    15),    -- from model name (18x12x30)
      ('Tiken Airpot Coffee Dispenser 4L',                              8,     8,     15,    5),
      ('Kuhn Rikon Duromatic 12L Pressure Cooker',                      11,    11,    13,    10),
      ('Generator Power Kit (adapter + 50A cord)',                      16,    10,    6,     20)
    ) as t(nm, l, w, h, wt)
  loop
    update public.assets
       set len_in = d.l, width_in = d.w, height_in = d.h, weight_lb = d.wt, updated_at = now()
     where name = d.nm and len_in is null;
  end loop;
end $$;
