-- ── 0471 MAPPING — only if 0471 stopped ("ask(s) at $0 were saved by a person") ──────────────────────────────────────
-- 0471 converts an ask at $0 to "not set" only where no person ever wrote it. If a person saved some at $0, 0471 stops
-- and changes nothing, because $0 might have meant "not set" (every screen showed it so) or "none needed". This file:
--   STEP 1 (read-only): lists them — id, its label, who saved it last and when.
--   STEP 2 (the owner's choice): put each id in exactly one list, then run STEP 2 as one transaction. It applies 0471
--   exactly as the migration would, with your mapping, and records 0471 in the ledger. Nothing is guessed.
-- Production, read 2026-11-01: 0 such asks — 0471 doesn't stop there, and this file isn't needed.

-- STEP 1 — read-only
select a.id, a.label, a.amount_cents,
       (select l.created_at from public.admin_audit l where l.table_name = 'vision_asks' and l.row_pk = a.id::text and l.actor is not null order by l.created_at desc limit 1) as last_saved_by_a_person
  from public.vision_asks a
 where a.amount_cents = 0
   and (exists (select 1 from public.admin_audit l where l.table_name = 'vision_asks' and l.row_pk = a.id::text and l.actor is not null)
        or not exists (select 1 from public.admin_audit l where l.table_name = 'vision_asks' and l.row_pk = a.id::text));

-- STEP 2 — the owner's mapping (edit the two lists; every id from STEP 1 in exactly one), then run from here to commit.
-- begin;
-- alter table public.vision_asks alter column amount_cents drop not null;
-- alter table public.vision_asks alter column amount_cents set default null;
-- -- system-seeded $0 rows (proven "not set"), as 0471 does:
-- update public.vision_asks a set amount_cents = null where a.amount_cents = 0
--    and exists (select 1 from public.admin_audit l where l.table_name = 'vision_asks' and l.row_pk = a.id::text)
--    and not exists (select 1 from public.admin_audit l where l.table_name = 'vision_asks' and l.row_pk = a.id::text and l.actor is not null);
-- -- MEAN "NOT SET":
-- update public.vision_asks set amount_cents = null where amount_cents = 0 and id in ('<id>', '<id>');
-- -- MEAN "NONE NEEDED": leave at 0 — list them here for the record only:  '<id>', '<id>'
-- select public.record_migration('0471_an_ask_says_whether_it_is_set');
-- commit;
