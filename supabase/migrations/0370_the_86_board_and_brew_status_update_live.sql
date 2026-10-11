-- ── 0370 — THE 86 BOARD AND BREW STATUS UPDATE LIVE ───────────────────────────────────────────────────
-- 2026-10-11 (the audit of the kitchen display, "the Pass").
--
-- Supabase sends a screen a table's changes only when two switches are on: the page subscribes (useRealtimeTable),
-- and the table is in the supabase_realtime publication. 0248 found the second switch off once before — customers,
-- with 34 other tables in the publication and the Customer book silently stale. Two more were never added:
--
--   products      the 86 board under the pass (components/EightySix) flips sold_out, and the pass (app/crew), the
--                 menu, the drink sheet and checkout (lib/availability) and the perks and codes panels
--                 (components/useBenefitProducts) subscribe to it: an item 86'd on one phone stayed on sale on every
--                 other screen until somebody reloaded it;
--   brew_batches  the brew board (components/DropOps), the crew calendar and an event's or a stop's prep screen
--                 (app/crew, PrepDetail) subscribe to it: a brew started, ready or bottled on one device did not move
--                 on another.
--
-- Both join the publication the way 0357 and 0359 add theirs: each only if it is not a member already, and only if
-- the publication exists, so this runs the same on a database without realtime and runs twice without error.
--
-- What a screen is sent follows each table's own read rules, which do not change: realtime checks every inserted or
-- updated row against the subscriber's policies, so products' active rows reach anyone and the rest only the crew
-- (0062), and brew_batches reaches only the crew (0079). A delete, which no policy can check, is sent as the row's id
-- alone — as it is for every table already in the publication.

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['products', 'brew_batches'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The 86 board and brew status update on every screen','fix','Crew',
   'An item 86''d on one phone stayed on sale everywhere else — the pass, the menu, the drink sheet — until someone reloaded the page, and a brew started, ready or bottled on one device did not move on another. Both now change on every open screen the moment they change.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('products', 'brew_batches');
--     -- two rows
select public.record_migration('0370_the_86_board_and_brew_status_update_live');
