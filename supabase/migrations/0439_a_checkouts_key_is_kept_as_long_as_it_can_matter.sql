-- ── 0439 — A CHECKOUT'S KEY IS KEPT AS LONG AS IT CAN MATTER ───────────────────────────────────────────────────────
-- 2026-10-19. R39 of the 10/10 audit (the fresh audit at R31: API11-12; Ryan, 2026-10-18: "Keep working to improve to a
-- 10"). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. public.checkout_claims (0371) keeps every checkout's key — the line that charges a card once — and nothing ever
-- deleted one. The app's other inboxes expire: webhook_events after 30 days (0230), message_sent after 90 (0429),
-- rate_limit_hits every night (0419). And a door anyone may call adds rows: "Check on my payment", asked about a key
-- never seen, closes it with a row of its own — so a script inside that door's limits (10 a minute an address, 120 for
-- everyone) could add about 170,000 a day, kept forever, the table and its key's index growing under every claim read on
-- the payment path.
--
-- WHAT. A nightly sweep (sweep_checkout_claims, the service role's alone): a settled key (done) goes after 90 days — no
-- retry of a checkout comes three months on — and a key a check closed having found nothing (done, nothing charged, its
-- answer "checked") after 7. A key whose outcome isn't settled — started, charged, unknown — is never swept: it is a
-- payment a person may still have to settle. An index on the settled keys' age keeps the sweep's read small.
--
-- set lock_timeout (database F16): an index on checkout_claims (its build holds a share lock on a small table), a function
-- and a job.
-- existing rows: the first sweep deletes the settled keys older than their window; no unsettled key is touched.
-- changelog: none — nothing anyone sees changes.

set lock_timeout = '5s';

create index if not exists checkout_claims_settled_idx on public.checkout_claims (updated_at) where state = 'done';

create or replace function public.sweep_checkout_claims() returns integer
  language sql security invoker set search_path = public as $$
  with gone as (
    delete from public.checkout_claims
     where state = 'done'
       and (updated_at < now() - interval '90 days'
            or (updated_at < now() - interval '7 days' and coalesce(amount_cents, 0) = 0 and answer ->> 'checked' = 'true'))
    returning 1
  )
  select count(*)::int from gone
$$;
comment on function public.sweep_checkout_claims() is
  'Nightly (0439): settled checkout keys (done) older than 90 days, and keys a check closed having found nothing older than 7, are deleted; a key whose outcome is not settled (started, charged, unknown) never is. Returns how many went.';
revoke all on function public.sweep_checkout_claims() from public, anon, authenticated;
grant execute on function public.sweep_checkout_claims() to service_role;

do $$ begin perform cron.unschedule('checkout-claims-sweep'); exception when others then null; end $$;
do $$ begin
  perform cron.schedule('checkout-claims-sweep', '41 7 * * *', $q$select public.sweep_checkout_claims()$q$);
exception when others then
  raise notice '0439: pg_cron is not here — the sweep is: select public.sweep_checkout_claims()';
end $$;

-- verify (numbers and booleans only):
--   select count(*) from pg_indexes where indexname = 'checkout_claims_settled_idx';                                 -- 1
--   select has_function_privilege('anon', 'public.sweep_checkout_claims()', 'execute');                              -- f
--   select has_function_privilege('authenticated', 'public.sweep_checkout_claims()', 'execute');                     -- f
--   select count(*) from cron.job where jobname = 'checkout-claims-sweep';                                           -- 1
select public.record_migration('0439_a_checkouts_key_is_kept_as_long_as_it_can_matter');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
