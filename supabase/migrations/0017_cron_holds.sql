-- 0017 — schedule reserve hold reclamation (review #4). release_expired_holds() was
-- only piggybacked on new claim_reserve calls, but a sold_out drop produces no new
-- claims, so expired holds would never return to stock. Run it every 10 minutes.
create extension if not exists pg_cron;
select cron.schedule('reclaim-reserve-holds', '*/10 * * * *', 'select public.release_expired_holds()');
