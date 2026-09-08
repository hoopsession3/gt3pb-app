-- 0315 — A STOP IS A VISIT, NOT A NAME (2026-09-08)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Audit item three. The audit said "three editors that disagree about which owns a stop's identity,
-- and that disagreement is written down in the code comments." Both halves turned out to be true,
-- and the survey found a fourth writer — but it also found that this app ALREADY DECIDED the
-- question, three migrations before the disagreement appeared. 0226 states the model in its header:
--
--     vendors = WHO (one row per partner) · vendor_locations = WHERE (1..N places per vendor)
--     · field ops = WHEN (a dated visit at a place)
--
-- That is the right model and it is not in dispute anywhere. What is in dispute is only the
-- IMPLEMENTATION, in four places that never got reconciled to it:
--
--   1. linkVendor (crew/page.tsx)      copies vendors.name onto stops.name at LINK time
--   2. pullVendorFields (FieldOpSheet)  copies vendors.name onto stops.name at TYPED-NAME time
--   3. nameOverride (LocationEditor)    shows vendors.name INSTEAD of stops.name, at DISPLAY time,
--                                       on Route's screen only ("the VENDOR is the place's
--                                       identity — so two visits to one place can't read as two
--                                       different names")
--   4. saveName (LocationEditor)        lets a person type straight over stops.name, linked or not
--
-- Two write-time snapshots, one read-time override, and a free-text field. So stops.name can be
-- current, stale, or hand-edited, and nothing tells you which.
--
-- ── WHY THIS ONE LEAVES THE BUILDING ───────────────────────────────────────────────────────────
-- The vendor editor pushes an ADDRESS change out to every linked stop (saveLocation, and its
-- comment says why: "the 'edit once, updates everywhere' promise was only half-true"). It does not
-- push a NAME change. And stops mirror into field_ops on every write (0222), which is the single
-- query the public Find Us page reads (FindUs.tsx: "Reads ONE query: field_ops where is_public").
--
-- So: rename a venue, and Route shows the new name because it overrides at display time — while
-- stops.name keeps the old one, rides the mirror into field_ops, and shows the OLD NAME TO GUESTS
-- looking up where the truck is. Every other crew surface reads stops.name too: the prep board, the
-- calendar, the pack list, DropOps, and every task label.
--
-- ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────────────────────────
-- Does not add stops.vendor_location_id. vendor_locations has existed since 0226 and NOTHING points
-- at it — a stop still carries its own copy of the address, which is why a vendor address edit has
-- to fan out an UPDATE across every linked stop instead of being a join. Finishing that is a real
-- schema change with data implications and it is Ryan's call, not a 2am unilateral one. It is
-- measured here (v_vendor_identity_debt) so the decision has numbers instead of adjectives.
--
-- Does not rewrite stops.name behind anyone's back, and — after running this against production —
-- does not assume which side is right either. All three live stops disagree with their venue, and
-- in every case the STOP has the better name: "Wine Express — Five Forks" and "Wine Express
-- Saturday" against a vendor row that just says "WineXpress"; "Restore Hyper Wellness" against
-- "Restore Wellness". A one-tap "use the venue's name" would have degraded all three, and it was
-- already written before the data said so. It survives as one of two options, not the answer.
--
-- What those names are actually telling us: "— Five Forks" is a LOCATION and "Saturday" is a
-- recurring slot. Both are jobs the schema has a slot for (vendor_locations, since 0226) and
-- nothing uses. That is the same finding as the paragraph above, arriving from the data instead of
-- from the design doc.
--
-- Does not add a status machine: derivedStopStatus already exists in FieldOpSheet with an 8-hour
-- grace, and FindUs, Route and PrepBoard all apply the same rule. The view mirrors that constant
-- rather than inventing a second one.

