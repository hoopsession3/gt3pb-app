-- 0250 — give Founding VIP its own perks, separate from plain Founding.
--
-- Ryan (2026-07-28), one message after 0249 shipped the vip_verified flag: "Founding member and
-- founding vip are different and will have their own perks." Right — 0249 only made the two
-- classifications visible to staff; it didn't touch what either one actually GETS. Perks are real,
-- pricing-affecting rows in public.member_benefits (0176) — the server reads them at checkout to
-- apply free refills, price overrides, and percent-off, on both the cups and reserve channels
-- (lib/benefits.ts). Today every 'founding'-tier customer reads the exact same 3 seeded perks;
-- there's no way to reserve a perk for verified Founding VIPs only.
--
-- Fix: one new orthogonal column, same shape as 0249's approach on customers — member_benefits
-- keeps its existing tier ladder (member/founding), and requires_vip is an independent gate on top
-- of it, not a new tier value. A requires_vip perk only applies to a customer who is BOTH
-- tier='founding' AND vip_verified — additive, not a separate track: a Founding VIP still gets
-- every plain-Founding perk, plus whatever gets tagged VIP-only. Guarded with a CHECK so a
-- VIP-exclusive perk can never be attached to 'member' tier (VIP only exists as a proven layer on
-- top of Founding — there's no "member VIP" concept anywhere else in the app).
--
-- All three read paths get the same filter:
--   - my_member_benefits() (the customer's own perks, SQL-side)
--   - lib/benefits.ts benefitsForUser() (server-side pricing, authoritative at checkout)
--   - CrmPanel's perks list (what staff see on a customer's card)
-- None of the 3 existing seeded perks change meaning here — they stay requires_vip=false (every
-- Founding member keeps them, VIP or not). What specific extra perk a Founding VIP gets is Ryan's
-- call, not mine to invent — this migration only builds the switch. He can set the actual perks
-- himself: also adding a Founding-perks admin panel (mirrors the existing discount-codes panel,
-- which already proved the "mint a rule as data, no deploy" pattern for member_benefits — it just
-- never got built for the tier side, only the code side).
--
-- Also: member_benefits was never added to the realtime publication (same gap 0248 found and
-- fixed on customers) — CodesPanel.tsx has called useRealtimeTable("member_benefits", reload)
-- for a while, silently inert. Fixed here too since the new perks panel depends on it working.

alter table public.member_benefits add column if not exists requires_vip boolean not null default false;

alter table public.member_benefits drop constraint if exists member_benefits_vip_needs_founding;
alter table public.member_benefits add constraint member_benefits_vip_needs_founding
  check (not requires_vip or tier = 'founding');

create or replace function public.my_member_benefits() returns setof public.member_benefits
  language sql stable security definer set search_path = public as $$
  select b.* from public.member_benefits b
  join public.customers c on c.user_id = auth.uid()
  where b.active and b.scope = 'tier' and b.tier = c.tier
    and (not b.requires_vip or c.vip_verified);
$$;

alter publication supabase_realtime add table public.member_benefits;

-- verify:
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='member_benefits' and column_name='requires_vip'; -- 1 row
--   select conname from pg_constraint where conname = 'member_benefits_vip_needs_founding';         -- 1 row
--   select count(*) from public.member_benefits where requires_vip;                                 -- 0 today (none tagged yet — Ryan's to set)
--   select exists(select 1 from pg_publication_tables
--     where pubname='supabase_realtime' and tablename='member_benefits');                            -- true
