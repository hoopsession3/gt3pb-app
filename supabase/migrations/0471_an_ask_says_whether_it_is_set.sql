-- ── 0471 — AN ASK SAYS WHETHER IT'S SET (IMS8 P3, three states for an ask's amount) ───────────────────────────────────
-- 2026-11-01. Ryan: "Model ask amounts with three distinct states: unset, confirmed zero and specified amount… Preserve
-- existing records and financial behavior… Do not convert a genuinely confirmed zero to NULL. If intent cannot be
-- established, report the affected records and propose an explicit mapping." A second run changes nothing.
--
-- WHY. vision_asks.amount_cents was `not null default 0`, and every screen read 0 as "not set yet" (lib/vision askTotals:
-- "A $0 line is a line with no amount set yet"; the roadmap "amount to be set", the plans "Being priced", the presenter
-- "—"); the roadmap form wrote 0 when the amount was left empty. So 0 could never say "no capital is needed here".
--
-- NOW. amount_cents is nullable, default NULL: NULL = not set yet · 0 = confirmed, no capital needed · > 0 = the amount.
--
-- EXISTING ROWS — ONLY WHERE THE INTENT IS PROVEN. A row at 0 becomes NULL ("not set", which is what every screen has
-- always shown it as) only when NO PERSON ever wrote its amount: every activity-log line for the row (admin_audit,
-- attached to vision_asks since 0447, the table's first day) is the system's own (actor NULL — a migration's seed, e.g.
-- 0447's "Build-out / Equipment / Opening runway — Set the amount."). A row at 0 that a person saved could be either
-- meaning, so this migration does NOT guess: it counts them, and if there are any it STOPS, changing nothing, and says
-- how many — the owner decides the mapping (supabase/cleanup/0471_ask_mapping.sql lists them by id, and applies 0471 with the
-- owner's explicit list of which mean "not set" and which mean "none needed"). Production, read
-- 2026-11-01: 3 asks, all 0, all seeded by 0447 and never edited → 3 become NULL; 0 ambiguous.
--
-- NOTHING ELSE MOVES. Totals are unchanged (NULL and 0 both add nothing). An investor link sends the amount as before
-- (vision_share_payload names amount_cents; NULL passes as a plain value). Paste this BEFORE deploying the app that reads
-- 0 as "confirmed" — the old app keeps reading NULL as "not set" (it maps it to 0), so either order is safe for display,
-- and this order is exact.
--
-- set lock_timeout (database F16): one column's NOT NULL dropped and its default changed (no rewrite); one update of
-- proven rows.
-- rollback: update vision_asks set amount_cents = 0 where amount_cents is null; alter column amount_cents set default 0,
--   set not null.
-- changelog: none — the asks are the owner's planning; what changes is that "none needed" can be said.

set lock_timeout = '5s';

do $$
declare ambiguous int; proven int;
begin
  -- A second run (the column already nullable) changes nothing: what was proven was converted the first time, and a 0
  -- saved since is a confirmed zero by the new rule.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vision_asks' and column_name = 'amount_cents' and is_nullable = 'YES') then
    return;
  end if;
  -- Rows at 0 that a person ever wrote (or that have no activity line at all): their intent isn't proven.
  select count(*) into ambiguous from public.vision_asks a
   where a.amount_cents = 0
     and (exists (select 1 from public.admin_audit l where l.table_name = 'vision_asks' and l.row_pk = a.id::text and l.actor is not null)
          or not exists (select 1 from public.admin_audit l where l.table_name = 'vision_asks' and l.row_pk = a.id::text));
  if ambiguous > 0 then
    raise exception '0471 stopped, nothing changed: % ask(s) at $0 were saved by a person (or have no history), so whether they mean "not set" or "none needed" isn''t proven. Run supabase/cleanup/0471_ask_mapping.sql to see them and map each one explicitly.', ambiguous
      using errcode = 'P0001';
  end if;
  alter table public.vision_asks alter column amount_cents drop not null;
  alter table public.vision_asks alter column amount_cents set default null;
  update public.vision_asks a set amount_cents = null
   where a.amount_cents = 0
     and not exists (select 1 from public.admin_audit l where l.table_name = 'vision_asks' and l.row_pk = a.id::text and l.actor is not null);
  get diagnostics proven = row_count;
  raise notice '0471: % ask(s) at $0, written only by the system, now say "not set" (NULL).', proven;
end $$;

select public.record_migration('0471_an_ask_says_whether_it_is_set');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
