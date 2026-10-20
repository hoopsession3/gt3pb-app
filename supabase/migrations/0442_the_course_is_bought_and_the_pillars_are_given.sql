-- ── 0442 — THE COURSE IS BOUGHT, AND THE PILLARS ARE GIVEN ──────────────────────────────────────────────────────────
-- 2026-10-20. R45 (Ryan, 2026-10-20: "rookies shouldn't be free, only the pillars — light, stillness, movement, fuel";
-- the lessons locked with a preview kept, and one GT3 Nutrition purchase opening all of it). Paste into Supabase → SQL
-- Editor → Run. A second run changes nothing. HELD (supabase/held.json) until GT3 Nutrition is for sale in the Shop:
-- applied before, nobody but the crew could open a lesson, and nobody could buy the way in.
--
-- WHY. 0272 made the course a funnel the other way round: a 'rookie' lesson open to anyone, a 'pro' lesson a member's.
-- GT3 Nutrition sells the course itself now. What is given away is the four pillar maps (public files, no database);
-- every lesson — Rookie and Pro alike — is the buyer's.
--
-- WHAT.
--   1. "primal lessons read": a published lesson is read by someone holding a live GT3 Nutrition purchase
--      (program_access tier 'pro', 0271 — the one product in the Shop), whatever the lesson's tier; staff read all. The
--      tier column stays: it is the course's level (Rookie first, then Pro), and the Rookie badge counts by it.
--   2. "primal lesson products read" mirrors it, so a locked lesson's stack doesn't leak through its products.
--   3. primal_menu_for_lesson (0272) asks the same as "primal lessons read" before it names a lesson's drinks, and is no
--      longer anon's.
--
-- set lock_timeout (database F16): two policies replaced, one function replaced. What anyone still sees of a lesson is
--   0441's preview.
-- existing rows: none changed. A reader who took a Rookie lesson for free keeps their progress rows; they open the
--   lesson again once they buy. How many that is: the second verify line (a count, no names).
-- changelog: below.

set lock_timeout = '5s';

-- 1 · the lessons are the buyer's
drop policy if exists "primal lessons read" on public.primal_lessons;
create policy "primal lessons read" on public.primal_lessons for select using (
  (select public.is_staff())
  or (
    published_at is not null and archived_at is null and exists (
      select 1 from public.program_access pa
      join public.customers c on c.id = pa.customer_id
      where c.user_id = (select auth.uid()) and pa.tier = 'pro' and pa.revoked_at is null
    )
  )
);

-- 2 · and so is each lesson's stack
drop policy if exists "primal lesson products read" on public.primal_lesson_products;
create policy "primal lesson products read" on public.primal_lesson_products for select using (
  (select public.is_staff())
  or exists (
    select 1 from public.primal_lessons l
    where l.id = lesson_id and l.published_at is not null and l.archived_at is null and exists (
      select 1 from public.program_access pa
      join public.customers c on c.id = pa.customer_id
      where c.user_id = (select auth.uid()) and pa.tier = 'pro' and pa.revoked_at is null
    )
  )
);

-- 3 · the drink stack a lesson recommends is the lesson's: primal_menu_for_lesson (0272) read it for any lesson id, past
-- RLS, because every id a stranger could hold was a free lesson's. 0441's previews hand out every id, so it asks what
-- "primal lessons read" asks — a buyer or the crew — and a signed-out caller no longer runs it (0401 kept it for anon
-- only because a Rookie lesson was read signed out).
create or replace function public.primal_menu_for_lesson(_lesson_id uuid)
returns table(product_slug text, name text, line text, timing text, price_cents int, accent text, rationale text, orderable boolean)
language sql stable security definer set search_path = public as $$
  select lp.product_slug, p.name, p.line, p.timing, p.price_cents, p.accent, lp.rationale,
         coalesce(p.active, false) as orderable
  from public.primal_lesson_products lp
  left join public.products p on p.slug = lp.product_slug
  where lp.lesson_id = _lesson_id
    and (
      (select public.is_staff())
      or exists (
        select 1 from public.primal_lessons l
        where l.id = _lesson_id and l.published_at is not null and l.archived_at is null
          and l.tenant_id = public.effective_tenant()
          and exists (
            select 1 from public.program_access pa
            join public.customers c on c.id = pa.customer_id
            where c.user_id = (select auth.uid()) and pa.tier = 'pro' and pa.revoked_at is null
          )
      )
    )
  order by case upper(coalesce(p.timing, ''))
             when 'BEFORE' then 0 when 'DURING' then 1 when 'AFTER' then 2 else 3 end, lp.sort;
$$;
revoke all on function public.primal_menu_for_lesson(uuid) from public, anon, authenticated;
grant execute on function public.primal_menu_for_lesson(uuid) to authenticated, service_role;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('GT3 Nutrition: the pillars are free, the course is yours when you buy it', 'improvement', 'GT3 Nutrition',
   'The Movement, Stillness, Light and Fuel maps are free to download. Every Return to Primal lesson — Rookie first — opens with one GT3 Nutrition purchase; before that, each lesson shows what it covers and how long it takes.',
   '2026-10-20', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(distinct pr.customer_id) from public.primal_progress pr where not exists (select 1 from public.program_access pa where pa.customer_id = pr.customer_id and pa.tier = 'pro' and pa.revoked_at is null);  -- readers who took a free lesson and haven't bought
--   select count(*) from pg_policies where tablename = 'primal_lessons' and policyname = 'primal lessons read' and qual like '%rookie%';  -- 0
--   select has_function_privilege('anon', 'public.primal_menu_for_lesson(uuid)', 'execute');                        -- f
select public.record_migration('0442_the_course_is_bought_and_the_pillars_are_given');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
