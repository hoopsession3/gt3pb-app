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
-- pending-from: 0472
-- generated-at: 2026-11-02
-- pending-count: 8
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- ============================================================
-- 0463_what_a_link_sends.sql
-- ============================================================
begin;   -- 0463, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
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
commit;  -- 0463

-- ============================================================
-- 0464_a_link_sends_named_fields_only.sql
-- ============================================================
begin;   -- 0464, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0464 — A LINK SENDS NAMED FIELDS ONLY (IMS7 security correction, the allow-list) ───────────────────────────────
-- 2026-11-01. Ryan's security review of 0463, 2026-10-31: "Ensure malformed or unexpected objects cannot bypass
-- sanitization. Prefer an explicit allowlist of authorized investor fields rather than removing only known confidential
-- fields." 0463 (on main, c47ce24) removed known fields — a line's source, notes and library link, a scenario's fixtures
-- map — and passed everything else through, malformed lines included. This replaces it with an allow-list. It works
-- whether 0463 was pasted first or not: both define vision_shared and vision_share_baseline, and this one wins. A
-- second run changes nothing.
--
-- THE GAP. vision_shared (0458) sent an investor link each chosen plan's approved baseline whole. The investor screens
-- draw totals and lines, never a line's own `source` (who quoted it — often a supplier) or `notes`, but the data reached
-- anyone holding the link, readable in a browser's network panel. A room's own notes (the crew's) went the same way.
-- Hiding a field on a screen isn't a boundary; this is.
--
-- WHAT CHANGES — AN ALLOW-LIST, NOT A DENY-LIST (Ryan's review, 2026-10-31: "Prefer an explicit allowlist of authorized
-- investor fields rather than removing only known confidential fields… malformed or unexpected objects cannot bypass
-- sanitization… new internal fields cannot automatically enter investor payloads"). What a link sends of a plan's
-- money, research and risks is built from named fields only, each a plain value (text, number, true/false or null —
-- never a nested object or array smuggled into a field):
--   · the baseline: scenarios (conservative, base, upside — no other name), structure, acknowledged; nothing else.
--   · a scenario: the money engine's own inputs (lib/visionMoney Inputs), by name; its startup lines, traffic channels
--     and product mix as arrays of objects with their named fields — a line keeps id, label, category, qty, unitCents,
--     confidence and on (its date); its source, notes, library link, and anything not named, are not sent. A scenario's
--     fixtures map (IMS7-D's reconciliation) is not named, so it's not sent. A malformed line (not an object) is dropped.
--   · structure: kind and the terms the investor engine reads (amount, APR, term, share, cap, ownership, payout,
--     valuation cap, discount).
--   · acknowledged (an owner's risk acceptance — shown to investors since IP1.4): key, note, at, reviewBy.
--   · research: topic, claim, figure, source_url, source_title, published, bearing, retrieved_at (accepted only, as
--     pinned — unchanged).
--   · risks: kind, words, likelihood, impact, mitigation, evidence, status (as approved — unchanged).
-- A field the engine adds later isn't sent until it's named here (scripts/db.ims7sec.test fails until it's decided).
-- vision_shared is 0458's word for word otherwise; its rooms no longer carry `notes`. The approved versions themselves
-- are never rewritten — the filter is on the way out. The two helpers are pure; nobody may call them directly.
-- Checked and unchanged (it already sent none): recipes, the library and its research, the Standard, a placed thing's
-- library link, a need's note, AI usage. Kept on purpose (authorized): an owner's risk acceptance and its reason, the
-- product mix the margins are worked out from, asks an owner chose to show.
--
-- WHAT THIS CANNOT DO. It filters every read from now on — new links and links already given (a read is trimmed at
-- the door, whenever the link was made). It can't recall what an earlier read already delivered: anything opened before
-- this was applied may sit in someone's browser. Links stay as they were (revoked, expired: still refused; pinned:
-- still the same approved version).
--
-- set lock_timeout (database F16): five functions replaced or added; no table touched. existing rows: none changed.
-- rollback: re-run 0463's (or 0458's) vision_shared and vision_share_baseline; drop functions public.vision_share_baseline(jsonb), vision_share_scenario(jsonb),
-- vision_share_list(jsonb, text[]), vision_share_keep(jsonb, text[]).
-- changelog: none — a security correction to the investor link's data; the screens are unchanged.

set lock_timeout = '5s';

-- An object kept to its named fields, each a plain value; anything else (not an object, or a field that's an object or an
-- array) is not kept.
create or replace function public.vision_share_keep(o jsonb, keys text[])
returns jsonb language sql immutable set search_path = public as $$
  select case when jsonb_typeof(o) = 'object' then coalesce((
    select jsonb_object_agg(k, v) from jsonb_each(o) as e(k, v)
     where k = any(keys) and jsonb_typeof(v) in ('string', 'number', 'boolean', 'null')), '{}'::jsonb) end
$$;
-- An array of objects, each kept to its named fields; an element that isn't an object is dropped; not an array: empty.
create or replace function public.vision_share_list(a jsonb, keys text[])
returns jsonb language sql immutable set search_path = public as $$
  select case when jsonb_typeof(a) = 'array' then coalesce((
    select jsonb_agg(public.vision_share_keep(x, keys) order by n) from jsonb_array_elements(a) with ordinality as e(x, n)
     where jsonb_typeof(x) = 'object'), '[]'::jsonb) else '[]'::jsonb end
$$;
-- A scenario: the money engine's inputs by name (lib/visionMoney Inputs), its lines, channels and mix by field.
create or replace function public.vision_share_scenario(v jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select case when jsonb_typeof(v) = 'object' then
    public.vision_share_keep(v, array['ordersPerDay','avgOrderCents','daysOpenPerMonth','hoursOpenPerDay','rampMonths','rampStartPct',
      'growthPctPerYear','cogsPct','cardFeePct','staffHoursPerDay','wageCents','laborBurdenPct','rentCents','rentPctOfSales',
      'otherOpexCents','marketingCents','ownerCashCents','repeatPerMonth','keptPct','peakFactor','slowFactor','serveSec',
      'demandFrom','capToRoom','mixDrives','itemsPerOrder'])
    || jsonb_build_object(
      'uses', public.vision_share_list(v -> 'uses', array['id','label','category','qty','unitCents','confidence','on']),
      'channels', public.vision_share_list(v -> 'channels', array['kind','label','reach','convertPct','costCents','startMonth']),
      'mix', public.vision_share_list(v -> 'mix', array['key','label','sharePct','priceCents','unitCostCents','packagingCents']))
  end
$$;
-- The baseline a link sends: its scenarios by name, its structure's terms, an owner's risk acceptances. Nothing else.
create or replace function public.vision_share_baseline(b jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select case when jsonb_typeof(b) = 'object' then jsonb_build_object(
    'scenarios', coalesce((select jsonb_object_agg(k, public.vision_share_scenario(v)) from jsonb_each(case when jsonb_typeof(b -> 'scenarios') = 'object' then b -> 'scenarios' else '{}'::jsonb end) as e(k, v)
                            where k in ('conservative', 'base', 'upside') and jsonb_typeof(v) = 'object'), '{}'::jsonb),
    'structure', coalesce(public.vision_share_keep(b -> 'structure', array['kind','amountCents','aprPct','termMonths','sharePct','capMultiple',
                            'ownershipPct','payoutPct','capCents','discountPct']), '{"kind":"none"}'::jsonb),
    'acknowledged', public.vision_share_list(b -> 'acknowledged', array['key','note','at','reviewBy']))
  end
$$;
revoke all on function public.vision_share_keep(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.vision_share_list(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.vision_share_scenario(jsonb) from public, anon, authenticated;
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
        -- 0463: research and risks by their named fields too (vision_share_list).
        'research', case when v.id = any(s.research_plans) then public.vision_share_list(coalesce(pv.research, (select jsonb_agg(jsonb_build_object(
            'topic', r.topic, 'claim', r.claim, 'figure', r.figure, 'source_url', r.source_url, 'source_title', r.source_title,
            'published', r.published, 'bearing', r.bearing, 'retrieved_at', r.retrieved_at) order by r.topic, r.retrieved_at desc)
          from public.vision_research r where r.plan_id = v.id and r.status = 'accepted' and r.retrieved_at <= s.pinned_at), '[]'::jsonb),
          array['topic','claim','figure','source_url','source_title','published','bearing','retrieved_at']) end,
        -- 0454: its risks and assumptions — with the case, where an owner chose this link to show it.
        -- 0458: the risks as they stood at the pinned approval.
        'risks', case when v.id = any(s.money_plans) and pv.id is not null then public.vision_share_list(pv.risks, array['kind','words','likelihood','impact','mitigation','evidence','status']) end)
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

-- verify, as an investor would read it (numbers only — see IMS7-0463-MANIFEST.md): with a link an owner makes for it,
--   begin; set local role anon;
--   select jsonb_path_exists(public.vision_shared('<that link''s token>'), 'strict $.**.source') as any_source,
--          jsonb_path_exists(public.vision_shared('<that link''s token>'), 'strict $.**.notes') as any_notes;   -- false, false
--   rollback;   -- (and revoke the link)
select public.record_migration('0464_a_link_sends_named_fields_only');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0464

-- ============================================================
-- 0467_a_link_sends_what_it_was_given.sql
-- ============================================================
begin;   -- 0467, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
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
commit;  -- 0467

-- ============================================================
-- 0468_a_link_leaves_no_key_behind.sql
-- ============================================================
begin;   -- 0468, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0468 — A LINK LEAVES NO KEY BEHIND (IMS8 A2, link records hygiene) ──────────────────────────────────────────────
-- 2026-11-01. Ryan: "Prepare 0468 to prevent raw investor-link tokens from entering admin_audit… No raw tokens,
-- authorization secrets, or complete sensitive share rows in audit logs. Revocation must be final unless an explicitly
-- authorized replacement-link workflow creates a new token. Verify cross-tenant isolation for audit records." Needs 0467.
-- A second run changes nothing.
--
-- THE GAP (verified in Postgres, IMS8 audit S1). Every link create, edit and investor OPEN wrote the whole vision_shares
-- row — its secret token included — into admin_audit (0447 attached 0260's generic log_admin_audit). admin_audit had no
-- business column and was readable by any business's admin. Revoked links' tokens stayed there. An admin could also
-- clear revoked_at (un-revoke), or edit a link's token or open counts, through the API.
--
-- WHAT CHANGES.
--   · A link's audit line is built from NAMED fields only — an allow-list, as 0464 for what a link sends: who it's for,
--     asks on/off, expiry, revoked, pin, creator, created, and the scope (program / plan / need / room / money / research
--     ids). Never the token, never the open counters, never any column added later. An investor opening a link writes no
--     audit line (the counters live on the link). The generic 0260 trigger no longer runs on vision_shares.
--   · admin_audit carries tenant_id: stamped from the audited row's own tenant_id, else the caller's business. Read only
--     within your own business (a restrictive policy alongside 0260's "audit admin read"), as audit_log has been since
--     its start. Rows written before this migration: given their row's tenant_id; where the row has none and exactly one
--     business exists, that business (it is the only one that could have written it); with more than one business, left
--     NULL — which no one can read through the API (fail closed).
--   · admin_audit is append-only by grant too, not only by the absence of policies: insert/update/delete/truncate revoked
--     from anon and authenticated; anon can't select. Only the definer triggers write.
--   · Revocation is final: once revoked_at is set it can't be cleared or changed, and a revoked link can't be edited. A
--     replacement is a new link with a new token. A link's token, creator, business and creation time never change. The
--     open counters change only through the link's own door (vision_shared marks its own update; nothing else can).
--   · created_by is stamped on insert (it was never set). New links default to asks OFF (show_asks default false), as the
--     app does since 0467 v3 — so a link made through the API without saying is narrower, not wider.
--
-- HISTORICAL CLEANUP — NOT IN THIS MIGRATION. Removing tokens from audit lines already written is a separate, explicitly
-- authorized script (IMS8-0468-CLEANUP.sql) with before/after counts. Production had 0 such lines when last read.
--
-- set lock_timeout (database F16): one column added to admin_audit (nullable, no default — no rewrite), one backfill
-- update of admin_audit, one policy added, grants revoked, two trigger functions added, one trigger replaced, one
-- column default changed, vision_shared replaced (one line: it marks its own counter update).
-- existing rows: admin_audit.tenant_id backfilled as above; no vision_shares row changed.
-- rollback: drop trigger vision_share_audit_tg, vision_share_guard_tg on vision_shares; recreate admin_audit_vision_shares
--   (0447); drop policy "audit tenant isolation" on admin_audit; alter table admin_audit drop column tenant_id; re-run
--   0467's vision_shared; alter table vision_shares alter column show_asks set default true; re-grant as before.
-- changelog: none — the activity log and the links' own records; nothing a customer sees.

set lock_timeout = '5s';

-- ── The activity log: per business, append-only ─────────────────────────────────────────────────────────────────────
alter table public.admin_audit add column if not exists tenant_id uuid;
create index if not exists admin_audit_tenant_idx on public.admin_audit (tenant_id, created_at desc);
update public.admin_audit a set tenant_id = coalesce(
    (case when coalesce(a.new_row, a.old_row) ->> 'tenant_id' ~ '^[0-9a-f-]{36}$' then (coalesce(a.new_row, a.old_row) ->> 'tenant_id')::uuid end),
    (select t.id from public.tenants t where (select count(*) from public.tenants) = 1))
 where a.tenant_id is null;
drop policy if exists "audit tenant isolation" on public.admin_audit;
create policy "audit tenant isolation" on public.admin_audit as restrictive for all
  using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()));
revoke insert, update, delete, truncate on public.admin_audit from anon, authenticated;
revoke select on public.admin_audit from anon;

create or replace function public.log_admin_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pk   text;
  diff text;
begin
  if (tg_op = 'UPDATE') then
    select string_agg(format('%s: %s → %s', key, coalesce(o.value, '∅'), coalesce(n.value, '∅')), ' · ' order by key)
      into diff
      from jsonb_each_text(to_jsonb(old)) as o(key, value)
      full join jsonb_each_text(to_jsonb(new)) as n(key, value) using (key)
     where o.value is distinct from n.value
       and key not in ('updated_at', 'created_at');
    if diff is null then return new; end if;   -- timestamp-only touch → not a change worth a line
  end if;
  pk := coalesce(
    to_jsonb(coalesce(new, old)) ->> 'id',
    to_jsonb(coalesce(new, old)) ->> 'key',
    to_jsonb(coalesce(new, old)) ->> 'category',
    to_jsonb(coalesce(new, old)) ->> 'product_key');
  -- 0468: the line belongs to the audited row's business (else the caller's).
  insert into public.admin_audit (actor, action, table_name, row_pk, summary, old_row, new_row, tenant_id)
  values (auth.uid(), tg_op, tg_table_name, pk, diff,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
          coalesce(case when to_jsonb(coalesce(new, old)) ->> 'tenant_id' ~ '^[0-9a-f-]{36}$' then (to_jsonb(coalesce(new, old)) ->> 'tenant_id')::uuid end,
                   public.effective_tenant()));
  return coalesce(new, old);
end $$;
revoke all on function public.log_admin_audit() from public, anon, authenticated;

-- ── A link's audit line: named fields only ──────────────────────────────────────────────────────────────────────────
-- What a link's line may say. Never the token, never the counters, never a column added later.
create or replace function public.vision_share_audit_fields(r public.vision_shares)
returns jsonb language sql immutable set search_path = public as $$
  select case when r is null then null else jsonb_build_object(
    'id', r.id, 'tenant_id', r.tenant_id, 'label', r.label, 'show_asks', r.show_asks, 'expires_at', r.expires_at,
    'revoked_at', r.revoked_at, 'pinned_at', r.pinned_at, 'created_by', r.created_by, 'created_at', r.created_at,
    'program_ids', r.program_ids, 'plan_ids', r.plan_ids, 'need_plans', r.need_plans, 'layout_ids', r.layout_ids,
    'money_plans', r.money_plans, 'research_plans', r.research_plans) end
$$;
revoke all on function public.vision_share_audit_fields(public.vision_shares) from public, anon, authenticated;

create or replace function public.vision_share_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then public.vision_share_audit_fields(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then public.vision_share_audit_fields(new) end;
  diff text;
begin
  if tg_op = 'UPDATE' then
    select string_agg(format('%s: %s → %s', key, coalesce(a.value, '∅'), coalesce(b.value, '∅')), ' · ' order by key)
      into diff
      from jsonb_each_text(o) as a(key, value) full join jsonb_each_text(n) as b(key, value) using (key)
     where a.value is distinct from b.value;
    if diff is null then return new; end if;   -- an investor's open (counters only) — not an audit line
  end if;
  insert into public.admin_audit (actor, action, table_name, row_pk, summary, old_row, new_row, tenant_id)
  values (auth.uid(), tg_op, 'vision_shares', coalesce(new.id, old.id)::text, diff, o, n, coalesce(new.tenant_id, old.tenant_id));
  return coalesce(new, old);
end $$;
revoke all on function public.vision_share_audit() from public, anon, authenticated;
drop trigger if exists admin_audit_vision_shares on public.vision_shares;
drop trigger if exists vision_share_audit_tg on public.vision_shares;
create trigger vision_share_audit_tg after insert or update or delete on public.vision_shares
  for each row execute function public.vision_share_audit();

-- ── A link's record: what can't change ──────────────────────────────────────────────────────────────────────────────
create or replace function public.vision_share_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();                -- who made it (null only for the server or the SQL editor)
    new.created_at := now();
    new.opens := 0; new.last_opened_at := null;
    return new;
  end if;
  if old.revoked_at is not null then
    raise exception 'A turned-off link stays off. Make a new link instead.' using errcode = 'PT403';
  end if;
  if new.token is distinct from old.token or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at or new.tenant_id is distinct from old.tenant_id then
    raise exception 'A link''s key, maker, business and start never change. Make a new link instead.' using errcode = 'PT403';
  end if;
  if (new.opens is distinct from old.opens or new.last_opened_at is distinct from old.last_opened_at)
     and coalesce(current_setting('gt3.share_open', true), '') <> 'on' then
    raise exception 'Only an opened link counts its opens.' using errcode = 'PT403';
  end if;
  return new;
end $$;
revoke all on function public.vision_share_guard() from public, anon, authenticated;
drop trigger if exists vision_share_guard_tg on public.vision_shares;
create trigger vision_share_guard_tg before insert or update on public.vision_shares
  for each row execute function public.vision_share_guard();

alter table public.vision_shares alter column show_asks set default false;

-- The door, by token: as 0467, marking its own counter update (vision_share_guard lets only this through).
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
  perform set_config('gt3.share_open', 'on', true);
  update public.vision_shares set opens = opens + 1, last_opened_at = now() where id = s.id;
  perform set_config('gt3.share_open', 'off', true);
  return public.vision_share_payload(s);
end $$;
revoke all on function public.vision_shared(text) from public, anon, authenticated;
grant execute on function public.vision_shared(text) to anon, authenticated;

select public.record_migration('0468_a_link_leaves_no_key_behind');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0468

-- ============================================================
-- 0469_a_size_as_it_was_said.sql
-- ============================================================
begin;   -- 0469, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0469 — A SIZE AS IT WAS SAID, AND ONLY A SIZE (IMS7 correctness) ────────────────────────────────────────────────
-- 2026-10-31. Ryan, 2026-10-31: "Normalize supported units to inches… Preserve original measurement, unit, source, and
-- normalized value… Authorize a database migration enforcing positive finite dimensions where dimensions are provided.
-- First inspect existing rows… Preserve valid nulls… Do not apply a migration that unexpectedly rejects existing
-- legitimate records." A second run changes nothing. Paste it BEFORE the deploy that carries this patch: the intake now
-- writes the two new columns.
--
-- WHAT WAS FOUND. The library's own sizes were already held to positive and finite (0461: std_materials w/d/h null or
-- > 0 and ≤ 2400 — NaN fails the ≤), and a placed thing's (0447: width and depth > 0, height ≥ 0 — a flat thing has
-- none). The research facts (0462) weren't: a size fact's value was whatever the intake made of it, and the intake made
-- "6 ft" into 6 by stripping what wasn't a digit (fixed in lib/measure, this patch). Production, read before writing
-- this (2026-10-31, counts only): 0 research facts, 0 library assets, 19 placed things — all with valid sizes.
--
-- WHAT CHANGES. std_asset_facts gains original_value and original_unit: a size as its source printed it ("1,830 mm"),
-- beside the inches it was read as. A size fact (w_in, d_in, h_in) must now be a positive number of inches up to 2400,
-- in inches (unit 'in' or none) — and so must a correction to one. Every other field is untouched; nulls stay nulls.
-- If any existing row breaks the new rule, this stops before changing anything and says how many (nothing is
-- reinterpreted or deleted to make it fit).
--
-- set lock_timeout (database F16): one table; two nullable columns (no rewrite), two checks (validated against what's
-- there — none today). existing rows: none changed.
-- rollback: alter table public.std_asset_facts drop constraint std_facts_size, drop constraint std_facts_size_corrected,
-- drop column original_value, drop column original_unit.
-- changelog: none — the owners' library intake.

set lock_timeout = '5s';

-- Look first: a row the new rule would refuse stops the migration, counted, before any constraint is added.
do $$
declare bad int;
begin
  select count(*) into bad from public.std_asset_facts
   where field in ('w_in','d_in','h_in')
     and not (jsonb_typeof(value) = 'number' and (value #>> '{}')::numeric > 0 and (value #>> '{}')::numeric <= 2400 and (unit is null or unit = 'in')
              and (corrected_value is null or (jsonb_typeof(corrected_value) = 'number' and (corrected_value #>> '{}')::numeric > 0 and (corrected_value #>> '{}')::numeric <= 2400)));
  if bad > 0 then
    raise exception '0469 stopped: % size fact(s) aren''t a positive number of inches up to 2400. Nothing was changed — review them first.', bad using errcode = 'PT409';
  end if;
end $$;

alter table public.std_asset_facts add column if not exists original_value text;
alter table public.std_asset_facts add column if not exists original_unit text;
alter table public.std_asset_facts drop constraint if exists std_facts_original;
alter table public.std_asset_facts add constraint std_facts_original check ((original_value is null or length(original_value) <= 120) and (original_unit is null or length(original_unit) <= 40));


alter table public.std_asset_facts drop constraint if exists std_facts_size;
alter table public.std_asset_facts add constraint std_facts_size check (
  field not in ('w_in','d_in','h_in')
  or (jsonb_typeof(value) = 'number' and (value #>> '{}')::numeric > 0 and (value #>> '{}')::numeric <= 2400 and (unit is null or unit = 'in')));
alter table public.std_asset_facts drop constraint if exists std_facts_size_corrected;
alter table public.std_asset_facts add constraint std_facts_size_corrected check (
  field not in ('w_in','d_in','h_in') or corrected_value is null
  or (jsonb_typeof(corrected_value) = 'number' and (corrected_value #>> '{}')::numeric > 0 and (corrected_value #>> '{}')::numeric <= 2400));

-- verify (numbers only):
--   select count(*) from public.std_asset_facts where original_value is not null;   -- 0 (first run)
select public.record_migration('0469_a_size_as_it_was_said');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0469

-- ============================================================
-- 0470_a_price_says_what_kind.sql
-- ============================================================
begin;   -- 0470, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0470 — A PRICE SAYS WHAT KIND OF PRICE IT IS (IMS7) ──────────────────────────────────────────────────────────
-- 2026-10-31. Ryan, 2026-10-31: "Authorize the necessary migration to distinguish Estimated · Listed · Quoted · Actual. A
-- seller's advertised price is not an actual expenditure. Preserve historical values and their original provenance. Do
-- not silently reinterpret existing records. Identify ambiguous historical costs and require appropriate
-- reconciliation." A second run changes nothing.
--
-- THE GAP. A library cost's basis was actual, estimated or scenario (0461). Accepting a researched price from a maker's
-- or a seller's page recorded it as ACTUAL (0462, std_accept_facts) — an advertised price called money spent — and the
-- Manage form's one choice for a real price was "Actual (a price paid or quoted)", two different things.
--
-- WHAT CHANGES.
--   · Bases: estimated · listed (a price a maker or seller publishes) · quoted (a price offered to GT3) · actual (paid) ·
--     scenario (kept: it's a what-if figure, and existing rows may hold it).
--   · std_accept_facts: a researched price is LISTED (a maker's, seller's or independent page), QUOTED when it's GT3's own
--     record, ESTIMATED when inferred — never actual. A person says actual, in Manage. Everything else in it is 0462's.
--   · Nothing already recorded is changed. Every cost recorded as ACTUAL before this is flagged (cost_basis_flag) for a
--     person to say what it is: 'actual_from_a_listing' where an accepted researched price from a published page set it;
--     'actual_paid_or_quoted' where a person chose the old "paid or quoted" option. The flag clears itself when a person
--     sets the basis, the amount or the source again. Production, counted before writing this (2026-10-31): 0 library
--     assets, 0 costs — so no row is flagged there today; the rule is for any copy that has them.
--
-- set lock_timeout (database F16): one table — one nullable column (no rewrite), one constraint replaced (validated:
-- it only widens the bases allowed), one trigger; one function replaced. existing rows: none changed except the flag.
-- rollback: re-run 0461's std_materials_lib_said and 0462's std_accept_facts (after re-labelling any listed/quoted
-- cost); drop the trigger, its function and cost_basis_flag.
-- changelog: none — the owners' library.

set lock_timeout = '5s';

alter table public.std_materials drop constraint if exists std_materials_lib_said;
alter table public.std_materials add constraint std_materials_lib_said check (
      (status_reason is null or length(status_reason) <= 500)
  and (studio_kind is null or studio_kind ~ '^[a-z0-9_]{1,40}$')
  and (w_in is null or (w_in > 0 and w_in <= 2400)) and (d_in is null or (d_in > 0 and d_in <= 2400)) and (h_in is null or (h_in > 0 and h_in <= 2400))
  and (finishes is null or length(finishes) <= 500)
  and (supplier is null or length(supplier) <= 160)
  and (supplier_url is null or (supplier_url ~ '^https://' and length(supplier_url) <= 1000))
  and (image_url is null or (image_url ~ '^https://' and length(image_url) <= 1000))
  and (cost_cents is null or (cost_cents >= 0 and cost_cents <= 100000000))
  and (cost_unit is null or length(cost_unit) <= 40)
  and (cost_basis is null or cost_basis in ('actual','quoted','listed','estimated','scenario'))
  and (cost_source is null or length(cost_source) <= 300)
  and (install_notes is null or length(install_notes) <= 1000)
  and (maintenance_notes is null or length(maintenance_notes) <= 1000)
  and pillars <@ array['movement','stillness','light','fuel']::text[]);

alter table public.std_materials add column if not exists cost_basis_flag text;
alter table public.std_materials drop constraint if exists std_materials_cost_basis_flag;
alter table public.std_materials add constraint std_materials_cost_basis_flag check (cost_basis_flag is null or cost_basis_flag in ('actual_from_a_listing','actual_paid_or_quoted'));

-- Flag, never reinterpret: what was recorded as actual stays actual until a person says otherwise. A second run
-- flags only what isn't flagged and still says actual with nobody having set it since (the flag clears itself then).
update public.std_materials m set cost_basis_flag = case
    when exists (select 1 from public.std_asset_facts f where f.material_id = m.id and f.field = 'cost_cents' and f.review in ('accepted','corrected')
                  and f.source_class in ('manufacturer','supplier','independent')) then 'actual_from_a_listing'
    else 'actual_paid_or_quoted' end
 where m.cost_basis = 'actual' and m.cost_basis_flag is null
   and not exists (select 1 from public.schema_migrations s where s.version like '0470%');

-- The flag clears when a person (or an accepted fact) sets the cost again — its basis, amount or source — or when a
-- person confirms the basis as it stands (Manage sends the flag cleared).
create or replace function public.std_cost_basis_flag_clear()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cost_basis is distinct from old.cost_basis or new.cost_cents is distinct from old.cost_cents or new.cost_source is distinct from old.cost_source then
    new.cost_basis_flag := null;
  elsif new.cost_basis_flag is not null and new.cost_basis_flag is distinct from old.cost_basis_flag and auth.uid() is not null then
    new.cost_basis_flag := old.cost_basis_flag;   -- set only by this migration; a person may clear it (saying the basis), never set it
  end if;
  return new;
end $$;
revoke all on function public.std_cost_basis_flag_clear() from public, anon, authenticated;
drop trigger if exists std_cost_basis_flag_clear_tg on public.std_materials;
create trigger std_cost_basis_flag_clear_tg before update on public.std_materials for each row execute function public.std_cost_basis_flag_clear();

create or replace function public.std_accept_facts(p_ids uuid[], p_corrections jsonb default '{}', p_bulk boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare f public.std_asset_facts; v jsonb; n int := 0; v_tenant uuid := public.effective_tenant();
  spec_cols text[] := array['maker','product_ref','w_in','d_in','h_in','composition','finishes','supplier','supplier_url','install_notes','maintenance_notes','image_url'];
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Only an owner or admin accepts facts.' using errcode = 'PT403'; end if;
  if jsonb_typeof(coalesce(p_corrections, '{}')) <> 'object' then raise exception 'Corrections are an object of fact id to value.' using errcode = 'PT422'; end if;
  for f in select * from public.std_asset_facts where id = any(p_ids) and tenant_id = v_tenant order by retrieved_at for update loop
    if f.review <> 'pending' then raise exception 'A fact already reviewed (%) is kept as it was.', f.review using errcode = 'PT409'; end if;
    if p_bulk then
      if f.risk = 'high' or f.method = 'inferred' or f.source_class = 'ai_inference' then
        raise exception 'Bulk acceptance takes only low-risk, sourced facts — % needs its own decision.', f.field using errcode = 'PT409';
      end if;
      if exists (select 1 from public.std_fact_conflicts c where c.material_id = f.material_id and c.field = f.field) then
        raise exception 'The facts about % disagree — decide them one at a time.', f.field using errcode = 'PT409';
      end if;
      if p_corrections ? f.id::text then raise exception 'A correction is its own decision, not part of a bulk acceptance.' using errcode = 'PT409'; end if;
    end if;
    v := coalesce(p_corrections -> f.id::text, f.value);
    -- What was accepted before for this field is superseded; the new value is the specification.
    update public.std_asset_facts set review = 'superseded' where material_id = f.material_id and field = f.field and review in ('accepted','corrected') and id <> f.id;
    update public.std_asset_facts set review = case when p_corrections ? f.id::text then 'corrected' else 'accepted' end,
      corrected_value = case when p_corrections ? f.id::text then v end, reviewed_by = auth.uid(), reviewed_at = now()
     where id = f.id;
    if f.field in ('w_in','d_in','h_in') then
      execute format('update public.std_materials set %I = ($1)::numeric where id = $2', f.field) using v #>> '{}', f.material_id;
    elsif f.field = any(spec_cols) then
      execute format('update public.std_materials set %I = $1 where id = $2', f.field) using v #>> '{}', f.material_id;
    elsif f.field = 'cost_cents' then
      update public.std_materials set cost_cents = (v #>> '{}')::numeric::int, cost_unit = coalesce(f.unit, cost_unit),
        -- 0470: a price a source published is LISTED, never actual; GT3's own record of one is QUOTED until a person says
        -- it was paid (actual); an inference is an estimate.
        cost_basis = case f.source_class when 'ai_inference' then 'estimated' when 'gt3' then 'quoted' else 'listed' end,
        cost_source = left(coalesce(f.source_title, f.source_ref, 'Accepted fact'), 300), cost_as_of = f.retrieved_at::date
       where id = f.material_id;
    end if;
    n := n + 1;
  end loop;
  if n <> coalesce(cardinality(p_ids), 0) then raise exception 'Some of those facts aren''t this tenant''s or don''t exist.' using errcode = 'PT404'; end if;
  return n;
end $$;
revoke all on function public.std_accept_facts(uuid[], jsonb, boolean) from public, anon, authenticated;
grant execute on function public.std_accept_facts(uuid[], jsonb, boolean) to authenticated;

-- verify (numbers only):
--   select cost_basis_flag, count(*) from public.std_materials group by 1;   -- every 'actual' before this, flagged
select public.record_migration('0470_a_price_says_what_kind');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0470

-- ============================================================
-- 0471_an_ask_says_whether_it_is_set.sql
-- ============================================================
begin;   -- 0471, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0471 — AN ASK SAYS WHETHER IT'S SET (IMS8 P3, three states for an ask's amount) ───────────────────────────────────
-- 2026-11-01. Ryan: "Model ask amounts with three distinct states: unset, confirmed zero and specified amount… Preserve
-- existing records and financial behavior… Do not convert a genuinely confirmed zero to NULL. If intent cannot be
-- established, report the affected records and propose an explicit mapping." A second run changes nothing.
--
-- WHY. vision_asks.amount_cents was `not null default 0`, and every screen read 0 as "not set yet" (lib/vision askTotals:
-- "A $0 line is a line with no amount set yet"; the roadmap "amount to be set", the plans "Being priced", the presenter
-- "—"); the roadmap form wrote 0 when the amount was left empty. So 0 could never say "no capital is needed here".
--
-- NOW. amount_cents is nullable, default NULL: NULL = not set yet · 0 = confirmed, no capital needed · > 0 = the amount.
--
-- EXISTING ROWS — ONLY WHERE THE INTENT IS PROVEN. A row at 0 becomes NULL ("not set", which is what every screen has
-- always shown it as) only when NO PERSON ever wrote its amount: every activity-log line for the row (admin_audit,
-- attached to vision_asks since 0447, the table's first day) is the system's own (actor NULL — a migration's seed, e.g.
-- 0447's "Build-out / Equipment / Opening runway — Set the amount."). A row at 0 that a person saved could be either
-- meaning, so this migration does NOT guess: it counts them, and if there are any it STOPS, changing nothing, and says
-- how many — the owner decides the mapping (supabase/cleanup/0471_ask_mapping.sql lists them by id, and applies 0471 with the
-- owner's explicit list of which mean "not set" and which mean "none needed"). Production, read
-- 2026-11-01: 3 asks, all 0, all seeded by 0447 and never edited → 3 become NULL; 0 ambiguous.
--
-- NOTHING ELSE MOVES. Totals are unchanged (NULL and 0 both add nothing). An investor link sends the amount as before
-- (vision_share_payload names amount_cents; NULL passes as a plain value). Paste this BEFORE deploying the app that reads
-- 0 as "confirmed" — the old app keeps reading NULL as "not set" (it maps it to 0), so either order is safe for display,
-- and this order is exact.
--
-- set lock_timeout (database F16): one column's NOT NULL dropped and its default changed (no rewrite); one update of
-- proven rows.
-- rollback: update vision_asks set amount_cents = 0 where amount_cents is null; alter column amount_cents set default 0,
--   set not null.
-- changelog: none — the asks are the owner's planning; what changes is that "none needed" can be said.

set lock_timeout = '5s';

do $$
declare ambiguous int; proven int;
begin
  -- A second run (the column already nullable) changes nothing: what was proven was converted the first time, and a 0
  -- saved since is a confirmed zero by the new rule.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vision_asks' and column_name = 'amount_cents' and is_nullable = 'YES') then
    return;
  end if;
  -- Rows at 0 that a person ever wrote (or that have no activity line at all): their intent isn't proven.
  select count(*) into ambiguous from public.vision_asks a
   where a.amount_cents = 0
     and (exists (select 1 from public.admin_audit l where l.table_name = 'vision_asks' and l.row_pk = a.id::text and l.actor is not null)
          or not exists (select 1 from public.admin_audit l where l.table_name = 'vision_asks' and l.row_pk = a.id::text));
  if ambiguous > 0 then
    raise exception '0471 stopped, nothing changed: % ask(s) at $0 were saved by a person (or have no history), so whether they mean "not set" or "none needed" isn''t proven. Run supabase/cleanup/0471_ask_mapping.sql to see them and map each one explicitly.', ambiguous
      using errcode = 'P0001';
  end if;
  alter table public.vision_asks alter column amount_cents drop not null;
  alter table public.vision_asks alter column amount_cents set default null;
  update public.vision_asks a set amount_cents = null
   where a.amount_cents = 0
     and not exists (select 1 from public.admin_audit l where l.table_name = 'vision_asks' and l.row_pk = a.id::text and l.actor is not null);
  get diagnostics proven = row_count;
  raise notice '0471: % ask(s) at $0, written only by the system, now say "not set" (NULL).', proven;
end $$;

select public.record_migration('0471_an_ask_says_whether_it_is_set');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0471

-- ============================================================
-- 0472_a_link_sends_what_you_reviewed.sql
-- ============================================================
begin;   -- 0472, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0472 — A LINK SENDS WHAT YOU REVIEWED (IMS8 P5, reviewed publishing) ───────────────────────────────────────────────
-- 2026-11-01. Ryan: "a fingerprint detects change but does not prevent newly edited private words from reaching an
-- already-public link. Define and enforce the publication contract. Prefer serving the last reviewed public revision
-- until the owner explicitly republishes changed content. Keep approved financial pins unchanged… revoking direct INSERT
-- is insufficient if direct UPDATE can expand an existing link's scope… Existing authorization checks must apply again…
-- Preserve immediate revocation… make fingerprint validation and publication atomic… Bind confirmations to the exact
-- reviewed findings and content; reject missing or fabricated confirmations server-side."
--
-- THE PUBLICATION CONTRACT.
--   · A link sends its PUBLISHED REVISION: the exact response (vision_share_payload) a person reviewed, stored on the link
--     when it was published (`published`). Words edited afterwards — a program's summary, a plan's why, a room's label —
--     do not reach the link until someone reviews and republishes it. Nothing on the link is read live but the gates.
--   · THE GATES ARE LIVE, AND CAN ONLY TAKE AWAY. Turned off or ended: nothing, at once (as before). A program, plan or
--     room deleted, a plan unmarked "Show it on a link" or moved out of the link's programs: gone from the link at once,
--     with its asks, needs, money, research and risks; a scope switch narrowed (asks, a plan's money, research, needs):
--     gone at once. Nothing the published revision didn't hold can appear (vision_share_live).
--   · MONEY STAYS PINNED. The published revision holds the approved version in force at the link's pin (0458) — the same
--     version the live response would hold. Moving the pin is a republish, an owner's (the pin guard, unchanged).
--
-- THE ONE DOOR FOR WHAT A LINK DISCLOSES.
--   vision_share_review(link | draft) → { payload, fingerprint, material, latest, private_names, published_fingerprint,
--     changed }: what publishing would send, its fingerprint (md5 of the response less its own pin and expiry stamps,
--     and the lifetime asked for), and the material findings — the ids the owner must confirm (lib/publishReadiness
--     mirrors them; scripts/db.ims8p5 proves the two agree): asks that will read "Being priced" (NULL, 0471), approved
--     cost lines with no price, a newer approved version than the pin, words that read as internal (a fixed list, an
--     email, a phone number, the library's own supplier names).
--   vision_share_publish(link | null, draft, fingerprint, confirm) — creates or republishes, in one transaction: it
--     locks the link (FOR UPDATE), applies every check again (is_admin with two-step; an owner for money and for moving
--     the pin — said here and again by the 0451 and 0458 guards at the write; this business's records only; a turned-off
--     link stays off), computes the response ONCE into a variable, compares its fingerprint with the reviewed one (PT409
--     "changed since you reviewed"), compares the confirmations with the material findings of THAT response (PT422
--     unless exactly equal — none missing, none made up), and stores THAT response as the published revision. What is
--     stored is what was fingerprinted is what was reviewed; an edit that commits while it runs is not in the variable,
--     so it can't be published unreviewed (scripts/db.ims8p5 lands one mid-publish and shows it stays out).
--   Direct INSERT is revoked from the API; direct UPDATE is limited to `revoked_at` (turning a link off, stamped now()).
--   Scope, money, research, the pin, the label, asks and lifetime change only through publish. Clearing or forging a
--   fingerprint authorizes nothing: publish recomputes it.
--
-- EXISTING LINKS (first run only). Each gets its current response as its published revision — exactly what it sends
-- today, so nothing an investor sees changes, and nothing more can reach it. published_by is NULL (published before
-- reviews); confirmed is NULL; revision 1. A turned-off link is left as it was (never sent again). Production, read
-- 2026-11-02: 0 links (0 live, 0 turned off) — so no existing link's behaviour changes there; the ledger ends 0462. Both
-- are read again, read-only, before the paste is made (IMS8-RELEASE-REQUEST.md).
--
-- CONFIRMATIONS ARE BOUND TO CONTENT. A material finding's id is what it's about and a short md5 of the exact content it
-- found (the flagged passages word for word, the unset asks, the unpriced lines, the two versions), so a confirmation
-- given for one wording doesn't carry to another: edit the passage and the id — and the confirmation it needs — changes.
--
-- set lock_timeout (database F16): five nullable columns and one counter (a constant default — no rewrite) added and one partial index (an empty column), backfilled once; nine functions added or
-- replaced; INSERT revoked and UPDATE narrowed to one column on vision_shares for the API roles; no policy changed.
-- vision_share_review and vision_share_publish are SECURITY DEFINER, granted to authenticated (inventory +2).
-- rollback: grant insert, update on public.vision_shares to authenticated; drop index vision_shares_published_by; re-run 0468's vision_shared and 0467's
--   vision_share_preview; drop the functions below; alter table vision_shares drop column published, published_fingerprint,
--   published_at, published_by, confirmed, revision.
-- changelog: none — links the owner sends; what changes is that a link sends only what was reviewed.

set lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vision_shares' and column_name = 'published') then
    alter table public.vision_shares add column published jsonb;
    alter table public.vision_shares add column published_fingerprint text;
    alter table public.vision_shares add column published_at timestamptz;
    alter table public.vision_shares add column published_by uuid references auth.users(id) on delete set null;
    alter table public.vision_shares add column confirmed text[];
    -- Which published revision the link is on: 1 when first published, one more each time it's shared again.
    alter table public.vision_shares add column revision int not null default 0;
  end if;
end $$;
-- Every key that points at another row is found by an index (0435): who published a link.
create index if not exists vision_shares_published_by on public.vision_shares (published_by) where published_by is not null;

-- ── The response's fingerprint ──────────────────────────────────────────────────────────────────────────────────────
-- Of everything the response says but its own pin and expiry stamps (a draft is pinned to now and ends N days from
-- now: the moment isn't the content), and the lifetime asked for. jsonb's text form is canonical (keys ordered).
create or replace function public.vision_share_fingerprint(p jsonb, p_days int default null)
returns text language sql immutable set search_path = public as $$
  select md5(jsonb_build_object('response', coalesce(p, '{}'::jsonb) - 'pinned_at' - 'expires_at', 'days', p_days)::text)
$$;
revoke all on function public.vision_share_fingerprint(jsonb, int) from public, anon, authenticated;

-- ── The response's free text (lib/publishReadiness textsOf; lib/sharePreview NOT_TEXT — the same keys) ──────────────
create or replace function public.vision_share_texts(j jsonb)
returns table (key text, val text) language sql immutable set search_path = public as $$
  with recursive w(k, v) as (
    select ''::text, j
    union all
    select coalesce(e.key, w.k), e.value
      from w, lateral (
        select o.key, o.value from jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) o
        union all
        select null::text, a.value from jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' and w.k not in ('pillars', 'waits_on') then w.v else '[]'::jsonb end) a
      ) e
  )
  select w.k, btrim(w.v #>> '{}') from w
   where jsonb_typeof(w.v) = 'string' and btrim(w.v #>> '{}') <> ''
     and not (w.k = any (array['id', 'program_id', 'plan_id', 'layout_id', 'needs_plan_id', 'kind', 'status', 'state', 'horizon', 'format', 'phase',
       'start_on', 'target_on', 'due_on', 'done_on', 'retrieved_at', 'approved_at', 'pinned_at', 'expires_at', 'at', 'reviewBy', 'on', 'confidence',
       'category', 'key', 'demandFrom', 'bearing', 'likelihood', 'impact', 'topic', 'version', 'sort', 'show_asks', 'deal']))
$$;
revoke all on function public.vision_share_texts(jsonb) from public, anon, authenticated;

-- Words that read as internal (lib/publishReadiness INTERNAL_WORDS, INTERNAL_RE_SOURCES), or a private name.
create or replace function public.vision_share_internal(t text, p_names text[])
returns boolean language sql immutable set search_path = public as $$
  select t ~* '(^|[^A-Za-z0-9])(internal|confidential|do not share|don''t share|not for investors|private|password|secret|api key|token)($|[^A-Za-z0-9])'
      or t ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
      or t ~ '\(?[0-9]{3}\)?[ .-][0-9]{3}[ .-][0-9]{4}'
      or exists (select 1 from unnest(coalesce(p_names, '{}')) n where length(btrim(n)) >= 3 and position(lower(btrim(n)) in lower(t)) > 0)
$$;
revoke all on function public.vision_share_internal(text, text[]) from public, anon, authenticated;

-- The business's own private names: its library's suppliers.
create or replace function public.vision_share_private_names(p_tenant uuid)
returns text[] language sql stable set search_path = public as $$
  select coalesce(array_agg(distinct btrim(m.supplier) order by btrim(m.supplier)), '{}')
    from public.std_materials m where m.tenant_id = p_tenant and m.supplier is not null and length(btrim(m.supplier)) >= 3
$$;
revoke all on function public.vision_share_private_names(uuid) from public, anon, authenticated;

-- ── The material findings of a response: what an owner must confirm, by id (lib/publishReadiness confirm ids) ───────
create or replace function public.vision_share_material(p jsonb, p_tenant uuid)
returns text[] language sql stable set search_path = public as $$
  -- Each finding is (what it is about, the exact content it's about); its id is the first and a short md5 of the second,
  -- so a confirmation holds for that content only — edit the words, the asks or the lines and the id changes.
  with names as (select public.vision_share_private_names(p_tenant) n),
  plans as (select v from jsonb_array_elements(coalesce(p -> 'plans', '[]')) v),
  rows(k, c) as (
    -- asks that will read "Being priced" (amount not set — NULL; a confirmed $0 isn't one)
    select 'asks_unset:link:link', coalesce(a ->> 'label', '') from jsonb_array_elements(coalesce(p -> 'asks', '[]')) a
     where p -> 'show_asks' = 'true'::jsonb and coalesce(a -> 'amount_cents', 'null'::jsonb) = 'null'::jsonb
    union all
    -- an approved cost line with no price, in any scenario
    select 'uses_unpriced:plan:' || (v ->> 'id'), coalesce(u ->> 'id', '') || '|' || coalesce(u ->> 'label', '')
      from plans, jsonb_each(case when jsonb_typeof(v -> 'money' -> 'baseline' -> 'scenarios') = 'object' then v -> 'money' -> 'baseline' -> 'scenarios' else '{}'::jsonb end) sc,
           jsonb_array_elements(case when jsonb_typeof(sc.value -> 'uses') = 'array' then sc.value -> 'uses' else '[]'::jsonb end) u
     where coalesce(u -> 'unitCents', 'null'::jsonb) = 'null'::jsonb
    union all
    -- a newer approved version than the one the link shows (the two versions are the content)
    select 'newer_approval:plan:' || (v ->> 'id'), 'v' || (v -> 'money' ->> 'version') || '<v' || l.latest
      from plans, lateral (select max(x.version) latest from public.vision_plan_versions x where x.plan_id = (v ->> 'id')::uuid and x.approved_at is not null) l
     where jsonb_typeof(v -> 'money' -> 'version') = 'number' and (v -> 'money' ->> 'version')::int < l.latest
    union all
    -- words that read as internal, by what they belong to; the content is each flagged passage, word for word
    select 'internal_words:link:link', btrim(p ->> 'label')
     where p ? 'label' and btrim(p ->> 'label') <> '' and public.vision_share_internal(btrim(p ->> 'label'), (select n from names))
    union all
    select 'internal_words:program:' || (x ->> 'id'), t.val from jsonb_array_elements(coalesce(p -> 'programs', '[]')) x, public.vision_share_texts(x) t
     where public.vision_share_internal(t.val, (select n from names))
    union all
    select 'internal_words:plan:' || (v ->> 'id'), t.val from plans, public.vision_share_texts(v) t
     where public.vision_share_internal(t.val, (select n from names))
    union all
    select 'internal_words:' || case when a ->> 'plan_id' is not null then 'plan:' || (a ->> 'plan_id') else 'program:' || (a ->> 'program_id') end, t.val
      from jsonb_array_elements(coalesce(p -> 'asks', '[]')) a, public.vision_share_texts(a) t
     where public.vision_share_internal(t.val, (select n from names))
    union all
    select 'internal_words:layout:' || (x ->> 'id'), t.val from jsonb_array_elements(coalesce(p -> 'layouts', '[]')) x, public.vision_share_texts(x) t
     where public.vision_share_internal(t.val, (select n from names))
  ),
  per as (select k, string_agg(c, E'\n' order by c collate "C") c from (select distinct k, c from rows) d group by k)
  select coalesce(array_agg(k || ':' || left(md5(c), 12) order by k collate "C"), '{}') from per
$$;
revoke all on function public.vision_share_material(jsonb, uuid) from public, anon, authenticated;

-- ── What a published link sends now: its published revision, behind the live gates (they only take away) ─────────
create or replace function public.vision_share_live(s public.vision_shares)
returns jsonb language sql stable set search_path = public as $$
  with j as (select coalesce(s.published, '{}'::jsonb) j),
  progs as (
    select e, n from j, jsonb_array_elements(coalesce(j.j -> 'programs', '[]')) with ordinality as x(e, n)
     where exists (select 1 from public.vision_programs p where p.tenant_id = s.tenant_id and p.id = (e ->> 'id')::uuid and p.id = any(s.program_ids))),
  rooms as (
    select e, n from j, jsonb_array_elements(coalesce(j.j -> 'layouts', '[]')) with ordinality as x(e, n)
     where exists (select 1 from public.store_layouts l where l.tenant_id = s.tenant_id and l.id = (e ->> 'id')::uuid and l.id = any(s.layout_ids))),
  kept as (
    select e, n from j, jsonb_array_elements(coalesce(j.j -> 'plans', '[]')) with ordinality as x(e, n)
     where exists (select 1 from public.vision_plans v where v.tenant_id = s.tenant_id and v.id = (e ->> 'id')::uuid and v.shareable
                     and v.id = any(s.plan_ids) and v.program_id = any(s.program_ids) and v.program_id::text in (select e ->> 'id' from progs))),
  plans as (
    select e || jsonb_build_object(
        'layout_id', case when (e ->> 'layout_id') in (select r.e ->> 'id' from rooms r) then e -> 'layout_id' else 'null'::jsonb end,
        'waits_on', coalesce((select jsonb_agg(w) from jsonb_array_elements(coalesce(e -> 'waits_on', '[]')) w where (w #>> '{}') in (select k.e ->> 'id' from kept k)), '[]'::jsonb),
        'needs', case when (e ->> 'id')::uuid = any(s.need_plans) then coalesce(e -> 'needs', '[]'::jsonb) else '[]'::jsonb end,
        'money', case when (e ->> 'id')::uuid = any(s.money_plans) then e -> 'money' else 'null'::jsonb end,
        'risks', case when (e ->> 'id')::uuid = any(s.money_plans) then e -> 'risks' else 'null'::jsonb end,
        'research', case when (e ->> 'id')::uuid = any(s.research_plans) then e -> 'research' else 'null'::jsonb end) e, n
      from kept)
  select (select j from j) || jsonb_build_object(
    'show_asks', s.show_asks and coalesce((select j -> 'show_asks' from j), 'false'::jsonb) = 'true'::jsonb,
    'expires_at', s.expires_at,
    'programs', coalesce((select jsonb_agg(e || jsonb_build_object('layout_id', case when (e ->> 'layout_id') in (select r.e ->> 'id' from rooms r) then e -> 'layout_id' else 'null'::jsonb end) order by n) from progs), '[]'::jsonb),
    'asks', case when s.show_asks then coalesce((select jsonb_agg(a order by n) from j, jsonb_array_elements(coalesce(j.j -> 'asks', '[]')) with ordinality as x(a, n)
        where (a ->> 'plan_id' is null and (a ->> 'program_id') in (select e ->> 'id' from progs)) or (a ->> 'plan_id') in (select e ->> 'id' from plans)), '[]'::jsonb) else '[]'::jsonb end,
    'plans', coalesce((select jsonb_agg(e order by n) from plans), '[]'::jsonb),
    'layouts', coalesce((select jsonb_agg(e order by n) from rooms), '[]'::jsonb))
$$;
revoke all on function public.vision_share_live(public.vision_shares) from public, anon, authenticated;

-- ── The link a publish would make or change (every check, again) ─────────────────────────────────────────────────────
create or replace function public.vision_share_candidate(p_share uuid, p_draft jsonb, p_lock boolean)
returns public.vision_shares language plpgsql volatile set search_path = public as $$
declare
  s public.vision_shares; old public.vision_shares;
  d jsonb := case when jsonb_typeof(p_draft) = 'object' then p_draft else '{}'::jsonb end;
  t uuid := public.effective_tenant();
  ids_of constant text[] := array['program_ids', 'plan_ids', 'need_plans', 'layout_ids', 'money_plans', 'research_plans'];
  f text; v uuid[]; days int;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only an owner or an admin can share the plan.' using errcode = 'PT403';
  end if;
  if p_share is not null then
    if p_lock then select * into s from public.vision_shares where id = p_share and tenant_id = t for update;
    else select * into s from public.vision_shares where id = p_share and tenant_id = t; end if;
    if not found then raise exception 'No such link.' using errcode = 'PT404'; end if;
    if s.revoked_at is not null then raise exception 'A turned-off link stays off. Make a new link instead.' using errcode = 'PT403'; end if;
    old := s;
  else
    s.tenant_id := t; s.show_asks := false; s.pinned_at := now(); s.expires_at := null;
    s.program_ids := '{}'; s.plan_ids := '{}'; s.need_plans := '{}'; s.layout_ids := '{}'; s.money_plans := '{}'; s.research_plans := '{}';
  end if;
  if d ? 'label' then s.label := nullif(btrim(d ->> 'label'), ''); end if;
  if d ? 'show_asks' then s.show_asks := coalesce((d ->> 'show_asks')::boolean, false); end if;
  foreach f in array ids_of loop
    if d ? f then
      v := array(select distinct x::uuid from jsonb_array_elements_text(case when jsonb_typeof(d -> f) = 'array' then d -> f else '[]'::jsonb end) x order by 1);
      case f
        when 'program_ids' then s.program_ids := v; when 'plan_ids' then s.plan_ids := v; when 'need_plans' then s.need_plans := v;
        when 'layout_ids' then s.layout_ids := v; when 'money_plans' then s.money_plans := v; when 'research_plans' then s.research_plans := v;
      end case;
    end if;
  end loop;
  if d ? 'days' then
    days := (d ->> 'days')::int;
    if days is null or days < 0 or days > 365 then raise exception 'A link lives 0 (until turned off) to 365 days.' using errcode = 'PT400'; end if;
    s.expires_at := case when days > 0 then now() + make_interval(days => days) end;
  end if;
  if coalesce((d ->> 'repin')::boolean, false) then s.pinned_at := now(); end if;
  -- An owner's choices (0451, 0458 — said here, and again by their guards at the write).
  if not coalesce(public.is_owner(), false) then
    if (p_share is null and (cardinality(s.money_plans) > 0 or cardinality(s.research_plans) > 0))
       or (p_share is not null and (array(select unnest(s.money_plans) order by 1) is distinct from array(select unnest(old.money_plans) order by 1)
                                 or array(select unnest(s.research_plans) order by 1) is distinct from array(select unnest(old.research_plans) order by 1))) then
      raise exception 'Only an owner can choose what a link shows of the money.' using errcode = 'PT403';
    end if;
    if p_share is not null and s.pinned_at is distinct from old.pinned_at then
      raise exception 'Only an owner can move what a link shows to a newer approval.' using errcode = 'PT403';
    end if;
  end if;
  -- This business's records only (anything else is dropped, never stored). Order kept, so an unchanged choice stays
  -- byte-for-byte what it was (the 0451 guard reads a reordered list as a change).
  s.program_ids := array(select x from unnest(s.program_ids) with ordinality u(x, n) where exists (select 1 from public.vision_programs p where p.id = x and p.tenant_id = t) order by n);
  s.layout_ids := array(select x from unnest(s.layout_ids) with ordinality u(x, n) where exists (select 1 from public.store_layouts l where l.id = x and l.tenant_id = t) order by n);
  s.plan_ids := array(select x from unnest(s.plan_ids) with ordinality u(x, n) where exists (select 1 from public.vision_plans p where p.id = x and p.tenant_id = t) order by n);
  s.need_plans := array(select x from unnest(s.need_plans) with ordinality u(x, n) where x = any(s.plan_ids) order by n);
  s.money_plans := array(select x from unnest(s.money_plans) with ordinality u(x, n) where exists (select 1 from public.vision_plans p where p.id = x and p.tenant_id = t) order by n);
  s.research_plans := array(select x from unnest(s.research_plans) with ordinality u(x, n) where exists (select 1 from public.vision_plans p where p.id = x and p.tenant_id = t) order by n);
  return s;
end $$;
revoke all on function public.vision_share_candidate(uuid, jsonb, boolean) from public, anon, authenticated;

-- ── Review: what publishing would send ──────────────────────────────────────────────────────────────────────────────
create or replace function public.vision_share_review(p_share uuid default null, p_draft jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.vision_shares; p jsonb; days int;
begin
  s := public.vision_share_candidate(p_share, p_draft, false);
  days := case when jsonb_typeof(p_draft) = 'object' and p_draft ? 'days' then (p_draft ->> 'days')::int end;
  p := public.vision_share_payload(s);
  return jsonb_build_object(
    'payload', p,
    'fingerprint', public.vision_share_fingerprint(p, days),
    'material', to_jsonb(public.vision_share_material(p, s.tenant_id)),
    'latest', coalesce((select jsonb_object_agg(v ->> 'id', (select max(x.version) from public.vision_plan_versions x where x.plan_id = (v ->> 'id')::uuid and x.approved_at is not null))
        from jsonb_array_elements(p -> 'plans') v where jsonb_typeof(v -> 'money') = 'object'), '{}'::jsonb),
    'private_names', to_jsonb(public.vision_share_private_names(s.tenant_id)),
    'published_fingerprint', case when p_share is not null then s.published_fingerprint end,
    'revision', case when p_share is not null then s.revision end,
    'published_at', case when p_share is not null then s.published_at end,
    'changed', case when p_share is not null then s.published_fingerprint is distinct from public.vision_share_fingerprint(p, null) end);
end $$;
revoke all on function public.vision_share_review(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.vision_share_review(uuid, jsonb) to authenticated;

-- ── Publish: create or republish, atomically ────────────────────────────────────────────────────────────────────────
create or replace function public.vision_share_publish(p_share uuid, p_draft jsonb, p_fingerprint text, p_confirm text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.vision_shares; p jsonb; days int; fp text; material text[]; given text[]; r record;
begin
  s := public.vision_share_candidate(p_share, p_draft, true);   -- locks an existing link until this commits
  if s.label is null then raise exception 'Say who the link is for.' using errcode = 'PT400'; end if;
  if cardinality(s.program_ids) = 0 and cardinality(s.layout_ids) = 0 then
    raise exception 'Choose what the link shows — nothing is included until it''s chosen.' using errcode = 'PT400';
  end if;
  days := case when jsonb_typeof(p_draft) = 'object' and p_draft ? 'days' then (p_draft ->> 'days')::int end;
  p := public.vision_share_payload(s);                          -- computed once: this is what's checked and what's stored
  fp := public.vision_share_fingerprint(p, days);
  if p_fingerprint is null or fp <> p_fingerprint then
    raise exception 'It changed since you reviewed it. Review it again.' using errcode = 'PT409';
  end if;
  material := public.vision_share_material(p, s.tenant_id);
  given := array(select x from (select distinct x from unnest(coalesce(p_confirm, '{}')) x) d order by x collate "C");
  if given is distinct from material then
    raise exception 'The confirmations don''t match what was reviewed. Review it again.' using errcode = 'PT422';
  end if;
  if p_share is null then
    insert into public.vision_shares (tenant_id, label, show_asks, expires_at, pinned_at, program_ids, plan_ids, need_plans, layout_ids, money_plans, research_plans,
                                      published, published_fingerprint, published_at, published_by, confirmed, revision)
    values (s.tenant_id, s.label, s.show_asks, s.expires_at, s.pinned_at, s.program_ids, s.plan_ids, s.need_plans, s.layout_ids, s.money_plans, s.research_plans,
            p, public.vision_share_fingerprint(p, null), now(), auth.uid(), material, 1)
    returning id, token, revision into r;
  else
    update public.vision_shares set label = s.label, show_asks = s.show_asks, expires_at = s.expires_at, pinned_at = s.pinned_at,
           program_ids = s.program_ids, plan_ids = s.plan_ids, need_plans = s.need_plans, layout_ids = s.layout_ids,
           money_plans = s.money_plans, research_plans = s.research_plans,
           published = p, published_fingerprint = public.vision_share_fingerprint(p, null), published_at = now(), published_by = auth.uid(), confirmed = material,
           revision = revision + 1
     where id = s.id
    returning id, token, revision into r;
  end if;
  return jsonb_build_object('id', r.id, 'token', r.token, 'revision', r.revision);
end $$;
revoke all on function public.vision_share_publish(uuid, jsonb, text, text[]) from public, anon, authenticated;
grant execute on function public.vision_share_publish(uuid, jsonb, text, text[]) to authenticated;

-- ── The door: the published revision, behind the live gates ─────────────────────────────────────────────────────────
create or replace function public.vision_shared(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.vision_shares;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  select * into s from public.vision_shares
   where token = p_token and revoked_at is null and (expires_at is null or expires_at > now()) and published is not null;
  if not found then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  perform set_config('gt3.share_open', 'on', true);
  update public.vision_shares set opens = opens + 1, last_opened_at = now() where id = s.id;
  perform set_config('gt3.share_open', 'off', true);
  return public.vision_share_live(s);
end $$;
revoke all on function public.vision_shared(text) from public, anon, authenticated;
grant execute on function public.vision_shared(text) to anon, authenticated;

-- The preview of a link is what the link sends (its published revision, gated); of a draft, what it would send.
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
    return public.vision_share_live(s);
  end if;
  s := public.vision_share_candidate(null, p_draft, false);
  if not coalesce(public.is_owner(), false) then s.money_plans := '{}'; s.research_plans := '{}'; end if;
  s.label := coalesce(s.label, 'A link');
  return public.vision_share_payload(s);
exception when sqlstate 'PT403' then
  -- a non-owner's draft that names money previews without it (0467), never refuses
  if p_share is null and coalesce(public.is_admin(), false) then
    s := public.vision_share_candidate(null, coalesce(p_draft, '{}'::jsonb) - 'money_plans' - 'research_plans' - 'repin', false);
    s.label := coalesce(s.label, 'A link');
    return public.vision_share_payload(s);
  end if;
  raise;
end $$;
revoke all on function public.vision_share_preview(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.vision_share_preview(uuid, jsonb) to authenticated;

-- ── A link's record: the API turns a link off, nothing else ─────────────────────────────────────────────────────────
revoke insert, update on public.vision_shares from authenticated;
grant update (revoked_at) on public.vision_shares to authenticated;

create or replace function public.vision_share_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();                -- who made it (null only for the server or the SQL editor)
    new.created_at := now();
    new.opens := 0; new.last_opened_at := null;
    return new;
  end if;
  if old.revoked_at is not null then
    raise exception 'A turned-off link stays off. Make a new link instead.' using errcode = 'PT403';
  end if;
  if new.token is distinct from old.token or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at or new.tenant_id is distinct from old.tenant_id then
    raise exception 'A link''s key, maker, business and start never change. Make a new link instead.' using errcode = 'PT403';
  end if;
  if (new.opens is distinct from old.opens or new.last_opened_at is distinct from old.last_opened_at)
     and coalesce(current_setting('gt3.share_open', true), '') <> 'on' then
    raise exception 'Only an opened link counts its opens.' using errcode = 'PT403';
  end if;
  if new.revoked_at is not null then new.revoked_at := now(); end if;   -- 0472: turned off now, whatever the clock said
  return new;
end $$;
revoke all on function public.vision_share_guard() from public, anon, authenticated;

-- A link's audit line says when it was published, by whom, and what was confirmed (never the revision, never the token).
create or replace function public.vision_share_audit_fields(r public.vision_shares)
returns jsonb language sql immutable set search_path = public as $$
  select case when r is null then null else jsonb_build_object(
    'id', r.id, 'tenant_id', r.tenant_id, 'label', r.label, 'show_asks', r.show_asks, 'expires_at', r.expires_at,
    'revoked_at', r.revoked_at, 'pinned_at', r.pinned_at, 'created_by', r.created_by, 'created_at', r.created_at,
    'program_ids', r.program_ids, 'plan_ids', r.plan_ids, 'need_plans', r.need_plans, 'layout_ids', r.layout_ids,
    'money_plans', r.money_plans, 'research_plans', r.research_plans,
    'published_at', r.published_at, 'published_by', r.published_by, 'published_fingerprint', r.published_fingerprint, 'confirmed', r.confirmed,
    'revision', r.revision) end
$$;
revoke all on function public.vision_share_audit_fields(public.vision_shares) from public, anon, authenticated;

-- ── Existing links (first run only): what each sends today becomes its published revision ──────────────────────────
update public.vision_shares s
   set published = public.vision_share_payload(s), published_fingerprint = public.vision_share_fingerprint(public.vision_share_payload(s), null), published_at = now(), revision = 1
 where s.published is null and s.revoked_at is null;   -- a turned-off link is never sent (and stays as it was)

select public.record_migration('0472_a_link_sends_what_you_reviewed');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0472
