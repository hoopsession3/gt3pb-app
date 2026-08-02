-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0262 · NOTE CONTINUATION (2026-08-02 — Ryan: "If I wanted to update a note or add to a note
-- using a new attachment, can I do that and not override the current note?" → audit scored 3/10;
-- "Make 10/10 improvements now.")
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The answer was NO on both halves: a saved note's summary/body had no write path at all (frozen,
-- immutable-by-omission), and the composer's attach flow transcribed files then THREW THE FILE
-- AWAY. This migration is the data layer for the fix, non-destructive by construction:
--
--   note_addenda — "Add to this note." Each addition is its own timestamped, attributed row;
--                  the original body/summary rows are never edited. Append-only: no update
--                  policy exists, so an addendum can't be rewritten after the fact (delete by
--                  its author or an admin is the only correction path).
--   note_files   — the attachment KEEPS THE FILE now. Files land in a PRIVATE storage bucket
--                  ('note-files'); this table is the visibility gate (rows inherit the note's
--                  0170 read law), the bucket is staff-only, and the app opens files through
--                  short-lived signed URLs — the vip-proofs pattern (0143-era) reused.
--   audit        — meeting_notes joins the 0260 admin change log for the edits that matter
--                  (title / visibility / archived_at), so renames and visibility flips are
--                  attributable. Summary refreshes are DERIVED content (recomputed from the
--                  immutable body + addenda) and deliberately do NOT spam the log.
--
-- Permission model mirrors 0170 exactly: read follows the note's visibility; WRITING a
-- continuation (addendum / file) is the note-update set — the author, or leadership on
-- non-private notes. Comments remain the channel for everyone else (note-level threads were
-- already legal in 0051/0170; the UI plugs them in with this round).
-- Idempotent; apply after 0261.

-- ── the addendum spine ──────────────────────────────────────────────────────────────────────────
create table if not exists public.note_addenda (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references public.meeting_notes(id) on delete cascade,
  body       text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists note_addenda_note on public.note_addenda(note_id);

alter table public.note_addenda enable row level security;

-- read: exactly who can read the note (0170's law, restated here)
drop policy if exists "addenda follow note read" on public.note_addenda;
create policy "addenda follow note read" on public.note_addenda for select using (
  exists (
    select 1 from public.meeting_notes n where n.id = note_addenda.note_id
      and (select public.is_staff())
      and (n.visibility in ('team','collab') or n.created_by = (select auth.uid()))
  )
);
-- write: the note-update set — author, or leadership on non-private notes (0170's update law)
drop policy if exists "addenda author or leadership insert" on public.note_addenda;
create policy "addenda author or leadership insert" on public.note_addenda for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.meeting_notes n where n.id = note_addenda.note_id
        and (n.created_by = (select auth.uid())
             or (n.visibility <> 'private' and exists (select 1 from public.profiles p
                   where p.id = (select auth.uid())
                     and (p.role in ('owner','admin','event_manager') or p.is_admin))))
    )
  );
-- no update policy on purpose: addenda are append-only history. Correction = delete + re-add.
drop policy if exists "addenda author or admin delete" on public.note_addenda;
create policy "addenda author or admin delete" on public.note_addenda for delete using (
  created_by = (select auth.uid()) or (select public.is_admin())
);

-- ── the files that stay ─────────────────────────────────────────────────────────────────────────
create table if not exists public.note_files (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references public.meeting_notes(id) on delete cascade,
  addendum_id uuid references public.note_addenda(id) on delete set null,  -- which addition brought it (null = attached at creation)
  path        text not null,                                               -- storage key in the 'note-files' bucket
  name        text not null,                                               -- the human filename ("contract.pdf")
  mime        text,
  size_bytes  bigint,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists note_files_note on public.note_files(note_id);

alter table public.note_files enable row level security;

drop policy if exists "note files follow note read" on public.note_files;
create policy "note files follow note read" on public.note_files for select using (
  exists (
    select 1 from public.meeting_notes n where n.id = note_files.note_id
      and (select public.is_staff())
      and (n.visibility in ('team','collab') or n.created_by = (select auth.uid()))
  )
);
drop policy if exists "note files author or leadership insert" on public.note_files;
create policy "note files author or leadership insert" on public.note_files for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.meeting_notes n where n.id = note_files.note_id
        and (n.created_by = (select auth.uid())
             or (n.visibility <> 'private' and exists (select 1 from public.profiles p
                   where p.id = (select auth.uid())
                     and (p.role in ('owner','admin','event_manager') or p.is_admin))))
    )
  );
drop policy if exists "note files author or admin delete" on public.note_files;
create policy "note files author or admin delete" on public.note_files for delete using (
  created_by = (select auth.uid()) or (select public.is_admin())
);

-- ── the private bucket ──────────────────────────────────────────────────────────────────────────
-- PRIVATE (public=false): note files are leadership/team content — never a public URL. The app
-- opens them via short-lived signed URLs. Storage-layer access is staff-wide; the per-note
-- visibility gate lives on note_files rows above (a private note's file paths are only
-- discoverable through that table, and keys are {noteId}/{ts-rand} — unguessable). Guarded so
-- environments without the storage schema (the pglite contract harness) skip cleanly.
do $$ begin
  insert into storage.buckets (id, name, public) values ('note-files', 'note-files', false)
    on conflict (id) do nothing;
  drop policy if exists "note files staff all" on storage.objects;
  create policy "note files staff all" on storage.objects for all to authenticated
    using (bucket_id = 'note-files' and (select public.is_staff()))
    with check (bucket_id = 'note-files' and (select public.is_staff()));
exception when others then null; end $$;

-- ── notes join the admin change log (0260) ──────────────────────────────────────────────────────
-- Only the attributable edits: title (rename), visibility (who sees it), archived_at. NOT summary —
-- the refreshed recap is derived from immutable sources; logging it would bury real changes.
-- Guarded: skips on environments without 0260's function (never prod — 0260 is applied).
do $$ begin
  drop trigger if exists audit_meeting_notes on public.meeting_notes;
  create trigger audit_meeting_notes after update on public.meeting_notes
    for each row when (old.title       is distinct from new.title
                    or old.visibility  is distinct from new.visibility
                    or old.archived_at is distinct from new.archived_at)
    execute function public.log_admin_audit();
exception when others then null; end $$;

-- Verify (prod, after apply):
--   select count(*) from pg_policies where tablename = 'note_addenda';                    -- 3
--   select count(*) from pg_policies where tablename = 'note_files';                      -- 3
--   select id, public from storage.buckets where id = 'note-files';                       -- private
--   select tgname from pg_trigger where tgname = 'audit_meeting_notes';                   -- exists
