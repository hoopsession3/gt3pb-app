-- SECURITY SNAPSHOT — what the database actually lets the API roles do. Paste into the Supabase
-- SQL editor and Run; read every row back into supabase/schema.security.json with
--
--   node scripts/security.snapshot.mjs --from <rows.json>      (see that file's header)
--
-- It answers, from pg_catalog and not from the migrations directory, for every relation in public:
-- is row-level security on, what may anon / authenticated / service_role do, whether a view runs
-- as its invoker, and for every policy: command, permissive, roles, and the USING / WITH CHECK
-- expressions exactly as Postgres prints them. Plus every SECURITY DEFINER function and who may
-- execute it. Nothing is classified here — the rules live in scripts/security.audit.mjs, where
-- they have tests. This only measures.
--
-- Shape (compact on purpose — the result is read back through a grid, cell by cell):
--   x  every distinct policy expression, once; policies point at it by index
--   t  relation → [kind, rls, force, anon, authenticated, service_role, invoker, [policies]]
--      policy   → [name, cmd (r/a/w/d/*), permissive, roles ("public" | "anon,authenticated"), using#, check#]
--   f  definer function → [name, identity args, anon?, authenticated?, service_role?]
--   k  every unique index in public → [table, index, primary?]   (R19 — names only: the money's keys, proven present)
--   g  every trigger a migration or the dashboard made on public, and on auth.users (the accounts' — R19 review, fourth
--      pass; that table named "auth.users") → [table, trigger, enabled (O/D/R/A)]   (R19 — names and switches only,
--      never a definition: a webhook's carries its address)
--   b  every storage bucket → [id, public?, size limit, allowed types]   (R19)
--   p  the two platform tables whose rows are the platform's own gates (R23 — the 10/10 audit, database F15):
--      storage.objects (every file, every bucket) and realtime.messages (who may join a private channel, 0428) →
--      [rls, force, anon, authenticated, service_role, [policies]] — policies as t's, their expressions in x
--   f  …and since R23 a sixth: whether the function pins its search_path (a definer that doesn't runs whatever an
--      earlier schema on the caller's path names the same)
--
-- Output: one JSON document cut into rows of 2000 characters so the grid can show every row
-- whole, then one last row with the document's row count, length and sha256, so a read-back that
-- dropped, doubled or trimmed a row cannot be mistaken for the real thing.
with
roles as (select unnest(array['anon','authenticated','service_role']) as r),
tbl as (
  select c.oid, c.relname as name, c.relkind as kind, c.relrowsecurity as rls, c.relforcerowsecurity as force, c.reloptions
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v','m')
),
priv as (
  select t.oid, r.r as role,
         concat(case when has_table_privilege(r.r, t.oid, 'select') then 'r' else '' end,
                case when has_table_privilege(r.r, t.oid, 'insert') then 'i' else '' end,
                case when has_table_privilege(r.r, t.oid, 'update') then 'u' else '' end,
                case when has_table_privilege(r.r, t.oid, 'delete') then 'd' else '' end) as p
  from tbl t cross join roles r
),
polraw as (
  select p.polrelid as oid, p.polname as n, p.polcmd::text as c, p.polpermissive as perm,
         case when p.polroles = '{0}' then 'public'
              else (select string_agg(rolname::text, ',' order by rolname) from pg_roles where oid = any(p.polroles)) end as r,
         pg_get_expr(p.polqual, p.polrelid) as q,
         pg_get_expr(p.polwithcheck, p.polrelid) as w
  from pg_policy p join tbl t on t.oid = p.polrelid
),
ptbl as (
  select c.oid, n.nspname || '.' || c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where (n.nspname = 'storage' and c.relname = 'objects') or (n.nspname = 'realtime' and c.relname = 'messages')
),
ppolraw as (
  select p.polrelid as oid, p.polname as n, p.polcmd::text as c, p.polpermissive as perm,
         case when p.polroles = '{0}' then 'public'
              else (select string_agg(rolname::text, ',' order by rolname) from pg_roles where oid = any(p.polroles)) end as r,
         pg_get_expr(p.polqual, p.polrelid) as q,
         pg_get_expr(p.polwithcheck, p.polrelid) as w
  from pg_policy p join ptbl t on t.oid = p.polrelid
),
exprs as (
  select e, row_number() over (order by e) - 1 as i
  from (select distinct q as e from polraw where q is not null union select distinct w from polraw where w is not null
        union select distinct q from ppolraw where q is not null union select distinct w from ppolraw where w is not null) d
),
pol as (
  select pr.oid,
         json_build_array(pr.n, pr.c, pr.perm, pr.r,
           (select i from exprs where e = pr.q), (select i from exprs where e = pr.w)) as j,
         pr.n
  from polraw pr
),
rels as (
  select json_object_agg(t.name, json_build_array(
           t.kind, t.rls, t.force,
           (select p from priv where oid = t.oid and role = 'anon'),
           (select p from priv where oid = t.oid and role = 'authenticated'),
           (select p from priv where oid = t.oid and role = 'service_role'),
           case when t.kind in ('v','m') then coalesce(
             (select (option_value in ('true','on','1')) from pg_options_to_table(t.reloptions) o(option_name, option_value)
               where option_name = 'security_invoker' limit 1), false) end,
           coalesce((select json_agg(pl.j order by pl.n) from pol pl where pl.oid = t.oid), '[]'::json)
         ) order by t.name) as j
  from tbl t
),
plat as (
  select json_object_agg(t.name, json_build_array(
           t.rls, t.force,
           concat(case when has_table_privilege('anon', t.oid, 'select') then 'r' else '' end, case when has_table_privilege('anon', t.oid, 'insert') then 'i' else '' end,
                  case when has_table_privilege('anon', t.oid, 'update') then 'u' else '' end, case when has_table_privilege('anon', t.oid, 'delete') then 'd' else '' end),
           concat(case when has_table_privilege('authenticated', t.oid, 'select') then 'r' else '' end, case when has_table_privilege('authenticated', t.oid, 'insert') then 'i' else '' end,
                  case when has_table_privilege('authenticated', t.oid, 'update') then 'u' else '' end, case when has_table_privilege('authenticated', t.oid, 'delete') then 'd' else '' end),
           concat(case when has_table_privilege('service_role', t.oid, 'select') then 'r' else '' end, case when has_table_privilege('service_role', t.oid, 'insert') then 'i' else '' end,
                  case when has_table_privilege('service_role', t.oid, 'update') then 'u' else '' end, case when has_table_privilege('service_role', t.oid, 'delete') then 'd' else '' end),
           coalesce((select json_agg(json_build_array(pr.n, pr.c, pr.perm, pr.r,
                       (select i from exprs where e = pr.q), (select i from exprs where e = pr.w)) order by pr.n)
                     from ppolraw pr where pr.oid = t.oid), '[]'::json)
         ) order by t.name) as j
  from ptbl t
),
fns as (
  select json_agg(json_build_array(
           p.proname, pg_get_function_identity_arguments(p.oid),
           has_function_privilege('anon', p.oid, 'execute'),
           has_function_privilege('authenticated', p.oid, 'execute'),
           has_function_privilege('service_role', p.oid, 'execute'),
           coalesce((select bool_or(c like 'search_path=%') from unnest(p.proconfig) c), false)
         ) order by p.proname, pg_get_function_identity_arguments(p.oid)) as j
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
),
ukeys as (
  select json_agg(json_build_array(c.relname, i.relname, x.indisprimary, x.indisvalid) order by c.relname, i.relname) as j
  from pg_index x
  join pg_class i on i.oid = x.indexrelid
  join pg_class c on c.oid = x.indrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and x.indisunique
),
trigs as (
  select json_agg(json_build_array(case when n.nspname = 'public' then c.relname else n.nspname || '.' || c.relname end, t.tgname, t.tgenabled::text)
                  order by n.nspname <> 'public', c.relname, t.tgname) as j
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users')) and not t.tgisinternal
),
bkts as (
  select json_agg(json_build_array(b.id, b.public, b.file_size_limit, b.allowed_mime_types) order by b.id) as j
  from storage.buckets b
),
doc as (
  select json_build_object(
    'pulled_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'project', current_database(),
    'ledger', (select json_build_object('count', count(*), 'max_seq', max(seq)) from public.schema_migrations),
    'x', (select coalesce(json_agg(e order by i), '[]'::json) from exprs),
    't', (select j from rels),
    'f', (select coalesce(j, '[]'::json) from fns),
    'k', (select coalesce(j, '[]'::json) from ukeys),
    'g', (select coalesce(j, '[]'::json) from trigs),
    'b', (select coalesce(j, '[]'::json) from bkts),
    'p', (select coalesce(j, '{}'::json) from plat)
  )::text as d
)
select i as row, substr(d, i * 2000 + 1, 2000) as chunk
from doc, generate_series(0, (length(d) - 1) / 2000) as i
union all
select (length(d) - 1) / 2000 + 1,
       json_build_object('rows', (length(d) - 1) / 2000 + 1, 'length', length(d), 'sha256', encode(sha256(convert_to(d, 'UTF8')), 'hex'))::text
from doc
order by 1;
