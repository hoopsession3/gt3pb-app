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
-- reviews); confirmed is NULL. Production, read 2026-11-01: the live ledger ends 0462 — the count is read again,
-- read-only, before the paste is made (IMS8-RELEASE-REQUEST.md).
--
-- set lock_timeout (database F16): five nullable columns added (no rewrite) and one partial index (an empty column), backfilled once; nine functions added or
-- replaced; INSERT revoked and UPDATE narrowed to one column on vision_shares for the API roles; no policy changed.
-- vision_share_review and vision_share_publish are SECURITY DEFINER, granted to authenticated (inventory +2).
-- rollback: grant insert, update on public.vision_shares to authenticated; drop index vision_shares_published_by; re-run 0468's vision_shared and 0467's
--   vision_share_preview; drop the functions below; alter table vision_shares drop column published, published_fingerprint,
--   published_at, published_by, confirmed.
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
  with names as (select public.vision_share_private_names(p_tenant) n),
  ids as (
    -- asks that will read "Being priced" (amount not set — NULL; a confirmed $0 isn't one)
    select 'asks_unset:link:link' id
     where p -> 'show_asks' = 'true'::jsonb
       and exists (select 1 from jsonb_array_elements(coalesce(p -> 'asks', '[]')) a where coalesce(a -> 'amount_cents', 'null'::jsonb) = 'null'::jsonb)
    union
    -- an approved cost line with no price, in any scenario
    select 'uses_unpriced:plan:' || (v ->> 'id') from jsonb_array_elements(coalesce(p -> 'plans', '[]')) v
     where exists (select 1 from jsonb_each(case when jsonb_typeof(v -> 'money' -> 'baseline' -> 'scenarios') = 'object' then v -> 'money' -> 'baseline' -> 'scenarios' else '{}'::jsonb end) sc,
                     jsonb_array_elements(case when jsonb_typeof(sc.value -> 'uses') = 'array' then sc.value -> 'uses' else '[]'::jsonb end) u
                    where coalesce(u -> 'unitCents', 'null'::jsonb) = 'null'::jsonb)
    union
    -- a newer approved version than the one the link shows
    select 'newer_approval:plan:' || (v ->> 'id') from jsonb_array_elements(coalesce(p -> 'plans', '[]')) v
     where jsonb_typeof(v -> 'money' -> 'version') = 'number'
       and (v -> 'money' ->> 'version')::int < (select max(x.version) from public.vision_plan_versions x where x.plan_id = (v ->> 'id')::uuid and x.approved_at is not null)
    union
    -- words that read as internal, by what they belong to
    select 'internal_words:link:link' where p ? 'label' and public.vision_share_internal(btrim(p ->> 'label'), (select n from names)) and btrim(p ->> 'label') <> ''
    union
    select 'internal_words:program:' || (x ->> 'id') from jsonb_array_elements(coalesce(p -> 'programs', '[]')) x
     where exists (select 1 from public.vision_share_texts(x) t where public.vision_share_internal(t.val, (select n from names)))
    union
    select 'internal_words:plan:' || (x ->> 'id') from jsonb_array_elements(coalesce(p -> 'plans', '[]')) x
     where exists (select 1 from public.vision_share_texts(x) t where public.vision_share_internal(t.val, (select n from names)))
    union
    select 'internal_words:' || case when a ->> 'plan_id' is not null then 'plan:' || (a ->> 'plan_id') else 'program:' || (a ->> 'program_id') end
      from jsonb_array_elements(coalesce(p -> 'asks', '[]')) a
     where exists (select 1 from public.vision_share_texts(a) t where public.vision_share_internal(t.val, (select n from names)))
    union
    select 'internal_words:layout:' || (x ->> 'id') from jsonb_array_elements(coalesce(p -> 'layouts', '[]')) x
     where exists (select 1 from public.vision_share_texts(x) t where public.vision_share_internal(t.val, (select n from names)))
  )
  select coalesce(array_agg(id order by id collate "C"), '{}') from (select distinct id from ids) d
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
                                      published, published_fingerprint, published_at, published_by, confirmed)
    values (s.tenant_id, s.label, s.show_asks, s.expires_at, s.pinned_at, s.program_ids, s.plan_ids, s.need_plans, s.layout_ids, s.money_plans, s.research_plans,
            p, public.vision_share_fingerprint(p, null), now(), auth.uid(), material)
    returning id, token into r;
  else
    update public.vision_shares set label = s.label, show_asks = s.show_asks, expires_at = s.expires_at, pinned_at = s.pinned_at,
           program_ids = s.program_ids, plan_ids = s.plan_ids, need_plans = s.need_plans, layout_ids = s.layout_ids,
           money_plans = s.money_plans, research_plans = s.research_plans,
           published = p, published_fingerprint = public.vision_share_fingerprint(p, null), published_at = now(), published_by = auth.uid(), confirmed = material
     where id = s.id
    returning id, token into r;
  end if;
  return jsonb_build_object('id', r.id, 'token', r.token);
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
    'published_at', r.published_at, 'published_by', r.published_by, 'published_fingerprint', r.published_fingerprint, 'confirmed', r.confirmed) end
$$;
revoke all on function public.vision_share_audit_fields(public.vision_shares) from public, anon, authenticated;

-- ── Existing links (first run only): what each sends today becomes its published revision ──────────────────────────
update public.vision_shares s
   set published = public.vision_share_payload(s), published_fingerprint = public.vision_share_fingerprint(public.vision_share_payload(s), null), published_at = now()
 where s.published is null and s.revoked_at is null;   -- a turned-off link is never sent (and stays as it was)

select public.record_migration('0472_a_link_sends_what_you_reviewed');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
