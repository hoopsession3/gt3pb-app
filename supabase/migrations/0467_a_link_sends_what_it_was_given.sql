-- ── 0467 — A LINK SENDS WHAT IT WAS GIVEN (IMS7 security correction, link-specific disclosure) ────────────────────────
-- 2026-11-01. Ryan, after 0464's release checks: "A link must return only the programs, plans, needs, asks, rooms, and
-- related data explicitly authorized for that particular link. Do not assume that all plans belonging to the same
-- business — or even the same program — are automatically authorized… Ensure authorization is enforced at the database
-- response boundary." And: "An investor link should transmit exactly what I authorized for that investor — not
-- everything the application happens to know." Needs 0464 (it reuses 0464's helpers). A second run changes nothing.
--
-- THE GAP (found checking 0464; live since 0448/0455). vision_shared sent every plan of the business marked "Show it on
-- a link" — its words (name, where, what it is, why, the gate, who it's for, the market, how it stands apart), its needs,
-- and the asks on it — to every link, whichever programs the link was given. The link's screens walked only the link's
-- programs, so those plans never showed; the data still arrived, readable in a browser. Money and research were already
-- per link and per plan (0451).
--
-- WHAT CHANGES.
--   · vision_shares.plan_ids — the plans this link shows, chosen per link. A plan is sent only when it is on the link,
--     marked "Show it on a link", in the link's business, AND in a program the link was given. Nothing else qualifies:
--     not the business, not the program.
--   · vision_shares.need_plans — whose open needs this link shows, chosen per link (a subset of plan_ids in effect).
--   · money and research stay per link and per plan (0451) — and now only for a plan the link shows.
--   · asks: only with "show where capital may be needed", and only on a program the link was given (an ask with no plan)
--     or on a plan the link shows. waits_on: only plans the link shows. A program's or plan's room: its id only when the
--     link was given that room.
--   · fields no investor screen reads, no longer sent (Ryan: "unless a documented investor requirement justifies
--     retaining them"): a traffic channel's label, a research finding's publication date, a risk's evidence.
--   · vision_share_payload(link) — what a link sends, in one place. vision_shared answers a token with it; the new
--     vision_share_preview answers an owner or admin with it for a link (theirs) or a link not made yet, so the preview a
--     person reads before sharing IS the response, not a guess at it. The payload is called by nobody directly.
--
-- EXISTING LINKS (first run only). Each keeps the plans an owner chose for it by name — those whose money or research it
-- was given — and nothing else; no link keeps needs. A plan a link only carried because it was marked to show, or a need
-- under it, is no longer sent until someone ticks it on that link. Pins and approved versions are not touched; money
-- and research a link was given still reach it where its plan is in a program it was given (where it isn't, no screen
-- showed it). Measured in production before pasting: IMS7-0467-MANIFEST.md (a count, no names).
--
-- set lock_timeout (database F16): two columns added (constant default — no rewrite), backfilled on the first run; four
-- functions replaced or added; no policy changed. vision_share_preview is a new SECURITY DEFINER function granted to
-- authenticated (definerExec +1 at the next security snapshot); it refuses anyone but an owner or admin (is_admin, which
-- asks for two-step) and reads only the caller's business.
-- rollback: re-run 0464 (its vision_shared and helpers); drop function public.vision_share_preview(uuid, jsonb),
--   public.vision_share_payload(public.vision_shares); alter table vision_shares drop column plan_ids, drop column need_plans.
-- changelog: none — links the owner sends; what changes is what reaches the person holding one.

set lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vision_shares' and column_name = 'plan_ids') then
    alter table public.vision_shares add column plan_ids uuid[] not null default '{}';
    alter table public.vision_shares add column need_plans uuid[] not null default '{}';
    -- The first run only: each existing link keeps the plans an owner chose for it by name, nothing more.
    update public.vision_shares s set plan_ids = coalesce((select array_agg(distinct x) from unnest(s.money_plans || s.research_plans) as u(x)), '{}');
  end if;
end $$;

-- 0464's scenario, less a traffic channel's label (no investor screen reads it). Everything else as 0464.
create or replace function public.vision_share_scenario(v jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select case when jsonb_typeof(v) = 'object' then
    public.vision_share_keep(v, array['ordersPerDay','avgOrderCents','daysOpenPerMonth','hoursOpenPerDay','rampMonths','rampStartPct',
      'growthPctPerYear','cogsPct','cardFeePct','staffHoursPerDay','wageCents','laborBurdenPct','rentCents','rentPctOfSales',
      'otherOpexCents','marketingCents','ownerCashCents','repeatPerMonth','keptPct','peakFactor','slowFactor','serveSec',
      'demandFrom','capToRoom','mixDrives','itemsPerOrder'])
    || jsonb_build_object(
      'uses', public.vision_share_list(v -> 'uses', array['id','label','category','qty','unitCents','confidence','on']),
      'channels', public.vision_share_list(v -> 'channels', array['kind','reach','convertPct','costCents','startMonth']),
      'mix', public.vision_share_list(v -> 'mix', array['key','label','sharePct','priceCents','unitCostCents','packagingCents']))
  end
$$;
revoke all on function public.vision_share_scenario(jsonb) from public, anon, authenticated;

-- What a link sends: the one place it's decided. Invoker — called by vision_shared and vision_share_preview (both owned
-- by the database owner) and by nobody else.
create or replace function public.vision_share_payload(s public.vision_shares)
returns jsonb language sql stable set search_path = public as $$
  with shown as (
    -- The plans this link shows: on the link, marked to show, this business's, in a program the link was given.
    select v.* from public.vision_plans v
     where v.tenant_id = s.tenant_id and v.shareable and v.id = any(s.plan_ids) and v.program_id = any(s.program_ids)
  )
  select jsonb_build_object(
    'label', s.label,
    'show_asks', s.show_asks,
    'expires_at', s.expires_at,
    'pinned_at', s.pinned_at,
    'programs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'lane', p.lane, 'title', p.title, 'summary', p.summary, 'why', p.why, 'pillars', p.pillars,
        'horizon', p.horizon, 'status', p.status, 'start_on', p.start_on, 'target_on', p.target_on, 'emoji', p.emoji,
        'layout_id', case when p.layout_id = any(s.layout_ids) then p.layout_id end, 'sort', p.sort) order by p.horizon, p.sort, p.created_at)
      from public.vision_programs p where p.tenant_id = s.tenant_id and p.id = any(s.program_ids)), '[]'::jsonb),
    'asks', case when s.show_asks then coalesce((select jsonb_agg(jsonb_build_object(
        'program_id', a.program_id, 'plan_id', a.plan_id, 'label', a.label, 'amount_cents', a.amount_cents, 'state', a.state,
        'note', a.note, 'sort', a.sort) order by a.sort, a.created_at)
      from public.vision_asks a
      where a.tenant_id = s.tenant_id
        and ((a.plan_id is null and a.program_id = any(s.program_ids)) or a.plan_id in (select id from shown))), '[]'::jsonb)
      else '[]'::jsonb end,
    'plans', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'program_id', v.program_id, 'name', v.name, 'format', v.format, 'phase', v.phase, 'status', v.status,
        'sqft', v.sqft, 'deal', v.deal, 'place', v.place, 'summary', v.summary, 'why', v.why, 'gate', v.gate,
        'layout_id', case when v.layout_id = any(s.layout_ids) then v.layout_id end, 'sort', v.sort,
        'customer', coalesce(pv.plan->>'customer', v.customer), 'market', coalesce(pv.plan->>'market', v.market),
        'positioning', coalesce(pv.plan->>'positioning', v.positioning),
        'needs', case when v.id = any(s.need_plans) then coalesce((select jsonb_agg(jsonb_build_object('label', n.label, 'kind', n.kind, 'due_on', n.due_on, 'done_on', n.done_on, 'sort', n.sort)
            order by n.sort, n.created_at) from public.vision_plan_needs n where n.plan_id = v.id), '[]'::jsonb) else '[]'::jsonb end,
        'waits_on', coalesce((select jsonb_agg(d.needs_plan_id) from public.vision_plan_deps d
            where d.plan_id = v.id and d.needs_plan_id in (select id from shown)), '[]'::jsonb),
        -- 0451/0458: the approved version in force at the pin, only where this link was given the plan's money.
        'money', case when v.id = any(s.money_plans) and pv.id is not null then jsonb_build_object('baseline', public.vision_share_baseline(pv.baseline), 'approved_at', pv.approved_at, 'version', pv.version) end,
        'research', case when v.id = any(s.research_plans) then public.vision_share_list(coalesce(pv.research, (select jsonb_agg(jsonb_build_object(
            'topic', r.topic, 'claim', r.claim, 'figure', r.figure, 'source_url', r.source_url, 'source_title', r.source_title,
            'bearing', r.bearing, 'retrieved_at', r.retrieved_at) order by r.topic, r.retrieved_at desc)
          from public.vision_research r where r.plan_id = v.id and r.status = 'accepted' and r.retrieved_at <= s.pinned_at), '[]'::jsonb),
          array['topic','claim','figure','source_url','source_title','bearing','retrieved_at']) end,
        'risks', case when v.id = any(s.money_plans) and pv.id is not null then public.vision_share_list(pv.risks, array['kind','words','likelihood','impact','mitigation','status']) end)
        order by v.phase, v.sort, v.created_at)
      from shown v
      left join lateral (select x.* from public.vision_plan_versions x
                          where x.plan_id = v.id and x.approved_at <= s.pinned_at order by x.version desc limit 1) pv on true), '[]'::jsonb),
    'layouts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'name', l.name, 'width_in', l.width_in, 'depth_in', l.depth_in, 'ceiling_in', l.ceiling_in,
        'items', coalesce((select jsonb_agg(jsonb_build_object(
            'id', i.id, 'kind', i.kind, 'label', i.label, 'x_in', i.x_in, 'y_in', i.y_in, 'rot', i.rot,
            'w_in', i.w_in, 'd_in', i.d_in, 'h_in', i.h_in, 'why', i.why, 'pillars', i.pillars, 'sort', i.sort) order by i.sort, i.created_at)
          from public.store_items i where i.layout_id = l.id), '[]'::jsonb)) order by l.created_at)
      from public.store_layouts l where l.tenant_id = s.tenant_id and l.id = any(s.layout_ids)), '[]'::jsonb)
  )
