-- 0068 — OUTLOOK TWO-WAY SYNC: store the company's Microsoft 365 connection (OAuth tokens) and map
-- our events to their Outlook calendar counterparts so sync is idempotent. Single company connection
-- (id=1), owner-managed only. Tokens are written/read by the server (service role) — never exposed to
-- the browser; RLS keeps even authenticated clients out. Apply after 0067.

create table if not exists public.outlook_connection (
  id            int primary key default 1 check (id = 1),  -- single company mailbox
  account_email text,
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  calendar_id   text,                                      -- target calendar (default = primary)
  pending_state text,                                      -- CSRF state issued by /connect, cleared on callback
  connected_at  timestamptz,
  last_sync_at  timestamptz,
  last_sync_note text,
  updated_at    timestamptz not null default now()
);

-- Map an event to its Outlook counterpart so push/pull never double-creates.
alter table public.events add column if not exists outlook_event_id text;        -- Graph event id
alter table public.events add column if not exists outlook_synced_at timestamptz; -- last push/pull touch
create index if not exists events_outlook on public.events(outlook_event_id);

drop trigger if exists outlook_conn_touch on public.outlook_connection;
create trigger outlook_conn_touch before update on public.outlook_connection for each row execute function public.touch_updated_at();

-- Tokens are secrets: lock the table to the server. No client (even authenticated) may read/write it;
-- the API routes use the service-role key, which bypasses RLS. RLS ON + no policies = deny all clients.
alter table public.outlook_connection enable row level security;
