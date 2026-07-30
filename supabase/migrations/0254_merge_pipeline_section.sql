-- 0254: collapse Pipeline into Plan as its Leads tab (2026-07-30 — Ryan: "Pipeline plan yes").
-- Completes the design-merge arc (0253 collapsed goals→Command and stops→Plan): the whole
-- lead → event → route lifecycle now lives in ONE section. Operators lose lead visibility by
-- Ryan's explicit call — sales is leadership work. The client's OpSection/VALID set no longer
-- recognizes the key; stale ?s=pipeline deep links fall back gracefully. This cleans the
-- work_streams lane rows to match. Idempotent; safe to re-run.
update public.work_streams
set sections = array_remove(sections, 'pipeline')
where sections && array['pipeline']::text[];
