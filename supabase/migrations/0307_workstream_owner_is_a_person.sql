-- 0307 — A workstream owner is a person, not a spelling of one.
--
-- os_workstreams.owner is text, and the field's own label reads "Owner — exactly one name". A label
-- stating an invariant free text cannot keep is the tell. Re-type the name differently — "Ryan T",
-- "ryan", a trailing space — and the workstream belongs to nobody, silently, while still looking
-- owned. Four other screens already pick crew from profiles; this one asked you to remember how you
-- spelled it last time.
--
-- ADDITIVE, NOT A SWAP. owner_user_id is added beside owner rather than replacing it. Two reasons,
-- both real: an owner can legitimately be someone with no account yet (a contractor, a name from
-- the 8/2 audit), and every existing reader of .owner keeps working untouched. The text column
-- becomes the DISPLAY and the fallback; the id becomes the truth when there is one.
--
-- The backfill matches on display_name, case- and space-insensitively, and only where exactly ONE
-- profile matches. Two people called Ryan means no automatic answer, and guessing would be worse
-- than leaving it for someone to pick.

alter table public.os_workstreams
  add column if not exists owner_user_id uuid references public.profiles(id) on delete set null;

create index if not exists os_workstreams_owner_idx on public.os_workstreams (owner_user_id);

update public.os_workstreams w
   set owner_user_id = p.id
  from public.profiles p
 where w.owner_user_id is null
   and coalesce(btrim(w.owner), '') <> ''
   and lower(btrim(p.display_name)) = lower(btrim(w.owner))
   and (select count(*) from public.profiles p2
         where lower(btrim(p2.display_name)) = lower(btrim(w.owner))) = 1;

comment on column public.os_workstreams.owner_user_id is
  'The crew member who owns this workstream. Added because owner was free text under a label promising "exactly one name" — a re-typed name orphaned the workstream silently. owner stays as the display name and as the answer for an owner who has no account.';

-- ── who is actually accounted for ──────────────────────────────────────────────────────────────
-- The gap this closes, as a query. A row with a name and no id is either a typo or a person with no
-- account; either way it is worth seeing rather than assuming.
create or replace view public.v_workstream_owners as
select w.id, w.name as workstream, w.owner as owner_text,
       p.display_name as owner_profile,
       case when w.owner_user_id is not null then 'linked to a crew member'
            when coalesce(btrim(w.owner), '') = '' then 'nobody owns this'
            else 'a name, not a person on file' end as state
  from public.os_workstreams w
  left join public.profiles p on p.id = w.owner_user_id
 order by 4, 2;

revoke all on public.v_workstream_owners from public, anon;
grant select on public.v_workstream_owners to authenticated;

comment on view public.v_workstream_owners is
  'Every workstream and whether its owner is a real crew record or just a string. "A name, not a person on file" is either a typo or somebody without an account — both worth knowing, neither visible before.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A workstream owner is now an actual person','improvement','Command',
   'The owner of each workstream was a name typed into a box, under a label that said "exactly one name" — which a text box cannot enforce. Spell it differently the second time and the workstream quietly belonged to nobody while still looking owned. Owners are now picked from the crew, the same way tasks and shoots already work, and existing names were matched to their crew records automatically where there was exactly one obvious match. A name that belongs to someone without an account still works; it is just now visible as such instead of passing for the same thing.',
   '2026-09-07', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0307_workstream_owner_is_a_person',
  'owner_user_id beside owner; backfilled on an unambiguous display_name match only.');

-- verify:
--   select state, count(*) from public.v_workstream_owners group by 1;
--   select * from public.v_workstream_owners where state <> 'linked to a crew member';
