-- 0477 · RECIPE VERSIONS: THE API ROLE KEEPS ITS FOUR VERBS, NOTHING MORE
--
-- Why (2026-11-23, the 0476 post-check): public.recipe_versions arrived with the platform's default privileges, so
-- authenticated holds TRUNCATE, TRIGGER and REFERENCES as well as the SELECT, INSERT, UPDATE and DELETE 0476 granted.
-- TRUNCATE is not subject to row-level security: whoever can run it empties every business's recipe history at once. The
-- app never needs it, nor TRIGGER or REFERENCES. Revoked here, as the house already does for its other tables (0356,
-- 0388, 0389). Policies, the guard and the four granted verbs are untouched.
--
-- Rollback: grant truncate, trigger, references on public.recipe_versions to authenticated; and take 0477 off the ledger.
-- lock-timeout: none — a privilege change only; no row or table data is touched
-- changelog: none — a tightening of 0476, reviewed with its post-check

revoke truncate, trigger, references on public.recipe_versions from authenticated;

select public.record_migration('0477_recipe_versions_api_writes_only');
