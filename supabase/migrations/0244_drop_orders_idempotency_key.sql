-- 0244 — pay-at-pickup double-submit backstop. drop_orders already has a payment_id-backed unique
-- index (0238, extended in 0242) for the PAID path, but a pay-at-pickup reservation never gets a
-- payment_id — no charge happens at order time — so that index has nothing to catch there. A fast
-- double-tap on "reserve now, pay at pickup" before the button's disabled attribute takes effect (or
-- a client retry after a lost response) could insert two drop_orders rows for the same pack.
--
-- The client already builds a stable, per-attempt idempotency key for every reserve request
-- (components/OrderFunnel.tsx's idemKeyFor — a random key cached in sessionStorage, keyed by a
-- signature of the cart contents, so a genuine retry of the SAME attempt reuses it and a new attempt
-- gets a fresh one) and was already sending it to /api/reserve — but the server only ever used it for
-- the Square charge idempotency on the PAID path; it was never persisted, so the unpaid path had
-- nothing to dedupe on. This adds the column and the same guarded unique-index pattern 0238/0242 use
-- (skip instead of fail if dirty data already exists); the accompanying app/api/reserve/route.ts
-- change persists + checks the key for both paths, mirroring the payment_id check exactly.

alter table public.drop_orders add column if not exists idempotency_key text;

do $$
begin
  if not exists (
    select 1 from public.drop_orders where idempotency_key is not null
    group by idempotency_key having count(*) > 1
  ) then
    create unique index if not exists drop_orders_idempotency_key_uniq
      on public.drop_orders (idempotency_key) where idempotency_key is not null;
  else
    raise notice 'drop_orders.idempotency_key has duplicates — unique index skipped; dedupe then re-run';
  end if;
end $$;

-- verify:
--   select column_name from information_schema.columns where table_name='drop_orders' and column_name='idempotency_key';
--   select indexname from pg_indexes where tablename='drop_orders' and indexname='drop_orders_idempotency_key_uniq';
