-- ── 0371 — A CARD IS CHARGED ONCE ─────────────────────────────────────────────────────────────────────
-- 2026-10-11 (the checkout audit: a retry after a lost answer could charge a card twice).
--
-- WHY. The idempotency key is what stops Square from charging a card twice for one checkout: send the same key
-- again and Square answers with the first payment instead of making a second. The cup checkout sent a NEW key on
-- every tap of Pay — the key was derived from the card token, and every tap asked the card form for a new token —
-- so a retry after a lost answer (the payment went through, the phone never heard) was, to Square, a request it
-- had never seen, and it charged the card again. Pay at pickup sent no key at all, so a retry after "we're
-- offline" put a second unpaid order on the pass.
--
-- WHAT. The page keeps one key per checkout now (components/useIdemKey), and /api/checkout CLAIMS it here — one
-- row, unique on the key — before it asks Square for money (lib/chargeOnce, lib/checkoutClaims). A request whose
-- key is already here is never sent to Square: it is given the first request's own answer, or "still confirming
-- your payment" while that request is in flight or its outcome is unknown. Unknown means Square's answer never
-- came or did not say; the crew is alerted with the key, and the payment, if there is one, carries the key as its
-- reference_id in Square.
--
--   idempotency_key  the checkout's key, exactly as Square is sent it (8–45 characters: lib/squareServer)
--   card             false for pay at pickup, which claims the same way and never calls Square
--   state            started → charged → done, or unknown; a claim stuck in started or charged past any
--                    request's life is moved on by the next retry of its key, which tells the crew
--   status, answer   what the first request answered, said again to every retry of the key
--
-- WHO READS IT. The server alone, with the service role (the routes' supabaseAdmin, which bypasses RLS). RLS is on
-- with no policy, and anon and authenticated hold no privilege on it — Supabase grants every new table to both by
-- default, so that is revoked by name: a browser cannot read whose checkout is whose, or claim a key to block
-- somebody's payment. No function, so nothing to revoke there. No tenant_id: a key is a random uuid a page minted,
-- not business data, and the order it leads to is stamped with its tenant as every order is (0134).
--
-- ORDER. Paste this BEFORE the deploy that reads it. Pasted after, nothing breaks: until it is here,
-- lib/checkoutClaims reports the table missing and the checkout runs without claims, exactly as it did before them.
-- Idempotent: it can run twice.

create table if not exists public.checkout_claims (
  idempotency_key text primary key check (char_length(idempotency_key) between 8 and 45),
  channel         text not null default 'cups',
  card            boolean not null,
  amount_cents    integer,
  state           text not null default 'started' check (state in ('started', 'charged', 'done', 'unknown')),
  payment_id      text,
  status          integer,
  answer          jsonb,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.checkout_claims enable row level security;
revoke all on table public.checkout_claims from public, anon, authenticated;
grant select, insert, update, delete on table public.checkout_claims to service_role;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A card is charged once, however many times Pay is tapped','fix','Ordering',
   'Tapping Pay again after the connection dropped could charge the card a second time: every tap went to Square as a new payment. A checkout now keeps one key until it is settled, and the server records that key before it asks Square for money, so a second tap is told what happened to the first — the order that went in, or "still confirming your payment" — and is never charged again. A pre-order sent twice is one order.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select relrowsecurity from pg_class where oid = 'public.checkout_claims'::regclass;                 -- t
--   select has_table_privilege('anon', 'public.checkout_claims', 'select'),
--          has_table_privilege('authenticated', 'public.checkout_claims', 'insert');                    -- f, f
--   select state, count(*) from public.checkout_claims group by state;    -- 'unknown' rows are the crew's to check
select public.record_migration('0371_a_card_is_charged_once');
