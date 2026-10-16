-- ── 0421 — A FILE IS ITS OWNER'S TO LIST; A SUBSCRIPTION SQUARE MAY HAVE STARTED IS KEPT; THE SMALLER DOORS, SHUT ──────
-- 2026-10-16. R10b of the customer audit — the rest of the 10/10 audit of the back end (Ryan, 2026-10-16: "then audit for
-- 10/10 best practices... front and back end"). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY.
--   · Storage: five public buckets (avatars, content, training, brand, shop) each had a read policy for everyone, so
--     anyone with the public key could LIST them — every member's and crew member's id and face photo, every Studio
--     draft's media. A public bucket serves its files by URL without any policy; the policy only ever added the listing.
--     And avatars took any file of any size from any signed-in member.
--   · note-files: every crew role could list, open, overwrite and delete the files of every note — private notes too —
--     at the storage layer ("note files staff all", 0262), whatever note_files' own rules said.
--   · reap-stale-pending-subs (0021) deleted a subscription row whose Square outcome was unknown: billed monthly, with
--     nothing in the app to cancel and every webhook for it matching no row.
--   · outlook_connection (0068) still granted the company mailbox's tokens' table to anon and authenticated (RLS the only
--     wall); the splash's and banners' button links took any text — javascript: ran on this origin from window.open.
--   · An order's 86 check ran before the order was stamped with its event (triggers fire by name), so "the event's city"
--     never applied. A planned brew's start day, and a stop's day, were taken on the UTC calendar. A market lead could pull
--     anyone into their market — an owner or admin, or another market's own lead; two owners demoting each other at once
--     could leave none.
--   · The joins the money triggers and account erasure walk had no index on four foreign keys.
--
-- WHAT.
--   · Storage: the everyone-read policies go; a member reads (and so may replace) their own avatar folder, the crew the
--     content bucket, an owner the shop's (each write policy already covers its writer). Avatars and VIP photos: images,
--     ten megabytes at most. note-files: read by those who may read the note, added by those who may add to it, removed
--     by whoever added the file, the note's author, or an admin.
--   · subscriptions.square_asked_at — stamped by app/api/subscriptions/create the moment Square is asked; the sweep is a
--     function now, reap_stale_pending_subs(): a try never asked goes as before, a try asked and never answered stays and
--     raises one critical (subscription_unknown) until a person looks.
--   · outlook_connection: revoked from anon and authenticated. promos and broadcasts: a button link is a path here or a
--     web address (checked for new and edited rows).
--   · orders_stamp_event is renamed a_orders_stamp_event (it fires first). brew_start_date and resync_stop_brews count
--     Eastern days. set_member_market: a lead never moves an owner or admin, or another market's lead (bringing crew into
--     their own market stays theirs — components/CrewPerson offers exactly that). admin_set_role locks the owners before
--     counting them.
--   · indexes: invoices(business_order_id), jug_ledger(business_order_id), reserve_claims(reserve_id), alerts(claimed_by).
-- existing rows: reap_stale_pending_subs — new here; it has written nothing yet (no row has square_asked_at before 0421).
-- existing rows: planned brew batches — brew_date and ready_at re-derived from their needed-by day on Eastern time (planned
--   only; a batch brewing or done is left as it is). Nothing else is rewritten: storage objects, subscriptions, promos and
--   broadcasts keep what they hold (the link checks are NOT VALID — new and edited rows only).
-- changelog: below.

