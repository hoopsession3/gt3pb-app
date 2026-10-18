-- ── 0435 — EVERY ROW THAT POINTS AT ANOTHER IS FOUND BY AN INDEX ────────────────────────────────────────────────────
-- 2026-10-18. R30 of the 10/10 audit (database F19; Ryan, 2026-10-17: "Keep working to improve to a 10"). Paste into
-- Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. A foreign key is checked from both ends. A row added looks up what it points at, and the primary key's index
-- answers that. A row deleted — an account erased, an event, a stop or a customer removed — asks every table that may
-- point at it, and where the pointing column has no index of its own, the answer is that whole table read, once for
-- each row deleted. 0419 and 0421 indexed five; about a hundred and fifty were left: erasing one account read sixty-two
-- tables from top to bottom (seventy-eight keys point at auth.users with no index of their own), and the console's
-- "collected by", "voided by" and "for this event" lookups read the same way.
--
-- WHAT. One pass over the catalog as it is in this database — an index made in the dashboard counts — and every
-- foreign key in public whose columns don't lead an index gets one. A column that may be empty gets a partial index,
-- `where <col> is not null`: it still serves the check (an empty column points at nothing) and leaves the empty rows
-- out. An index that already leads with the key's columns counts, whole or `where <col> is not null`; one kept to some
-- of the rows (`where not done`) doesn't, because the check asks of every row.
--   · not the tenant keys (tenant_id → tenants, 83 of them): with one tenant the column has one value, an index on it
--     alone is never chosen, and no tenant is ever deleted. When there are two, the tenant goes first in the indexes a
--     tenant's reads use, (tenant_id, …), not in one of its own.
-- From here a foreign key written in a migration comes with its index: scripts/db.r30.test.mjs reads every migration
-- into a database and fails the release on a key without one.
--
-- set lock_timeout (database F16): each index holds its table's share lock from its build to the paste's end — reads go
-- on; writes to the hundred-odd tables it indexes wait until the paste commits: a few seconds on tables this size,
-- longer as they grow (R32 put this right — the audit's DB11-04; it once said writes wait only the moment each takes).
-- Paste it on its own when service is quiet: APPLY_ALL_PENDING makes each migration its own transaction (R32). If a
-- table is busy the paste stops after five seconds and changes nothing, and a statement_timeout of a minute ends it
-- whole if the builds ever run long; run it again a moment later.
-- existing rows: indexed as they stand.
-- changelog: none — nothing anyone sees changes; a delete and the console's lookups stop reading whole tables.

set lock_timeout = '5s';
set statement_timeout = '60s';   -- the builds together, at most a minute (R32): a paste that would hold writes longer stops

do $$
declare
  r record;
  base text;
  idx text;
  n int;
  made int := 0;
  seen text[] := '{}';   -- two keys on the same columns (a constraint written twice) want one index
  k text;
begin
  for r in
    select t.relname,
           array_agg(a.attname::text order by k.i) as cols,
           bool_or(not a.attnotnull) as may_be_empty
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace s on s.oid = t.relnamespace and s.nspname = 'public'
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, i)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.contype = 'f'
       and c.confrelid <> 'public.tenants'::regclass
       and not exists (
         select 1 from pg_index x
          where x.indrelid = c.conrelid
            and x.indisvalid
            and (x.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
            and (x.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey
            and (x.indpred is null
                 or (cardinality(c.conkey) = 1
                     and pg_get_expr(x.indpred, x.indrelid) =
                         format('(%s IS NOT NULL)', (select quote_ident(b.attname) from pg_attribute b
                                                      where b.attrelid = c.conrelid and b.attnum = c.conkey[1])))))
     group by c.oid, t.relname
     order by t.relname, min(c.conname)
  loop
    k := r.relname || ':' || (select string_agg(x, ',' order by x) from unnest(r.cols) as x);
    continue when k = any(seen);
    seen := seen || k;
    base := left(r.relname || '_' || array_to_string(r.cols, '_'), 56);
    idx := base || '_fk_idx';
    n := 2;
    while exists (select 1 from pg_class where relname = idx and relnamespace = 'public'::regnamespace) loop
      idx := left(base, 52) || '_fk' || n || '_idx';
      n := n + 1;
    end loop;
    execute format('create index %I on public.%I (%s)%s', idx, r.relname,
                   (select string_agg(quote_ident(x), ', ') from unnest(r.cols) as x),
                   case when r.may_be_empty and cardinality(r.cols) = 1 then format(' where %I is not null', r.cols[1]) else '' end);
    made := made + 1;
  end loop;
  raise notice '0435: % foreign keys indexed', made;
end $$;

-- verify (numbers only — the foreign keys outside the tenant keys that no index leads; 0 after this paste):
--   select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid
--    where c.contype = 'f' and t.relnamespace = 'public'::regnamespace and c.confrelid <> 'public.tenants'::regclass
--      and not exists (select 1 from pg_index x where x.indrelid = c.conrelid and x.indisvalid
--            and (x.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
--            and (x.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey
--            and (x.indpred is null or (cardinality(c.conkey) = 1 and pg_get_expr(x.indpred, x.indrelid) =
--                 format('(%s IS NOT NULL)', (select quote_ident(b.attname) from pg_attribute b
--                                              where b.attrelid = c.conrelid and b.attnum = c.conkey[1])))));   -- 0
select public.record_migration('0435_every_row_that_points_at_another_is_found_by_an_index');
reset statement_timeout;
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
