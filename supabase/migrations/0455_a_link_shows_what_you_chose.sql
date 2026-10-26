-- ── 0455 — A LINK SHOWS WHAT YOU CHOSE ───────────────────────────────────────────────────────────────────────────────
-- 2026-10-26. Ryan, 2026-10-26: "every link currently shows all roadmap programs and all store layouts, not just the ones
-- you choose. Fix that as well." Paste into Supabase → SQL Editor → Run. A second run changes nothing. Needs 0454.
--
-- WHAT.
--   vision_shares.program_ids — the roadmap programs this link shows; layout_ids — the store rooms it shows. Before this,
--   vision_shared returned every program and every room in the business to anyone holding any link (plans were already
--   opt-in: only those marked shareable). Now a program, a program's asks and a room reach a link only when chosen for
--   it. A new link chooses nothing until its maker picks.
--   Existing links: on the first run only, each is given what it was evidently meant to show — the programs and rooms of
--   the plans marked to show on a link — so no live link goes blank. Programs and rooms with no shareable plan stop
--   showing. The owner can change either list on the link any time.
--   vision_shared — as 0454, with programs, program-level asks and rooms filtered by the link's choices.
--
-- set lock_timeout (database F16): two columns added (a constant default — no rewrite), one function replaced (same
-- signature).
-- existing rows: vision_shares — each existing link's two new lists set once, as above.
-- rollback: re-run 0454's vision_shared; alter table vision_shares drop column program_ids, drop column layout_ids.
-- changelog: none — links the owner sends.

set lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vision_shares' and column_name = 'program_ids') then
    alter table public.vision_shares add column program_ids uuid[] not null default '{}';
    alter table public.vision_shares add column layout_ids uuid[] not null default '{}';
    -- The first run only: what each existing link was meant to show.
    update public.vision_shares s set
      program_ids = coalesce((select array_agg(distinct v.program_id) from public.vision_plans v
                               where v.tenant_id = s.tenant_id and v.shareable and v.program_id is not null), '{}'),
      layout_ids  = coalesce((select array_agg(distinct v.layout_id) from public.vision_plans v
                               where v.tenant_id = s.tenant_id and v.shareable and v.layout_id is not null), '{}');
  end if;
end $$;

-- vision_shared, filtered by what the link was given.
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
      from public.vision_programs p where p.tenant_id = s.tenant_id and p.id = any(s.program_ids)), '[]'::jsonb),
    -- 0455: the programs this link was given, and no others.
    'asks', case when s.show_asks then coalesce((select jsonb_agg(jsonb_build_object(
        'program_id', a.program_id, 'plan_id', a.plan_id, 'label', a.label, 'amount_cents', a.amount_cents, 'state', a.state,
        'note', a.note, 'sort', a.sort) order by a.sort, a.created_at)
      from public.vision_asks a
      where a.tenant_id = s.tenant_id
        -- 0455: an ask on a program shows only with that program; an ask on a plan, only with a plan marked to show.
        and ((a.plan_id is null and a.program_id = any(s.program_ids)) or exists (select 1 from public.vision_plans x where x.id = a.plan_id and x.shareable))), '[]'::jsonb)
      else '[]'::jsonb end,
    'plans', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'program_id', v.program_id, 'name', v.name, 'format', v.format, 'phase', v.phase, 'status', v.status,
        'sqft', v.sqft, 'deal', v.deal, 'place', v.place, 'summary', v.summary, 'why', v.why, 'gate', v.gate,
        'layout_id', v.layout_id, 'sort', v.sort,
        -- 0454: who it's for, the market, how it stands apart — part of the plan, shown wherever the plan is.
        'customer', v.customer, 'market', v.market, 'positioning', v.positioning,
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
          from public.vision_research r where r.plan_id = v.id and r.status = 'accepted'), '[]'::jsonb) end,
        -- 0454: its risks and assumptions — with the case, where an owner chose this link to show it.
        'risks', case when v.id = any(s.money_plans) then coalesce((select jsonb_agg(jsonb_build_object(
            'kind', k.kind, 'words', k.words, 'likelihood', k.likelihood, 'impact', k.impact, 'mitigation', k.mitigation,
            'evidence', k.evidence, 'status', k.status) order by k.sort, k.created_at)
          from public.vision_plan_risks k where k.plan_id = v.id), '[]'::jsonb) end)
        order by v.phase, v.sort, v.created_at)
      from public.vision_plans v where v.tenant_id = s.tenant_id and v.shareable), '[]'::jsonb),
    'layouts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'name', l.name, 'width_in', l.width_in, 'depth_in', l.depth_in, 'ceiling_in', l.ceiling_in, 'notes', l.notes,
        'items', coalesce((select jsonb_agg(jsonb_build_object(
            'id', i.id, 'kind', i.kind, 'label', i.label, 'x_in', i.x_in, 'y_in', i.y_in, 'rot', i.rot,
            'w_in', i.w_in, 'd_in', i.d_in, 'h_in', i.h_in, 'why', i.why, 'pillars', i.pillars, 'sort', i.sort) order by i.sort, i.created_at)
          from public.store_items i where i.layout_id = l.id), '[]'::jsonb)) order by l.created_at)
      from public.store_layouts l where l.tenant_id = s.tenant_id and l.id = any(s.layout_ids)), '[]'::jsonb)
    -- 0455: the rooms this link was given, and no others.
  );
end $$;
revoke all on function public.vision_shared(text) from public, anon, authenticated;
grant execute on function public.vision_shared(text) to anon, authenticated;

-- verify (numbers only):
--   select count(*) from public.vision_shares where cardinality(program_ids) = 0 and cardinality(layout_ids) = 0;
select public.record_migration('0455_a_link_shows_what_you_chose');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
