-- 0237 — Roll tasks up under their INITIATIVE. The initiative_id FK has existed on both task tables
-- since 0201 but the read-view hid it, so nothing could group or read by it. This exposes it and joins
-- the initiative's title/emoji/status/target so a task carries its program the same way it carries its
-- event/stop and goal.
--
-- ADDITIVE ONLY (create-or-replace-view legality): the 25 columns 0225 produced keep their exact names,
-- types, AND ORDER — the new columns (initiative_id + the four joined fields) append at the very end.
-- The u.* of 0225 is spelled out explicitly here so the appended columns can't shift an existing one.
-- Live baseline = 0225 (no later migration redefines all_tasks). security_invoker preserved.
create or replace view public.all_tasks with (security_invoker = on) as
  with u as (
    select 'event'::text as source, id, label as title, assignee, due_at::date as due,
           done, done_at, created_at, critical, section as category, event_id, goal_id, meeting_note_id,
           due_at, warn, sort, stop_id, field_op_id, initiative_id
    from public.event_tasks
    union all
    select 'todo', id, title, assignee, due_on as due,
           done, done_at, created_at, false as critical, category, event_id, null::uuid, meeting_note_id,
           null::timestamptz, false, null::int, null::uuid, field_op_id, initiative_id
    from public.todos
  )
  select u.source, u.id, u.title, u.assignee, u.due,
         u.done, u.done_at, u.created_at, u.critical, u.category, u.event_id, u.goal_id, u.meeting_note_id,
         u.due_at, u.warn, u.sort, u.stop_id, u.field_op_id,
         fo.kind                     as op_kind,
         fo.name                     as op_name,
         fo.day                      as op_day,
         fo.starts_at                as op_starts_at,
         coalesce(fo.is_live, false) as op_is_live,
         mn.title                    as meeting_note_title,
         g.title                     as goal_title,
         -- appended (0237): the program a task rolls up to
         u.initiative_id,
         i.title                     as initiative_title,
         i.emoji                     as initiative_emoji,
         i.status                    as initiative_status,
         i.target_date               as initiative_target
  from u
  left join public.field_ops     fo on fo.id = coalesce(u.field_op_id, u.event_id, u.stop_id)
  left join public.meeting_notes mn on mn.id = u.meeting_note_id
  left join public.goals         g  on g.id  = u.goal_id
  left join public.initiatives   i  on i.id  = u.initiative_id;

grant select on public.all_tasks to authenticated;

-- Roll-up read paths hit these FKs; index them so grouping/filtering by initiative stays cheap.
create index if not exists event_tasks_initiative_idx on public.event_tasks (initiative_id);
create index if not exists todos_initiative_idx        on public.todos       (initiative_id);

-- verify:
--   select count(*) from public.all_tasks;                                        -- view still runs
--   select initiative_id, initiative_title from public.all_tasks where initiative_id is not null limit 1;
--   select op_kind, goal_title from public.all_tasks limit 1;                      -- existing cols intact
