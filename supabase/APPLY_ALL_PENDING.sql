-- ⚠️ NEVER include files from supabase/pending/ in this bundle — those are soak-gated (see
-- supabase/pending/0224_field_ops_contract.sql) and applying them early is irreversible.
--
-- ── GENERATED FILE — DO NOT EDIT BY HAND ─────────────────────────────────────────────────────
-- Regenerate with:  npm run migrations:pending -- --write
--
-- This file is the OUTPUT of comparing supabase/migrations/ against what production's ledger
-- (public.schema_migrations, via /api/migrations) says has actually been applied. Its previous
-- hand-maintained version said "apply all pending migrations" and stopped at 0035 while this
-- directory held 326 files — wrong by 291 migrations, referenced by nothing, checked by nothing.
--
-- The line below is what stops that happening again: scripts/drift.check.mjs fails the release
-- if supabase/migrations/ ever holds a migration numbered above it.
--
-- EACH MIGRATION IS ITS OWN TRANSACTION (R32 — the 10/10 audit, DB11-04 and OPS11-03). A paste runs as one transaction
-- unless it says otherwise, so a lock one migration took was held to the end of all of them, and one that stopped took
-- the others back with it. Each section below is wrapped in its own begin … commit: its locks end with it, and if one
-- stops (a busy table's lock wait ran out), the ones above it stay applied and nothing below it runs — paste the file
-- again a moment later; a migration already applied changes nothing the second time.
-- pending-from: 0442
-- generated-at: 2026-10-20
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0424_a_password_set_before_the_proof_waits_for_it_everywhere.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0442_the_course_is_bought_and_the_pillars_are_given.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0441_a_lessons_preview_is_anyones.sql
-- ============================================================
begin;   -- 0441, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
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
commit;  -- 0441
