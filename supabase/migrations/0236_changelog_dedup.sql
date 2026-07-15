-- 0236 — Changelog reconciliation. 0235 logged four rows for the Jul-15 design pass, but two of them
-- ("One design system, every screen" and "One switch for what's public") duplicated entries an earlier
-- ship had already logged for the SAME work: the app-wide design-system rollout (cf. "One design
-- language, everywhere" / "The whole storefront speaks one language") and the is_public visibility
-- switch (cf. "Private events stay private"). Duplicate headliners for one pass are clutter. We keep the
-- two rows 0235 added that were genuinely new — "Find Us — one road to where we'll be" and "Cleaner live
-- Route board" — and remove the two duplicates here.
--
-- Forward-only correction (0235 is already shipped, so it can't be amended in place); prod was reconciled
-- to this exact state at apply time. Idempotent: deleting rows that aren't present is a no-op, and it
-- targets only the two exact titles 0235 introduced — the earlier ship's entries have different titles
-- and are untouched.

delete from public.changelog
where shipped_on = '2026-07-15'
  and title in ('One design system, every screen', 'One switch for what''s public');

-- verify:
--   select count(*) from public.changelog where shipped_on = '2026-07-15';  -- expect 8 (6 prior + 2 kept)
