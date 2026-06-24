-- 0061 — let the AI propose how to COMPLETE a follow-up (and surface answers we already have).
-- Stored on the task so the proposal persists. Apply after 0049. Idempotent.
alter table public.event_tasks add column if not exists ai_proposal text;
alter table public.event_tasks add column if not exists ai_has_answer boolean;
