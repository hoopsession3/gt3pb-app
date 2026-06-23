-- 0039 — make event_approvals RLS plan-stable. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Symptom: the sign-off strip showed 0/1 even with a valid approval row present. Traced to
-- the exact query the strip runs — event_approvals?select=approver_id&event_id=eq.<id> —
-- returning an EMPTY set server-side, while the same row was readable via select=*, an
-- event_id=in.() filter, an approver_id filter, or no filter at all. Not RLS-blocking (row
-- visible every other way) and not HTTP/CDN caching (cache:no-store, no cache headers). The
-- signature is a PostgREST generic (cached) plan mis-evaluating the bare public.is_staff()
-- security qual for that one repeated query shape.
--
-- Fix: wrap the function calls in a scalar subquery — the Supabase-recommended RLS pattern.
-- (select public.is_staff()) / (select auth.uid()) are evaluated once per query as an
-- InitPlan rather than baked into a generic plan, which both stabilizes the result and is
-- faster (one evaluation instead of per-row). Same semantics, robust plan.

drop policy if exists "approvals staff read" on public.event_approvals;
create policy "approvals staff read" on public.event_approvals
  for select using ((select public.is_staff()));

drop policy if exists "approvals self write" on public.event_approvals;
create policy "approvals self write" on public.event_approvals
  for insert to authenticated
  with check ((select auth.uid()) = approver_id and (select public.is_staff()));

drop policy if exists "approvals self delete" on public.event_approvals;
create policy "approvals self delete" on public.event_approvals
  for delete using ((select auth.uid()) = approver_id);