-- ── 1) THE STOP, WHOLE ─────────────────────────────────────────────────────────────────────────
-- security_invoker (0312's rule). Worth stating what that means HERE, because stops are unusual:
-- their RLS is row-level `using (true)` and has been since 0001 — a stop is public information, it
-- is where the truck will be. The staff-only half lives in stop_ops (0195 moved crew_brief,
-- dress_code and recap there precisely so they would not be world-readable). Under invoker those
-- three come back NULL for a customer and populated for crew, which is exactly right and is why
-- this view can be one view instead of two.
--
-- SIXTEEN tables reference a stop. This is the operational subset; the rest are counted where they
-- earn a number rather than joined for completeness.
create or replace view public.v_stop_record with (security_invoker = on) as
select
  s.id, s.name, s.location_text, s.address, s.lat, s.lng,
  s.starts_at, s.ends_at, s.status, s.completed_at, s.archived_at,
  -- NOT s.day_label. The migration history has an `add column ... day_label` that reads as if it
  -- landed here; information_schema on production says stops does not have it. Checked before
  -- applying rather than after, which is the only reason this line is right — the same lookup
  -- against events.recap earlier today failed at query time instead.
  s.when_label, s.time_label, s.plan_days, s.default_buffer_min,
  s.note, s.notes, s.menu_tier, s.tag_label, s.rig, s.sort,
  s.power_available, s.water_available,
  s.order_ahead_enabled, s.pickup_enabled, s.order_ahead_lead_min,
  s.menu_nitro, s.menu_nature_aid, s.menu_salted_maple, s.menu_bottles, s.menu_broth,
  s.vendor_id,
  v.name                                             as vendor_name,
  v.address                                          as vendor_address,
  v.status                                           as vendor_status,
  o.crew_brief, o.dress_code, o.recap,
  -- THE NAME QUESTION, ANSWERED IN A COLUMN. canonical_name is what 0226's model says this place
  -- is called; name is what this row happens to store. Every surface can keep reading `name`; the
  -- ones that care can read canonical_name, and the gap view compares them.
  coalesce(nullif(btrim(v.name), ''), s.name)        as canonical_name,
  (s.vendor_id is not null
     and btrim(coalesce(s.name, '')) <> btrim(coalesce(v.name, '')))   as name_is_stale,
  (l.current_stop_id is not null)                    as is_live_now,   -- live_status has no stop_id
  t.tasks, t.tasks_done, (t.tasks - t.tasks_done)    as tasks_open, t.tasks_critical_open,
  st.staff, ap.approvals, sch.schedule_items, mi.menu_items,
  ord.orders, ord.orders_cents,
  inc.incidents, br.brews, ct.content_items,
  -- WHERE IT SITS IN TIME. The 8-hour grace is FieldOpSheet's STOP_GRACE_MS, which FindUs, Route
  -- and PrepBoard already apply — copied deliberately so the database agrees with the four screens
  -- rather than introducing a fifth opinion.
  case when s.starts_at is null then 'undated'
       when s.starts_at > now() then 'upcoming'
       when now() - s.starts_at <= interval '8 hours' then 'today'
       else 'past' end                               as phase,
  case when s.starts_at is null then null
       else floor(extract(epoch from (s.starts_at - now())) / 86400.0)::int end as days_away
from public.stops s
left join public.vendors  v on v.id = s.vendor_id
left join public.stop_ops o on o.stop_id = s.id
left join public.live_status l on l.current_stop_id = s.id and l.is_live
left join lateral (
  select count(*)::int                                         as tasks,
         count(*) filter (where x.done)::int                   as tasks_done,
         count(*) filter (where x.critical and not x.done)::int as tasks_critical_open
    from public.event_tasks x where x.stop_id = s.id
) t on true
left join lateral (select count(*)::int as staff          from public.event_staff x          where x.stop_id = s.id) st  on true
left join lateral (select count(*)::int as approvals      from public.event_approvals x      where x.stop_id = s.id) ap  on true
left join lateral (select count(*)::int as schedule_items from public.event_schedule_items x where x.stop_id = s.id) sch on true
left join lateral (select count(*)::int as menu_items     from public.event_menu_items x     where x.stop_id = s.id) mi  on true
left join lateral (select count(*)::int as incidents      from public.incident_log x         where x.stop_id = s.id) inc on true
left join lateral (select count(*)::int as brews          from public.brew_batches x         where x.stop_id = s.id) br  on true
left join lateral (select count(*)::int as content_items  from public.content_items x        where x.stop_id = s.id) ct  on true
left join lateral (
  select count(*)::int                                as orders,
         coalesce(sum(x.total_cents), 0)::bigint      as orders_cents
    from public.orders x where x.stop_id = s.id
) ord on true;

revoke all on public.v_stop_record from anon;
grant select on public.v_stop_record to authenticated;

comment on view public.v_stop_record is
  'One truck stop, whole. canonical_name is what 0226''s model says the place is called (the vendor); name is what this row stores. Sixteen tables reference a stop and nothing put them on one row before 0315.';

-- ── 2) THE GAPS ────────────────────────────────────────────────────────────────────────────────
-- Same lateral-values idiom as v_event_gaps. name_drift is first and highest because it is the only
-- one on this list a CUSTOMER can see.
create or replace view public.v_stop_gaps with (security_invoker = on) as
select r.id as stop_id,
       coalesce(nullif(btrim(r.name), ''), '(unnamed)') as name,
       r.starts_at, r.status, r.phase, g.gap, g.detail, g.severity
  from public.v_stop_record r
  cross join lateral (values
    -- REWRITTEN AFTER RUNNING IT. The first version of this row said "this stop stores an OLDER
    -- name than the venue" and the fix said "use the venue's name". Then it ran against production
    -- and all three live stops disagreed with their venue — in the other direction:
    --     "Wine Express — Five Forks"  vs  "WineXpress"
    --     "Wine Express Saturday"      vs  "WineXpress"
    --     "Restore Hyper Wellness"     vs  "Restore Wellness"
    -- The STOP names are the better ones. They carry which location and which recurring slot; the
    -- vendor rows are the terse canonical entries. Copying the vendor over the stop would have made
    -- every one of them worse, and the button that did it was already written. So this row states
    -- the disagreement and refuses to pick a side.
    ('name_drift', 'The stop and the venue disagree about what this place is called. Guests see the stop''s name.', 'high',
       r.name_is_stale),
    ('no_pin',     'No map pin, so directions do not work for anyone trying to find the truck.', 'high',
       r.lat is null or r.lng is null),
    ('no_day',     'No date or time, so it appears on no calendar and in no week.', 'high',
       r.starts_at is null),
    ('live_past',  'Flagged as the live stop, but its window closed. The public page still points here.', 'high',
       r.is_live_now and r.phase = 'past'),
    ('unlinked',   'Not linked to a venue. Typing the name again next time is how one place becomes three.', 'medium',
       r.vendor_id is null),
    ('addr_drift', 'The address on this stop differs from the venue''s. One of the two is out of date.', 'medium',
       r.vendor_id is not null
         and coalesce(btrim(r.vendor_address), '') <> ''
         and btrim(coalesce(r.address, '')) <> btrim(coalesce(r.vendor_address, ''))),
    ('stale_status','The window closed more than eight hours ago and this still reads upcoming.', 'medium',
       r.status = 'upcoming' and r.phase = 'past'),
    ('no_recap',   'Finished, with no after-action note.', 'low',
       (r.status = 'done' or r.completed_at is not null) and coalesce(btrim(r.recap), '') = '')
  ) as g(gap, detail, severity, hit)
 where g.hit
   and r.archived_at is null;

