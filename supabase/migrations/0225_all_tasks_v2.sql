-- 0225_all_tasks_v2.sql — enrich the ONE task read-view so My Day can adopt it (A3, read side).
--
-- Why: My Day's task plate still hand-unions event_tasks + todos client-side because the 0210 view
-- is too lossy for it — it collapses due_at to a date (losing the intraday due times the 0103 due
-- ladder sets), drops warn/sort, and PostgREST cannot embed events/meeting_notes/goals THROUGH a
-- union view, so the context labels forced a direct-table read. This v2 makes the view carry what
-- My Day renders, joined in the database.
--
-- Contract (WorkloadBoard + any other reader untouched):
--   • ADDITIVE ONLY — the 13 existing columns keep their exact names, types, and order
--     (create-or-replace-view legality + zero behavioral change for existing readers);
--     new columns append after.
--   • Live baseline verified = 0210's definition (no later migration redefines all_tasks;
--     confirm with pg_get_viewdef before applying).
--
-- Spine adoption: op context comes from field_ops (0222) via coalesce(field_op_id, event_id,
-- stop_id) — so STOP-owned tasks finally carry their stop's name in My Day (they rendered as a
-- bare "Event" before), and the view needs no rewrite at the 0224 contract phase (field_op_id is
-- already first in the coalesce). Read-only adoption during the soak; reversible.
create or replace view public.all_tasks with (security_invoker = on) as
  with u as (
    select 'event'::text as source, id, label as title, assignee, due_at::date as due,
           done, done_at, created_at, critical, section as category, event_id, goal_id, meeting_note_id,
           due_at, warn, sort, stop_id, field_op_id
    from public.event_tasks
    union all
    select 'todo', id, title, assignee, due_on as due,
           done, done_at, created_at, false as critical, category, event_id, null::uuid, meeting_note_id,
           null::timestamptz, false, null::int, null::uuid, field_op_id
    from public.todos
  )
  select u.*,
         fo.kind                     as op_kind,
         fo.name                     as op_name,
         fo.day                      as op_day,        -- events carry a date; stops carry an instant —
         fo.starts_at                as op_starts_at,  -- the CLIENT localizes starts_at (one-clock spine),
         coalesce(fo.is_live, false) as op_is_live,    -- a ::date cast here would bucket in UTC
         mn.title                    as meeting_note_title,
         g.title                     as goal_title
  from u
  left join public.field_ops     fo on fo.id = coalesce(u.field_op_id, u.event_id, u.stop_id)
  left join public.meeting_notes mn on mn.id = u.meeting_note_id
  left join public.goals         g  on g.id  = u.goal_id;

grant select on public.all_tasks to authenticated;

-- verify:
--   select count(*) from public.all_tasks;                                   -- runs
--   select op_kind, op_name from public.all_tasks where stop_id is not null limit 1;  -- stop context
--   select due_at from public.all_tasks where source='event' and due_at is not null limit 1;  -- intraday kept
