// The full schema on a REAL PostgreSQL server (not PGlite): for tests that need several connections at once —
// row locks, concurrent settles, a settle racing the expiry. Opt-in: PG_URL names a superuser connection to a
// server the test may create a database in (e.g. postgres://postgres@/postgres?host=/home/claude/pgreal&port=5499),
// and the `pg` client is found through PG_MODULE (a directory with node_modules/pg) or the repo's own.
// Without PG_URL the caller reports NOT RUN — never a pass.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { SUPABASE_STANDINS, migrationFiles } from "./schema.full.mjs";

const DIR = join(process.cwd(), "supabase/migrations");
export function pgClientClass() {
  const req = createRequire(process.env.PG_MODULE ? join(process.env.PG_MODULE, "x.js") : import.meta.url);
  return req("pg").Client;
}
/** A fresh database with every migration (or those before `before`) on the server PG_URL names. */
export async function realSchema({ before, name } = {}) {
  const Client = pgClientClass();
  const url = process.env.PG_URL;
  const db = name ?? `gt3_${process.pid}_${Date.now()}`;
  const admin = new Client({ connectionString: url });
  await admin.connect();
  await admin.query(`drop database if exists ${db}`);
  await admin.query(`create database ${db}`);
  await admin.end();
  const u = new URL(url); u.pathname = `/${db}`;
  const dbUrl = u.toString();
  const c = new Client({ connectionString: dbUrl });
  await c.connect();
  // Roles are the cluster's: made once, kept.
  await c.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;`);
  await c.query(SUPABASE_STANDINS.replace(/create role anon; create role authenticated; create role service_role;/, "").replace(/create extension if not exists pgcrypto schema extensions;/, "create extension if not exists pgcrypto schema extensions; create extension if not exists pg_trgm;"));
  for (const f of migrationFiles().filter((f) => !before || f < before)) {
    const sql = readFileSync(join(DIR, f), "utf8").replace(/create extension if not exists pg_cron[^;]*;/gi, "");
    try { await c.query(sql); } catch (e) { await c.end(); throw new Error(`realSchema: ${f} would not load — ${String(e.message || e).split("\n")[0]}`); }
  }
  await c.end();
  return { url: dbUrl, name: db, drop: async () => { const a = new Client({ connectionString: url }); await a.connect(); await a.query(`drop database if exists ${db} with (force)`); await a.end(); } };
}
