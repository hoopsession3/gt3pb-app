-- IMS8 · research usage-meter reconciliation (read-only; numbers and booleans only — no prompt, no fact, no person).
-- 2026-11-03. Ryan: "Add the proposed usage-meter reconciliation."
--
-- Two meters count the same paid calls:
--   · std_research_runs.charged_cents — the bill: reserved before the call, settled once by the server
--     (std_research_settle_server, 0473) from the model's own usage report, or charged the full reservation when the
--     report is incomplete ('unreported') or nobody settles it (the next reserve closes it, 0462).
--   · ai_usage (agent 'library-intake') — the cost log lib/anthropic writes after each successful call, priced at log
--     time from lib/aiPricing (claude-sonnet-4-6: $3 in / $15 out / $3.75 5-min cache write / $0.30 cache read per MTok;
--     web search 1¢ each, fetches as tokens — checked against Anthropic's published prices 2026-11-03).
--
-- WHAT IT CAN'T DO: ai_usage has no run id, and its insert is best-effort (a failed insert is a server log line, not a
-- row), so this is per day, not per run. A day where the bill is HIGHER than the log is expected when runs were charged
-- their reservation (unreported / abandoned); a day where the LOG is higher than the bill means a call was paid that the
-- bill didn't count — that is the one to chase. Days are UTC.
--
-- Run it in the SQL editor on production (read-only), or on a replay. Expected today: no rows (0 runs, 0 usage lines,
-- read 2026-11-03).

with bill as (
  select (r.started_at at time zone 'utc')::date as day,
         count(*)                                                           as runs,
         count(*) filter (where r.outcome = 'running')                      as still_running,
         count(*) filter (where r.outcome = 'running' and r.deadline_at < now()) as running_past_deadline,
         count(*) filter (where r.outcome = 'unreported')                   as unreported,
         count(*) filter (where r.outcome in ('done','failed','timed_out','cancelled')) as reported,
         coalesce(sum(r.charged_cents), 0)                                  as charged_cents,
         coalesce(sum(r.charged_cents) filter (where r.outcome in ('done','failed','timed_out','cancelled')), 0) as charged_reported_cents,
         coalesce(sum(r.reserved_cents), 0)                                 as reserved_cents,
         coalesce(sum(r.input_tokens), 0)  as in_tok,  coalesce(sum(r.output_tokens), 0) as out_tok,
         coalesce(sum(r.searches), 0)      as searches
    from public.std_research_runs r
   group by 1
), meter as (
  select (u.created_at at time zone 'utc')::date as day,
         count(*)                         as calls,
         coalesce(sum(u.cost_cents), 0)   as metered_cents,
         coalesce(sum(u.input_tokens), 0) as in_tok, coalesce(sum(u.output_tokens), 0) as out_tok,
         coalesce(sum(u.searches), 0)     as searches,
         count(distinct u.model)          as models,
         bool_and(u.model = 'claude-sonnet-4-6') as all_priced_model
    from public.ai_usage u
   where u.agent = 'library-intake'
   group by 1
)
select coalesce(b.day, m.day)                                   as day,
       coalesce(b.runs, 0)                                       as runs,
       coalesce(m.calls, 0)                                      as metered_calls,
       coalesce(b.reported, 0) - coalesce(m.calls, 0)            as reported_minus_calls,      -- 0 when every reported run has its one call logged
       coalesce(b.unreported, 0)                                 as unreported,
       coalesce(b.still_running, 0)                              as still_running,
       coalesce(b.running_past_deadline, 0)                      as running_past_deadline,  -- closed (full charge) by the next reserve
       coalesce(b.charged_cents, 0)                              as charged_cents,
       coalesce(m.metered_cents, 0)                              as metered_cents,
       coalesce(b.charged_reported_cents, 0) - coalesce(m.metered_cents, 0) as reported_bill_minus_meter_cents,  -- ≈ 0 expected
       coalesce(m.metered_cents, 0) > coalesce(b.charged_cents, 0) + 1     as meter_above_bill,   -- t = a paid call the bill didn't count: chase it
       coalesce(b.in_tok, 0)  - coalesce(m.in_tok, 0)            as in_tok_diff,
       coalesce(b.out_tok, 0) - coalesce(m.out_tok, 0)           as out_tok_diff,
       coalesce(b.searches, 0) - coalesce(m.searches, 0)         as searches_diff,
       coalesce(m.all_priced_model, true)                        as all_calls_on_the_priced_model
  from bill b
  full join meter m on m.day = b.day
 order by 1 desc;
