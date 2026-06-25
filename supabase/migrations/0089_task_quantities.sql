-- 0089 — plan vs actual quantities on prep lines. A prep line can carry a planned target ("label
-- 100 bottles"); you confirm what actually happened ("labeled 87"); confirmed lines roll up into the
-- event's "On hand" section — what you really have, not just what was planned. First step of the
-- plan → confirmed → on-hand loop.

alter table public.event_tasks add column if not exists target_qty numeric;  -- planned amount
alter table public.event_tasks add column if not exists actual_qty numeric;  -- confirmed actual (→ on hand)
