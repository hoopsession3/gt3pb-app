// THE WHOLE SCHEMA, IN MEMORY (2026-10-06, the account-erasure round).
//
//   import { fullSchema } from "./fixtures/schema.full.mjs";
//   const db = await fullSchema();      // every migration in supabase/migrations, applied in order
//
// The other database tests stand up the few tables they need by hand, and agree with whatever their
// author believed about the rest. Some questions cannot be asked that way — "what still points at
// this account?" is a question about every foreign key in the schema — so this applies all of them
// (350 as written, 2026-10-06) to PGlite, with Supabase's own schemas stood in for: auth (users,
// identities, uid() from a session setting), storage (buckets, objects, the path helpers), cron, net,
// vault, supabase_functions and the realtime publication. pg_trgm is PGlite's own; pg_cron is not
// available and nothing here needs it to run.
//
// A migration that will not load fails the load with its file name: that is a migration that would
// also need care in production, or a stand-in this file should grow.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");

export const SUPABASE_STANDINS = `
  create role anon; create role authenticated; create role service_role;
  -- Supabase's own default privileges (role postgres, schema public, 2026-10-14): every table, view, sequence and
  -- function made here is granted to anon, authenticated and service_role BY NAME — not through PUBLIC. So a revoke
  -- from public alone leaves all three able to call a function, and a table's guard is its RLS, never a missing grant.
  -- Without these the schema here was stricter than production's, and a door left open there was shut here.
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  create schema auth; create schema storage; create schema extensions; create schema cron;
  create schema net; create schema vault; create schema supabase_functions;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, phone text,
    raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz default now(), last_sign_in_at timestamptz, email_confirmed_at timestamptz);
  -- provider and provider_id as Supabase keeps them (Apple's sub is an Apple identity's provider_id): 0403 asks by them.
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
    provider text, provider_id text, identity_data jsonb default '{}'::jsonb);
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
  create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create or replace function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.email', true), '') $$;
  create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint,
    allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text,
    owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), path_tokens text[]);
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  create or replace function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
  create or replace function storage.extension(name text) returns text language sql immutable as $$ select split_part(name, '.', 2) $$;
  create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
  -- pg_cron's run log, the columns 0419's cron_watch reads (and prunes): one row per run of a job.
  create table cron.job_run_details (runid bigserial primary key, jobid bigint, job_pid int, database text, username text, command text, status text, return_message text, start_time timestamptz, end_time timestamptz);
  create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ insert into cron.job (jobname, schedule, command) values (job_name, schedule, command) returning jobid $$;
  create or replace function cron.unschedule(job_name text) returns boolean language sql as $$ delete from cron.job where jobname = job_name returning true $$;
  create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
  create or replace function net.http_get(url text, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), name text, secret text);
  create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
  create or replace function supabase_functions.http_request() returns trigger language plpgsql as $$ begin return new; end $$;
  create publication supabase_realtime;
`;

export function migrationFiles() {
  return readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
}

/** A PGlite with every migration applied — or, with `before: "0353"`, every one before that number
 * (the schema as production had it, for a test that shows what a migration changed). Throws with the
 * file that would not load. */
export async function fullSchema({ before } = {}) {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(SUPABASE_STANDINS);
  for (const f of migrationFiles().filter((f) => !before || f < before)) {
    const sql = readFileSync(join(DIR, f), "utf8").replace(/create extension if not exists pg_cron[^;]*;/gi, "");
    try { await db.exec(sql); }
    catch (e) { throw new Error(`fullSchema: ${f} would not load — ${String(e.message || e).split("\n")[0]}`); }
  }
  return db;
}
