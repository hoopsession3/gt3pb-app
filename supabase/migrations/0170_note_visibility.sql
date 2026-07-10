-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0170 · NOTE VISIBILITY + NOTES ON THE PIPELINE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Every note carries a visibility tier, ENFORCED BY RLS (not UI politeness):
--   private — the author's eyes only
--   team    — every employee can read; author + leadership edit; thread is read-only
--   collab  — every employee can read AND comment; author + leadership edit
-- Notes also attach to OPPORTUNITIES now (opportunity_id joins event_id/stop_id), so the pipeline
-- gets the same note spine as events and truck stops. Existing rows default to collab — the owner
-- is opening notes up to the crew (they were leadership-only before; the operating call is that
-- notes attached to events/stops SHOULD be readable by the people working them).

alter table public.meeting_notes add column if not exists visibility text not null default 'collab';
alter table public.meeting_notes drop constraint if exists meeting_notes_visibility_check;
alter table public.meeting_notes add constraint meeting_notes_visibility_check
  check (visibility in ('private','team','collab'));
alter table public.meeting_notes add column if not exists opportunity_id uuid references public.opportunities(id) on delete set null;
create index if not exists meeting_notes_opp on public.meeting_notes(opportunity_id);

-- ── meeting_notes RLS: visibility is the law ────────────────────────────────────────────────────
drop policy if exists "notes leadership read" on public.meeting_notes;
drop policy if exists "notes leadership write" on public.meeting_notes;
drop policy if exists "notes visible read" on public.meeting_notes;
create policy "notes visible read" on public.meeting_notes for select using (
  (select public.is_staff()) and (visibility in ('team','collab') or created_by = (select auth.uid()))
);
drop policy if exists "notes staff insert" on public.meeting_notes;
create policy "notes staff insert" on public.meeting_notes for insert to authenticated
  with check ((select public.is_staff()) and created_by = (select auth.uid()));
drop policy if exists "notes author or leadership update" on public.meeting_notes;
create policy "notes author or leadership update" on public.meeting_notes for update using (
  created_by = (select auth.uid())
  or (visibility <> 'private' and exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and (p.role in ('owner','admin','event_manager') or p.is_admin)))
);
drop policy if exists "notes author or admin delete" on public.meeting_notes;
create policy "notes author or admin delete" on public.meeting_notes for delete using (
  created_by = (select auth.uid()) or (select public.is_admin())
);

-- ── comments inherit the note's visibility (restrictive: ANDs with the existing policies) ───────
-- Read: a comment on a note is only visible if the note is. Write: commenting needs a COLLAB note
-- (or your own private one). Non-note comments (tasks/alerts/strategy) pass through untouched.
drop policy if exists "note comments follow note" on public.comments;
create policy "note comments follow note" on public.comments as restrictive for select using (
  meeting_note_id is null or exists (
    select 1 from public.meeting_notes n where n.id = comments.meeting_note_id
      and (n.visibility in ('team','collab') or n.created_by = (select auth.uid()))
  )
);
drop policy if exists "note comments collab only" on public.comments;
create policy "note comments collab only" on public.comments as restrictive for insert with check (
  meeting_note_id is null or exists (
    select 1 from public.meeting_notes n where n.id = comments.meeting_note_id
      and (n.visibility = 'collab' or n.created_by = (select auth.uid()))
  )
);

-- verify:
--   select count(*) from public.meeting_notes where visibility is null;                          -- 0
--   select count(*) from pg_policies where tablename = 'meeting_notes';                          -- 4 (+ tenant isolation if present)
--   select count(*) from pg_policies where tablename = 'comments' and policyname like 'note comments%'; -- 2