revoke all on public.v_stop_gaps from anon;
grant select on public.v_stop_gaps to authenticated;

comment on view public.v_stop_gaps is
  'Every way a stop currently contradicts itself, the calendar, or the venue it is linked to. Archived stops excluded — an archived mistake is filed, not outstanding.';

-- ── 3) THE ONE-TAP FIX ─────────────────────────────────────────────────────────────────────────
-- Deliberately explicit rather than a trigger. A trigger that renamed stops whenever a vendor
-- changed would be defensible, but it would also silently rewrite rows a person had hand-edited on
-- purpose — and saveName exists, so some of them WERE hand-edited on purpose. This makes the fix a
-- decision somebody takes, and returns what it changed so the screen can say so.
create or replace function public.resync_stop_from_vendor(p_stop uuid)
returns table (old_name text, new_name text, old_address text, new_address text)
language plpgsql security definer set search_path = public as $$
declare s public.stops; v public.vendors;
begin
  if not public.is_staff() then raise exception 'Only crew can resync a stop.'; end if;
  select * into s from public.stops where id = p_stop for update;
  if not found then raise exception 'That stop no longer exists.'; end if;
  if s.vendor_id is null then
    raise exception 'This stop is not linked to a venue, so there is nothing to copy from. Link it first.';
  end if;
  select * into v from public.vendors where id = s.vendor_id;
  if not found then raise exception 'The venue this stop points at no longer exists.'; end if;

  old_name := s.name; new_name := v.name;
  old_address := s.address; new_address := coalesce(v.address, s.address);

  update public.stops
     set name          = v.name,
         address       = coalesce(v.address, address),
         location_text = coalesce(v.location_text, location_text),
         lat           = coalesce(v.lat, lat),
         lng           = coalesce(v.lng, lng)
   where id = p_stop;
  -- The 0222 mirror carries this into field_ops by itself, which is how the corrected name reaches
  -- the public Find Us page. Nothing to do here for that; noted so nobody adds a second write.
  return next;
