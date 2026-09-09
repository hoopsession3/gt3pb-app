-- THE LAST LINK IN THE CHAIN.
--
-- 0321 fixed the three views I could see. Its own check then found four more. 0322 fixed those, and
-- the check found a fifth: v_unaccounted_batches selects from v_batch_traceability, which is also
-- definer and also revoked.
--
-- Four levels deep:
--
--   MarketsPanel
--     └── v_market_readiness            (0321)
--           └── v_unaccounted_batches   (0322)
--                 └── v_batch_traceability   ← here
--
-- Rather than run the one-layer check a fourth time, this was found by walking the whole
-- transitive closure at once (a recursive CTE over pg_rewrite/pg_depend), which reports
-- v_batch_traceability as the only relation left. So this is the end of it, and known to be the
-- end rather than hoped to be.
--
-- That is the honest shape of this whole episode: I fixed what I could see, a rule found what I
-- could not, and it took three rounds because I kept answering the question one layer at a time
-- instead of asking for the closure. The check was right every time; the method was what needed
-- correcting.
--
-- Same reasoning as 0322 for why granting it is not a leak: security_invoker FIRST, so the RLS on
-- brew_batches and the inventory tables underneath is what decides. A signed-in customer reading
-- this gets zero rows, because those tables are staff-gated and now actually get consulted.

-- changelog: covered by 0321_a_view_you_cannot_read_is_a_broken_screen.sql — "The overdue list and
-- the Markets panel actually load now" is the same fix finishing. A second "we fixed it again" line
-- in the product changelog would be news about our process, not about the business.
alter view public.v_batch_traceability set (security_invoker = on);
grant select on public.v_batch_traceability to authenticated;

comment on view public.v_batch_traceability is
  'Which batch went into which order. Reachable by the app since 2026-09-09 as the last link under v_market_readiness; security_invoker so brew_batches'' own RLS still decides who sees what.';

select public.record_migration('0323_the_last_link_in_the_chain',
  'v_batch_traceability set to security_invoker and granted — the fourth and final level of the v_market_readiness dependency chain, found by walking the full transitive closure rather than running the one-layer check again. v_invoker_view_gaps is now empty.');

-- verify:
--   select * from public.v_invoker_view_gaps;   -- expect ZERO rows, and this time it is the closure
