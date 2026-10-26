-- ── 0451 — THE INVESTOR CASE ──────────────────────────────────────────────────────────────────────────────────────
-- 2026-10-25. R57, phase E of the investor-ready vision (Ryan, 2026-10-25: "investor presentation with expiring share
-- links… everything an investor wants to see"). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
-- Needs 0450.
--
-- WHAT.
--   vision_shares.money_plans / research_plans — per link, per plan, what it may show beyond the plan itself: the plan's
--   money (its approved baseline only — never the working what-ifs) and its research (accepted findings only, each with
--   its source). Nothing by default: an existing link shows exactly what it showed before. Only an owner may choose
--   (a trigger refuses anyone else, PT403) — the same owners who approve a baseline. The presenter computes the case from
--   the baseline with the one engine (lib/visionMoney), so the link and the app can't disagree.
--   vision_shared — as 0448, plus each plan's "money" and "research" where the link was given them.
--
-- set lock_timeout (database F16): two columns added (constant default — no rewrite), one trigger, one function
-- replaced (same signature).
-- existing rows: none changed (the new columns are empty for every link).
-- rollback: drop trigger vision_share_case_guard_tg on vision_shares; drop function vision_share_case_guard(); alter
--   table vision_shares drop column money_plans, drop column research_plans; re-run 0448's vision_shared.
-- changelog: none — links the owner sends.

set lock_timeout = '5s';

alter table public.vision_shares add column if not exists money_plans uuid[] not null default '{}';
alter table public.vision_shares add column if not exists research_plans uuid[] not null default '{}';

create or replace function public.vision_share_case_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and (cardinality(new.money_plans) > 0 or cardinality(new.research_plans) > 0))
     or (tg_op = 'UPDATE' and (new.money_plans is distinct from old.money_plans or new.research_plans is distinct from old.research_plans)) then
    if auth.uid() is not null and not public.is_owner() then
      raise exception 'Only an owner can choose what a link shows of the money.' using errcode = 'PT403';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.vision_share_case_guard() from public, anon, authenticated;
drop trigger if exists vision_share_case_guard_tg on public.vision_shares;
create trigger vision_share_case_guard_tg before insert or update on public.vision_shares for each row execute function public.vision_share_case_guard();

create or replace function public.vision_shared(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.vision_shares;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  select * into s from public.vision_shares
   where token = p_token and revoked_at is null and (expires_at is null or expires_at > now());
  if not found then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  update public.vision_shares set opens = opens + 1, last_opened_at = now() where id = s.id;
  return jsonb_build_object(
    'label', s.label,
    'show_asks', s.show_asks,
    'expires_at', s.expires_at,
    'programs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'lane', p.lane, 'title', p.title, 'summary', p.summary, 'why', p.why, 'pillars', p.pillars,
        'horizon', p.horizon, 'status', p.status, 'start_on', p.start_on, 'target_on', p.target_on, 'emoji', p.emoji,
        'layout_id', p.layout_id, 'sort', p.sort) order by p.horizon, p.sort, p.created_at)
      from public.vision_programs p where p.tenant_id = s.tenant_id), '[]'::jsonb),
    'asks', case when s.show_asks then coalesce((select jsonb_agg(jsonb_build_object(
        'program_id', a.program_id, 'plan_id', a.plan_id, 'label', a.label, 'amount_cents', a.amount_cents, 'state', a.state,
        'note', a.note, 'sort', a.sort) order by a.sort, a.created_at)
      from public.vision_asks a
      where a.tenant_id = s.tenant_id
        and (a.plan_id is null or exists (select 1 from public.vision_plans x where x.id = a.plan_id and x.shareable))), '[]'::jsonb)
      else '[]'::jsonb end,
    'plans', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'program_id', v.program_id, 'name', v.name, 'format', v.format, 'phase', v.phase, 'status', v.status,
        'sqft', v.sqft, 'deal', v.deal, 'place', v.place, 'summary', v.summary, 'why', v.why, 'gate', v.gate,
        'layout_id', v.layout_id, 'sort', v.sort,
        'needs', coalesce((select jsonb_agg(jsonb_build_object('label', n.label, 'kind', n.kind, 'due_on', n.due_on, 'done_on', n.done_on, 'sort', n.sort)
            order by n.sort, n.created_at) from public.vision_plan_needs n where n.plan_id = v.id), '[]'::jsonb),
        'waits_on', coalesce((select jsonb_agg(d.needs_plan_id) from public.vision_plan_deps d
            join public.vision_plans w on w.id = d.needs_plan_id and w.shareable where d.plan_id = v.id), '[]'::jsonb),
        -- 0451: the plan's money, only its owner-approved baseline, only where an owner chose this link to show it.
        'money', case when v.id = any(s.money_plans) then (select jsonb_build_object('baseline', m.baseline, 'approved_at', m.baseline_at)
            from public.vision_plan_money m where m.plan_id = v.id and m.baseline is not null) end,
        -- 0451: its research — accepted findings only, each with its source — where an owner chose this link to show it.
        'research', case when v.id = any(s.research_plans) then coalesce((select jsonb_agg(jsonb_build_object(
            'topic', r.topic, 'claim', r.claim, 'figure', r.figure, 'source_url', r.source_url, 'source_title', r.source_title,
            'published', r.published, 'bearing', r.bearing, 'retrieved_at', r.retrieved_at) order by r.topic, r.retrieved_at desc)
          from public.vision_research r where r.plan_id = v.id and r.status = 'accepted'), '[]'::jsonb) end)
        order by v.phase, v.sort, v.created_at)
      from public.vision_plans v where v.tenant_id = s.tenant_id and v.shareable), '[]'::jsonb),
    'layouts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'name', l.name, 'width_in', l.width_in, 'depth_in', l.depth_in, 'ceiling_in', l.ceiling_in, 'notes', l.notes,
        'items', coalesce((select jsonb_agg(jsonb_build_object(
            'id', i.id, 'kind', i.kind, 'label', i.label, 'x_in', i.x_in, 'y_in', i.y_in, 'rot', i.rot,
            'w_in', i.w_in, 'd_in', i.d_in, 'h_in', i.h_in, 'why', i.why, 'pillars', i.pillars, 'sort', i.sort) order by i.sort, i.created_at)
          from public.store_items i where i.layout_id = l.id), '[]'::jsonb)) order by l.created_at)
      from public.store_layouts l where l.tenant_id = s.tenant_id), '[]'::jsonb)
  );
end $$;
revoke all on function public.vision_shared(text) from public, anon, authenticated;
grant execute on function public.vision_shared(text) to anon, authenticated;

-- verify (numbers only):
--   select count(*) from public.vision_shares where cardinality(money_plans) > 0;   -- 0 (first run)
select public.record_migration('0451_the_investor_case');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
