-- ── 0441 — A LESSON'S PREVIEW IS ANYONE'S ──────────────────────────────────────────────────────────────────────────
-- 2026-10-20. R45 (Ryan, 2026-10-20: "rookies shouldn't be free, only the pillars — light, stillness, movement, fuel";
-- the lessons locked with a preview kept). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. Once the course is bought (0442, held until GT3 Nutrition is for sale in the Shop), a stranger's read of
-- primal_lessons returns nothing — and the course map, the Today card, a locked lesson's page, the sitemap and a share
-- card would have nothing to show. What a lesson covers is what sells it.
--
-- WHAT. primal_lesson_previews(): every live lesson as anyone may see it before buying — its title, subtitle, level,
-- minutes and summary; never its body, key points or stack. Live lessons only, the caller's tenant only (a definer reads
-- past RLS, so it says both itself, as 0283's restrictive policy would). Additive: nothing anyone reads today changes,
-- except that a Pro lesson's title and summary are now seen before it is unlocked — which is the point.
--
-- set lock_timeout (database F16): one function made, one replaced (the stack's, with its gate).
-- existing rows: none.
-- changelog: none — the screens that read it say so when the course is bought (0442).

set lock_timeout = '5s';

-- what anyone may know before buying
create or replace function public.primal_lesson_previews()
returns table (id uuid, module_id uuid, slug text, title text, subtitle text, tier text, est_minutes int, summary text, sort int)
language sql stable security definer set search_path = '' as $$
  select l.id, l.module_id, l.slug, l.title, l.subtitle, l.tier, l.est_minutes, l.summary, l.sort
    from public.primal_lessons l
   where l.published_at is not null
     and l.archived_at is null
     and l.tenant_id = public.effective_tenant()
   order by l.sort, l.title;
$$;
revoke all on function public.primal_lesson_previews() from public, anon, authenticated;
grant execute on function public.primal_lesson_previews() to anon, authenticated;
comment on function public.primal_lesson_previews() is
  'Every live lesson of GT3 Nutrition as anyone may see it before buying (0441): title, subtitle, level, minutes, summary — never the body, key points or stack, which "primal lessons read" keeps for a live GT3 Nutrition purchase (program_access tier pro) and the crew.';

-- …and the drink stack a lesson recommends stays the lesson's. primal_menu_for_lesson (0272) reads it for any lesson id,
-- past RLS — safe while the only ids a stranger could hold were a free lesson's. The preview hands out every id, so it
-- asks what "primal lessons read" asks today (0272: a Rookie lesson is anyone's, a Pro lesson a member's); 0442 narrows
-- both together when the course is bought.
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
          and (
            l.tier = 'rookie'
            or exists (
              select 1 from public.program_access pa
              join public.customers c on c.id = pa.customer_id
              where c.user_id = (select auth.uid()) and pa.tier = l.tier and pa.revoked_at is null
            )
          )
      )
    )
  order by case upper(coalesce(p.timing, ''))
             when 'BEFORE' then 0 when 'DURING' then 1 when 'AFTER' then 2 else 3 end, lp.sort;
$$;

-- verify (numbers and booleans only):
--   select has_function_privilege('anon', 'public.primal_lesson_previews()', 'execute');                            -- t
--   select count(*) from public.primal_lesson_previews();                                                         -- the live lessons
select public.record_migration('0441_a_lessons_preview_is_anyones');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