end $$;

revoke all on function public.resync_stop_from_vendor(uuid) from public, anon;
grant execute on function public.resync_stop_from_vendor(uuid) to authenticated;

comment on function public.resync_stop_from_vendor(uuid) is
  'Copy the linked venue''s name, address and pin onto a stop. ONE of two directions, not the default: measured against production, every live stop had the BETTER name (it carried the location or the recurring slot) and the vendor row was the terse one. Offered, never applied automatically.';

-- ── 4) THE DECISION THIS ROUND DOES NOT TAKE, WITH NUMBERS ─────────────────────────────────────
-- 0226 designed three layers and built two of them. vendor_locations holds the canonical WHERE and
-- nothing references it: a stop copies an address instead of pointing at a location, which is why
-- renaming or moving a venue needs a fan-out UPDATE rather than a join. Whether to finish that is a
-- schema decision with a data migration behind it. This gives it a size.
create or replace view public.v_vendor_identity_debt with (security_invoker = on) as
select
  (select count(*)::int from public.vendors  where coalesce(archived_at, now() + interval '1 day') > now()) as vendors,
  (select count(*)::int from public.vendor_locations where archived_at is null)                              as vendor_locations,
  (select count(*)::int from public.vendor_locations vl where vl.archived_at is null
     and (select count(*) from public.vendor_locations x where x.vendor_id = vl.vendor_id and x.archived_at is null) > 1)
                                                                                                            as locations_on_multi_site_vendors,
  (select count(*)::int from public.stops where archived_at is null)                                        as stops,
  (select count(*)::int from public.stops where archived_at is null and vendor_id is null)                   as stops_unlinked,
  (select count(*)::int from public.v_stop_record where archived_at is null and name_is_stale)               as stops_with_stale_name,
  (select count(*)::int from public.events where archived_at is null and vendor_id is null)                  as events_unlinked,
  -- The column that would end the fan-out. It does not exist; this is here so the number is zero
  -- for a stated reason rather than absent for an unstated one.
  0                                                                                                          as stops_pointing_at_a_location;

revoke all on public.v_vendor_identity_debt from anon;
grant select on public.v_vendor_identity_debt to authenticated;

comment on view public.v_vendor_identity_debt is
  '0226 designed vendors=WHO / vendor_locations=WHERE / field ops=WHEN and built two of the three. This sizes the third: nothing points at a vendor_location, so every stop carries its own copy of an address.';

-- ── 5) what changed ────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A truck stop has one place that shows it whole','feature','Plan',
   'Sixteen tables reference a stop — its prep tasks, its crew, its sign-offs, its run of show, its menu, its orders, its incidents, its brews, its content and its after-action note — and no screen showed you a stop. There is now a record for one: where and when it is, which venue it belongs to, what is still owed, what it took, and a way into the prep checklist. It opens from anywhere by its own link, so it survives a refresh and can be sent to somebody.',
   '2026-09-08', true),
  ('The app now shows when a stop and its venue disagree about the name','fix','Plan',
   'A stop stores its own copy of the venue''s name, and nothing keeps the two in step — editing a venue''s address reached every linked stop, but editing its name never did. One crew screen hid the difference by showing the venue''s name over the top; every other screen, and the public Find Us page, read the stop''s. All three current stops disagree with their venue, and in each case the stop has the better name: it carries which location or which recurring slot, while the venue row is the short version. So the record shows both and lets you choose, rather than picking one and quietly overwriting the other.',
   '2026-09-08', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0315_a_stop_is_a_visit_not_a_name',
  'v_stop_record (sixteen tables on one row, canonical_name vs stored name), v_stop_gaps (name_drift first — a stale stop name rides the 0222 mirror onto the public Find Us page), resync_stop_from_vendor, v_vendor_identity_debt.');

-- verify:
--   select name, canonical_name, name_is_stale, phase, status, tasks, orders from public.v_stop_record order by starts_at nulls last;
--   select gap, severity, count(*) from public.v_stop_gaps group by 1,2 order by 2,1;
--   select * from public.v_vendor_identity_debt;
--   select * from public.resync_stop_from_vendor('<stop id>');
