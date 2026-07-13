-- 0211 — Accountability: every objective gets ONE owner. Goals carried only created_by/author_name
-- (who wrote it), never an accountable owner — fine for two founders, a gap the moment work is shared
-- across a 4-5 person team. Adds goals.owner_user_id (the base of an OKR-with-owners cascade; the
-- fuller objective→key-result nesting via initiatives is a follow-up). Idempotent + additive.

alter table public.goals add column if not exists owner_user_id uuid references public.profiles(id) on delete set null;
-- Belt-and-suspenders for the profiles-column-grant gotcha (some tables revoke table UPDATE and need
-- explicit column grants for client writes to land); harmless if table UPDATE is already granted.
grant update(owner_user_id) on public.goals to authenticated;

-- verify:
--   select column_name from information_schema.columns where table_name='goals' and column_name='owner_user_id'; -- 1 row
