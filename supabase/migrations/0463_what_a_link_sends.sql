-- ── 0463 — WHAT A LINK SENDS, NOT ONLY WHAT IT SHOWS (IMS7, a security correction) ──────────────────────────────────
-- 2026-10-31. Ryan, 2026-10-31: "Treat this as a priority security correction… Remove unauthorized supplier sources,
-- internal notes, library identifiers… Apply filtering at the server/database boundary." A second run changes nothing.
--
-- THE GAP. vision_shared (0458) sent an investor link each chosen plan's approved baseline whole. The investor screens
-- draw totals and lines, never a line's own `source` (who quoted it — often a supplier) or `notes`, but the data reached
-- anyone holding the link, readable in a browser's network panel. A room's own notes (the crew's) went the same way.
-- Hiding a field on a screen isn't a boundary; this is.
--
-- WHAT CHANGES. One pure function, vision_share_baseline(jsonb): the baseline with every scenario's startup lines
-- (uses[]) stripped of `source`, `notes` and `libraryId`, and each scenario without its `fixtures` map (which library
-- assets the crew reconciled how — keyed by library id) — the line's label, category, quantity, unit cost and
-- confidence stay, so every total, the case and its diligence are worked out exactly as before. vision_shared is 0458's,
-- word for word, except: its money goes through vision_share_baseline, and its rooms no longer carry `notes`. Checked
-- and unchanged (it already sent none): recipes, the library and its research, the Standard, unaccepted research
-- (accepted only, as pinned), a placed thing's library link, a need's note, AI usage.
-- Kept on purpose (authorized investor content, unchanged): an owner's risk acceptance and its reason, which 0449/IP1.4
-- show investors on a link; the product mix's prices and costs, which the case's margins are worked out from; asks and
-- their notes, which an owner chooses to show (show_asks).
--
-- WHAT THIS CANNOT DO. It filters every read from now on — new links and links already given (a read is trimmed at
-- the door, whenever the link was made). It can't recall what an earlier read already delivered: anything opened before
-- this was applied may sit in someone's browser. Links stay as they were (revoked, expired: still refused; pinned:
-- still the same approved version).
--
-- set lock_timeout (database F16): two functions replaced or added; no table touched. existing rows: none changed.
-- rollback: re-run 0458's vision_shared; drop function public.vision_share_baseline(jsonb).
-- changelog: none — a security correction to the investor link's data; the screens are unchanged.

set lock_timeout = '5s';

create or replace function public.vision_share_baseline(b jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select case
    when b is null or jsonb_typeof(b) <> 'object' or jsonb_typeof(b -> 'scenarios') is distinct from 'object' then b
    else jsonb_set(b, '{scenarios}', coalesce((
      select jsonb_object_agg(k, case
        -- A scenario's own map of library assets to how they're reconciled (IMS7-D's `fixtures`) is the crew's: dropped.
        when jsonb_typeof(v) = 'object' and jsonb_typeof(v -> 'uses') = 'array' then jsonb_set(v - 'fixtures', '{uses}', coalesce((
          select jsonb_agg(case when jsonb_typeof(u) = 'object' then u - 'source' - 'notes' - 'libraryId' else u end order by n)
            from jsonb_array_elements(v -> 'uses') with ordinality as e(u, n)), '[]'::jsonb))
        when jsonb_typeof(v) = 'object' then v - 'fixtures'
        else v end)
        from jsonb_each(b -> 'scenarios') as s(k, v)), '{}'::jsonb))
  end
$$;
revoke all on function public.vision_share_baseline(jsonb) from public, anon, authenticated;

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
    -- 0458: the case this link shows is the one approved by this moment — an approval after it doesn't change the link.
    'pinned_at', s.pinned_at,
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
        -- 0454: who it's for, the market, how it stands apart. 0458: as approved with the pinned version, when there is one.
        'customer', coalesce(pv.plan->>'customer', v.customer), 'market', coalesce(pv.plan->>'market', v.market),
        'positioning', coalesce(pv.plan->>'positioning', v.positioning),
        'needs', coalesce((select jsonb_agg(jsonb_build_object('label', n.label, 'kind', n.kind, 'due_on', n.due_on, 'done_on', n.done_on, 'sort', n.sort)
            order by n.sort, n.created_at) from public.vision_plan_needs n where n.plan_id = v.id), '[]'::jsonb),
        'waits_on', coalesce((select jsonb_agg(d.needs_plan_id) from public.vision_plan_deps d
            join public.vision_plans w on w.id = d.needs_plan_id and w.shareable where d.plan_id = v.id), '[]'::jsonb),
        -- 0451: the plan's money, only its owner-approved baseline, only where an owner chose this link to show it.
        -- 0458: the approved VERSION in force when the link was pinned — never the baseline as it stands now.
        -- 0463: the baseline trimmed at the door (vision_share_baseline): each startup line without its source, notes or library link.
        'money', case when v.id = any(s.money_plans) and pv.id is not null then jsonb_build_object('baseline', public.vision_share_baseline(pv.baseline), 'approved_at', pv.approved_at, 'version', pv.version) end,
        -- 0451: its research — accepted findings only, each with its source — where an owner chose this link to show it.
        -- 0458: the findings accepted when the pinned version was approved; with no version, those read by the pin.
        'research', case when v.id = any(s.research_plans) then coalesce(pv.research, (select jsonb_agg(jsonb_build_object(
            'topic', r.topic, 'claim', r.claim, 'figure', r.figure, 'source_url', r.source_url, 'source_title', r.source_title,
            'published', r.published, 'bearing', r.bearing, 'retrieved_at', r.retrieved_at) order by r.topic, r.retrieved_at desc)
          from public.vision_research r where r.plan_id = v.id and r.status = 'accepted' and r.retrieved_at <= s.pinned_at), '[]'::jsonb) end,
        -- 0454: its risks and assumptions — with the case, where an owner chose this link to show it.
        -- 0458: the risks as they stood at the pinned approval.
        'risks', case when v.id = any(s.money_plans) and pv.id is not null then pv.risks end)
        order by v.phase, v.sort, v.created_at)
      from public.vision_plans v
      -- 0458: each plan's latest approved version at or before the link's pin (none if it wasn't approved by then).
      left join lateral (select x.* from public.vision_plan_versions x
                          where x.plan_id = v.id and x.approved_at <= s.pinned_at order by x.version desc limit 1) pv on true
      where v.tenant_id = s.tenant_id and v.shareable), '[]'::jsonb),
    'layouts', coalesce((select jsonb_agg(jsonb_build_object(
        -- 0463: a room's own notes are the crew's (the Studio's editing panel); no investor screen reads them.
        'id', l.id, 'name', l.name, 'width_in', l.width_in, 'depth_in', l.depth_in, 'ceiling_in', l.ceiling_in,
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
--   select count(*) from public.vision_shares where revoked_at is null;   -- unchanged
--   select (public.vision_share_baseline('{"scenarios":{"base":{"uses":[{"label":"x","source":"s"}]}}}') -> 'scenarios' -> 'base' -> 'uses' -> 0) ? 'source';   -- false
select public.record_migration('0463_what_a_link_sends');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