-- ── storage: a file is listed by those who own it ─────────────────────────────────────────────────────────────────
do $$
begin
  -- Everyone-read (anon included) is what made the public buckets listable. Public URLs never needed it.
  drop policy if exists "avatars public read" on storage.objects;
  drop policy if exists "content public read" on storage.objects;
  drop policy if exists "training media public read" on storage.objects;
  drop policy if exists "brand assets public read" on storage.objects;
  drop policy if exists "shop media public read" on storage.objects;
  -- What a writer needs to replace its own file (an upsert asks select too): a member their avatar folder, the crew the
  -- content bucket, an owner the shop's. training and brand are covered by their staff FOR ALL policies.
  drop policy if exists "avatars own read" on storage.objects;
  create policy "avatars own read" on storage.objects for select to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
  drop policy if exists "content staff read" on storage.objects;
  create policy "content staff read" on storage.objects for select to authenticated
    using (bucket_id = 'content' and (select public.is_staff()));
  drop policy if exists "shop media owner read" on storage.objects;
  create policy "shop media owner read" on storage.objects for select to authenticated
    using (bucket_id = 'shop' and (select public.is_owner()));
  -- A photo is a photo: images only, ten megabytes at most (the card's own check is eight).
  update storage.buckets set file_size_limit = 10485760,
         allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']
   where id in ('avatars', 'vip');

  -- note-files: the note's own rules, at the storage layer. Keys are {note_id}/{ts-rand} (app/crew/page.tsx).
  drop policy if exists "note files staff all" on storage.objects;
  drop policy if exists "note files follow note read" on storage.objects;
  create policy "note files follow note read" on storage.objects for select to authenticated
    using (bucket_id = 'note-files' and (select public.is_staff()) and exists (
      select 1 from public.meeting_notes n
       where n.id::text = (storage.foldername(name))[1]
         and (n.visibility in ('team', 'collab') or n.created_by = (select auth.uid()))));
  drop policy if exists "note files follow note add" on storage.objects;
  create policy "note files follow note add" on storage.objects for insert to authenticated
    with check (bucket_id = 'note-files' and (select public.is_staff()) and exists (
      select 1 from public.meeting_notes n
       where n.id::text = (storage.foldername(name))[1]
         and (n.created_by = (select auth.uid())
              or (n.visibility <> 'private' and exists (select 1 from public.profiles p
                    where p.id = (select auth.uid()) and (p.role in ('owner', 'admin', 'event_manager') or p.is_admin))))));
  drop policy if exists "note files follow note remove" on storage.objects;
  create policy "note files follow note remove" on storage.objects for delete to authenticated
    using (bucket_id = 'note-files' and (
      owner = (select auth.uid()) or owner_id = (select auth.uid())::text or (select public.is_admin())
      or exists (select 1 from public.meeting_notes n where n.id::text = (storage.foldername(name))[1] and n.created_by = (select auth.uid()))));
exception when undefined_table or invalid_schema_name then
  raise notice '0421: no storage schema here — the storage policies are skipped.';
end $$;

-- ── a subscription Square may have started is kept ─────────────────────────────────────────────────────────────────
alter table public.subscriptions add column if not exists square_asked_at timestamptz;
comment on column public.subscriptions.square_asked_at is
  'When app/api/subscriptions/create asked Square to start this subscription (0421) — set before the ask, cleared when Square''s answer is kept. A pending row with this set and no Square id is one whose answer never came: kept, never swept.';

create or replace function public.reap_stale_pending_subs() returns integer
  language plpgsql security definer set search_path = public as $$
declare r record; n integer;
begin
  -- A try that never reached Square's subscription step (it died vaulting the card, or before): gone, as before.
  delete from public.subscriptions
   where status = 'pending' and square_subscription_id is null and square_asked_at is null
     and created_at < now() - interval '15 minutes';
  get diagnostics n = row_count;
  -- A try Square was asked about and never answered: kept, and said once until a person looks. The member's next visit
  -- to Subscribe asks Square what it has for them (app/api/subscriptions/create).
  for r in select id from public.subscriptions
            where status = 'pending' and square_subscription_id is null and square_asked_at < now() - interval '15 minutes'
  loop
    perform public.alert_open_once('subscription_unknown', r.id, 'critical', 'money',
      'A subscription may have started at Square — check it',
      'A member''s subscription was sent to Square and no answer came back. Look in Square for this member''s subscriptions: if one started, it is theirs — the app takes it up on their next visit to Subscribe; if none did, nothing was charged.',
      '/crew?s=money&a=pay');
  end loop;
  return n;
end $$;
revoke all on function public.reap_stale_pending_subs() from public, anon, authenticated;
do $$ begin perform cron.unschedule('reap-stale-pending-subs'); exception when others then null; end $$;
do $$ begin
  perform cron.schedule('reap-stale-pending-subs', '*/15 * * * *', 'select public.reap_stale_pending_subs()');
exception when others then
  raise notice '0421: pg_cron is not here — run select public.reap_stale_pending_subs() by hand.';
end $$;

-- ── the smaller doors ──────────────────────────────────────────────────────────────────────────────────────────────
-- The company mailbox's tokens: the service role's alone (RLS was the only wall; 0363 did this for Apple's).
revoke all on public.outlook_connection from anon, authenticated;

-- A button link is a page here or a web address (lib/safeLink holds the same rule in the app): never javascript:, data:
-- or //another-site — the schemes that run or that pass for a path.
alter table public.promos drop constraint if exists promos_cta_href_safe;
alter table public.promos add constraint promos_cta_href_safe
  check (cta_href is null or cta_href ~ '^(/([^/\\\s][^\s\\]*)?|https?://[A-Za-z0-9.-]+(:[0-9]+)?([/?#][^\s\\]*)?)$') not valid;
alter table public.broadcasts drop constraint if exists broadcasts_cta_href_safe;
alter table public.broadcasts add constraint broadcasts_cta_href_safe
  check (cta_href is null or cta_href ~ '^(/([^/\\\s][^\s\\]*)?|https?://[A-Za-z0-9.-]+(:[0-9]+)?([/?#][^\s\\]*)?)$') not valid;

-- An order is stamped with its event BEFORE its 86 check (triggers fire by name): "the event's city" applies.
do $$ begin
  if exists (select 1 from pg_trigger where tgname = 'orders_stamp_event' and tgrelid = 'public.orders'::regclass) then
    alter trigger orders_stamp_event on public.orders rename to a_orders_stamp_event;
  end if;
end $$;

-- A brew's start day, and a stop's day, on the Eastern calendar (0192 took the UTC date: a brew to start at 8 pm Friday
-- read Saturday, and its ready time landed after it was needed).
create or replace function public.brew_start_date(p_day date, p_ext numeric) returns date
  language sql immutable as $$
    select ((public.brew_needed_by(p_day) - (ceil(coalesce(p_ext, 0)) * interval '1 hour')) at time zone 'America/New_York')::date;
  $$;
create or replace function public.resync_stop_brews() returns trigger
  language plpgsql security definer set search_path = public as $$
declare d date;
begin
  if new.starts_at is not null and new.starts_at is distinct from old.starts_at then
    d := (new.starts_at at time zone 'America/New_York')::date;   -- 0421: the stop's own (Eastern) day
    update public.brew_batches b set
      needed_by = public.brew_needed_by(d),
      brew_date = public.brew_start_date(d, b.extraction_hours),
      ready_at  = public.brew_ready_at(d, b.extraction_hours)
    where b.status = 'planned'
      and (b.stop_id = new.id
           or b.id in (select batch_id from public.brew_batch_links where stop_id = new.id));
  end if;
  return new;
end $$;
-- existing rows: the planned batches, re-derived from their own needed-by day.
update public.brew_batches b set
  brew_date = public.brew_start_date((b.needed_by at time zone 'America/New_York')::date, b.extraction_hours),
  ready_at  = public.brew_ready_at((b.needed_by at time zone 'America/New_York')::date, b.extraction_hours)
 where b.status = 'planned' and b.needed_by is not null
   and (b.brew_date is distinct from public.brew_start_date((b.needed_by at time zone 'America/New_York')::date, b.extraction_hours)
        or b.ready_at is distinct from public.brew_ready_at((b.needed_by at time zone 'America/New_York')::date, b.extraction_hours));

-- A market lead brings crew into their own market (components/CrewPerson's one destination for a lead) — but never an
-- owner or admin, and never another market's lead: those are an owner's to move.
create or replace function public.set_member_market(p_member uuid, p_market text)
returns void language plpgsql security definer set search_path = public as $$
declare v_cur text; v_role text; v_admin boolean; v_leads text;
begin
  if not public.is_owner() and public.leads_market() is distinct from p_market then
    raise exception 'Only an owner, or the lead of that market, can move someone into it.';
  end if;
  if p_market is null or not exists (select 1 from public.markets where slug = p_market) then
    raise exception 'No such market: %', coalesce(p_market, '(null)');
  end if;
  select market, role, is_admin, leads_market into v_cur, v_role, v_admin, v_leads from public.profiles where id = p_member;
  if not found then
    raise exception 'no such profile';
  end if;
  if not public.is_owner() then
    if v_role in ('owner', 'admin') or coalesce(v_admin, false) then
      raise exception 'A market lead cannot move an owner or admin.' using errcode = '42501';
    end if;
    if v_leads is not null and v_leads is distinct from p_market then
      raise exception 'That person leads %. Only an owner moves a market''s lead.', v_leads using errcode = '42501';
    end if;
  end if;
  update public.profiles set market = p_market where id = p_member;
end $$;
revoke all on function public.set_member_market(uuid, text) from public, anon, authenticated;
grant execute on function public.set_member_market(uuid, text) to authenticated;

-- The last owner, counted under a lock: two owners demoting each other at once can no longer leave none.
create or replace function public.admin_set_role(member uuid, new_role text) returns void
  language plpgsql security definer set search_path = public as $$
declare
  cur    text;
  owners int;
  tgt_mk text;
  lead   text;
  LEADABLE constant text[] := array['member','server','contractor','event_manager'];
begin
  -- Authorisation FIRST, before anything is looked up. Checking the caller after fetching the
  -- target would let anyone with a login distinguish 'no such profile' from 'owner only' and so
  -- confirm whether a given id exists. Small, but it costs nothing to close.
  lead := public.leads_market();
  if not public.is_owner() and lead is null then raise exception 'owner only'; end if;

  if new_role not in ('member','server','operator','event_manager','contractor','admin','owner')
    then raise exception 'invalid role: %', new_role; end if;

  select role, market into cur, tgt_mk from public.profiles where id = member;
  if cur is null then raise exception 'no such profile'; end if;

  if not public.is_owner() then
    if member = auth.uid() then
      raise exception 'You cannot change your own role. Ask an owner.';
    end if;
    if tgt_mk is distinct from lead then
      raise exception 'That person is not in %. A market lead can only set roles inside their own market.', lead;
    end if;
    if not (cur = any(LEADABLE)) then
      raise exception 'A market lead cannot change a %. That is an owner decision.', cur;
    end if;
    if not (new_role = any(LEADABLE)) then
      raise exception 'A market lead can set member, server, contractor or event manager. % is an owner decision.', new_role;
    end if;
  end if;

  -- Finding 2 from 0280: refuse to remove the last owner. 0421: the owners are locked before they are counted, so two
  -- owners demoting each other at once are taken one after the other — the second finds one owner left, and stops.
  if cur = 'owner' and new_role <> 'owner' then
    perform 1 from public.profiles where role = 'owner' for update;
    select count(*) into owners from public.profiles where role = 'owner';
    if owners <= 1 then
      raise exception 'This is the last owner. Promote someone else to owner first, then change this role.';
    end if;
  end if;

  -- Finding 1 from 0280: is_admin is a MIRROR of role, never an independent grant.
  update public.profiles
     set role = new_role,
         is_admin = (new_role in ('admin','owner'))
   where id = member;
end $$;
grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- ── the joins the money triggers and account erasure walk ─────────────────────────────────────────────────────────
create index if not exists invoices_business_order_idx on public.invoices (business_order_id) where business_order_id is not null;
create index if not exists jug_ledger_business_order_idx on public.jug_ledger (business_order_id) where business_order_id is not null;
create index if not exists reserve_claims_reserve_idx on public.reserve_claims (reserve_id);
create index if not exists alerts_claimed_by_idx on public.alerts (claimed_by) where claimed_by is not null;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Photos and files are listed only by those they belong to', 'security', 'Account',
   'Profile photos, the Studio''s media and the shop''s images still show wherever they are used, but nobody can list them any more; a profile photo must be an image under ten megabytes; a note''s files open only for those who can open the note.',
   '2026-10-16', false),
  ('A subscription is never lost between the app and Square', 'fix', 'Money',
   'If Square doesn''t answer while a subscription is starting, the app keeps it and tells the crew instead of forgetting it — so a member is never billed for a subscription they can''t see or cancel.',
   '2026-10-16', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('avatars public read', 'content public read', 'training media public read', 'brand assets public read', 'shop media public read', 'note files staff all'); -- 0
--   select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'note files follow note%'; -- 3
--   select file_size_limit from storage.buckets where id = 'avatars';                                                  -- 10485760
--   select has_table_privilege('anon', 'public.outlook_connection', 'select');                                         -- false
--   select count(*) from pg_trigger where tgname = 'a_orders_stamp_event';                                              -- 1
--   select count(*) from information_schema.columns where table_name = 'subscriptions' and column_name = 'square_asked_at'; -- 1
--   select count(*) from cron.job where jobname = 'reap-stale-pending-subs' and command like '%reap_stale_pending_subs()%'; -- 1
select public.record_migration('0421_files_are_their_owners_and_a_lost_answer_is_kept');
