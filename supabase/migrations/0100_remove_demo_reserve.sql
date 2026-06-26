-- 0100 — remove the leftover demo "FLOW RESERVE" limited-reserve drop from the public Events page.
-- It was never seeded by a migration (created ad hoc), so it can't be reverted by re-running one —
-- delete it by name. reserve_claims cascade on delete. Idempotent: no-op once it's gone.

delete from public.reserves where name = 'FLOW RESERVE';