$$;

revoke all on function public.vision_share_payload(public.vision_shares) from public, anon, authenticated;

-- The door, by token: as 0464, its answer now vision_share_payload.
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
  return public.vision_share_payload(s);
end $$;
revoke all on function public.vision_shared(text) from public, anon, authenticated;
grant execute on function public.vision_shared(text) to anon, authenticated;

-- What a link sends, for the person about to send it: a link of their business (p_share), or one not made yet (p_draft:
-- the columns the app would insert). Owners and admins only; a draft is pinned to now, as a new link is, and carries no
-- money or research unless an owner asks (only an owner may give a link those, 0451). Counts no open.
create or replace function public.vision_share_preview(p_share uuid default null, p_draft jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.vision_shares;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only an owner or an admin can see what a link sends.' using errcode = 'PT403';
  end if;
  if p_share is not null then
    select * into s from public.vision_shares where id = p_share and tenant_id = public.effective_tenant();
    if not found then raise exception 'No such link.' using errcode = 'PT404'; end if;
  else
    s := jsonb_populate_record(null::public.vision_shares, case when jsonb_typeof(p_draft) = 'object' then p_draft else '{}'::jsonb end);
    s.tenant_id := public.effective_tenant();
    s.pinned_at := now();
    s.expires_at := null;
    s.label := coalesce(nullif(btrim(s.label), ''), 'A link');
    s.show_asks := coalesce(s.show_asks, false);
    s.program_ids := coalesce(s.program_ids, '{}'); s.plan_ids := coalesce(s.plan_ids, '{}'); s.need_plans := coalesce(s.need_plans, '{}');
    s.layout_ids := coalesce(s.layout_ids, '{}'); s.money_plans := coalesce(s.money_plans, '{}'); s.research_plans := coalesce(s.research_plans, '{}');
    if not public.is_owner() then s.money_plans := '{}'; s.research_plans := '{}'; end if;
  end if;
  return public.vision_share_payload(s);
end $$;
revoke all on function public.vision_share_preview(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.vision_share_preview(uuid, jsonb) to authenticated;

-- verify, as an investor would read it: IMS7-0467-LIVE-CHECK.sql (counts and key names only, never a value).
select public.record_migration('0467_a_link_sends_what_it_was_given');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
