# GT3 Performance Bar — Risk Register

Known operational & security risks for the GT3PB platform (app, Supabase, integrations).
Add new risks at the top. Close one by setting **Status: Closed** with the date and how it was resolved.

| ID | Risk | Severity | Status | Owner |
|----|------|----------|--------|-------|
| R-004 | Anthropic API key exposed in chat (rotation deferred) | Medium | Open (rotation pending) | Ryan |
| R-001 | Unencrypted BI connection (Looker Studio → Supabase) | Medium | Accepted (temporary) | Ryan |
| R-002 | Per-tenant RLS staged but not enforced | Medium | Open (DB enforcement written — `0134` pending prod apply + route sweep) | Ryan |
| R-003 | Audit-log trigger write volume / retention | Low–Medium | Closed (2026-07-05) | Ryan |

---

## R-004 — Anthropic API key exposed in chat (rotation deferred)

- **Opened:** 2026-06-23
- **Severity:** Medium
- **Status:** Open (rotation pending — key intentionally left active for now)
- **Owner:** Ryan

**Description.** During setup of the in-app AI agents, a live Anthropic API key (`sk-ant-…`) was
pasted in plaintext into an assistant chat. By decision the key was **not** rotated immediately —
it remains active and powers the app via the `ANTHROPIC_API_KEY` env var. The key value is **not**
stored in this repo, any commit, or any code (server-side env only).

**Impact.** Anyone who can read that chat transcript can use the key to **spend against the
Anthropic billing account** (financial loss / quota exhaustion). It is a billing/credential risk
only — the key grants **model inference, not access to GT3PB data** (no Supabase, no customer PII).

**Likelihood.** Low–Medium — depends entirely on who can access the transcript.

**Compensating controls (already in place).**
- A **low monthly usage cap** is set in the Anthropic Console — a hard ceiling on any misuse.
- The key scope is **inference only**; it cannot read or write app/customer data.
- The key lives **only** in the host env (Vercel), never in the repo or client bundle.

**Plan / mitigation.** Rotate when convenient: create a fresh key in the Anthropic Console →
update `ANTHROPIC_API_KEY` in Vercel → redeploy → **delete the exposed key**. Keep the spend cap.

**Close when:** the exposed key is deleted and replaced by a fresh key that has never been shared
in plaintext.

---

## R-001 — Unencrypted BI connection (Looker Studio → Supabase)

- **Opened:** 2026-06-23
- **Severity:** Medium
- **Status:** Accepted (temporary — pending Power BI migration)
- **Owner:** Ryan

**Description.** The Looker Studio PostgreSQL data source connects to the Supabase session
pooler (`aws-1-us-east-2.pooler.supabase.com:5432`) as `bi_readonly` with **SSL disabled**
("Enable SSL" left unchecked). Enabling SSL was attempted but the Looker connector would not
complete a working handshake through the pooler, so the connection was left unencrypted in
order to get reporting working.

**Impact.** The `bi_readonly` password and all query results travel in **cleartext** between
Google's Looker servers and Supabase. `bi_readonly` has `BYPASSRLS`, so it can read **every
table** — including PII (`profiles`) and the `audit_log`. Anyone able to observe that network
path could read both the data and the credential.

**Likelihood.** Low — interception requires a privileged position on the Google↔AWS path.
The data sensitivity is what keeps the consequence non-trivial.

**Compensating controls (already in place).**
- `bi_readonly` is **read-only** — `SELECT` only, zero write grants (verified). No data can be altered through it.
- Supabase **"Enforce SSL" is off**, so non-SSL is permitted by design (not a misconfiguration, an accepted setting).

**Plan / mitigation.**
- **Primary:** migrate BI to **Power BI** (Microsoft 365-native, uses the existing
  `ryan@gt3pb.com` identity), which replaces this connection entirely and handles Postgres SSL cleanly.
- **On migration:** decommission the Looker Studio data source and **rotate or disable the
  `bi_readonly` password** (it was transmitted in cleartext, so treat it as exposed).
- **Optional interim hardening:** add a Supabase **Network Restriction** (IP allowlist) and/or
  turn on **Enforce SSL** once a working SSL client is connected.

**Close when:** Power BI migration is complete → Looker Studio data source removed **and**
`bi_readonly` credential rotated/disabled.

---

## R-002 — Per-tenant RLS staged but not enforced

- **Opened:** 2026-06-23
- **Severity:** Medium (latent — no live exposure while single-tenant)
- **Status:** Open (staged)
- **Owner:** Ryan

**Description.** Migration `0040` laid the multi-tenant foundation (`tenants` table, `tenant_id`
backfilled across business tables, `current_tenant()`), but per-tenant RLS isolation is **not
enforced** — writes rely on the column DEFAULT and policies do not yet filter by tenant. The
platform is currently **single-tenant** (one founding GT3PB tenant), so there is no live
cross-tenant exposure today.

**Impact.** If a second tenant is onboarded **before** tenant-scoped RLS is enforced and the app
stamps `tenant_id` on writes, tenants could read or write each other's rows.

**Plan / mitigation.** Before going multi-tenant: (1) make the app explicitly set `tenant_id` on
every insert, (2) switch RLS policies to filter by `current_tenant()`, (3) verify isolation with
two test tenants.

**Progress (2026-07-08).** Migration `0134_tenant_enforcement` ships the DB half:
- `stamp_tenant()` BEFORE INSERT triggers on every `tenant_id` table — the caller's profile tenant
  wins on write (closes plan step 1 at the database; no app-code sweep needed).
- A **restrictive** `"tenant isolation"` policy (`tenant_id = effective_tenant()`) on every
  `tenant_id` table that already has RLS enabled — it ANDs onto the existing policies (closes step
  2 for all PostgREST/client access). Anon resolves to the founding tenant, so public surfaces are
  unchanged.
- `tenants` self-row visibility (a tenant can't enumerate other customers).

**Remaining to close:** (a) apply `0134` on prod, (b) sweep the `supabaseAdmin` service-role routes
(`app/api/agents/*` etc.) to scope queries with `tenantFromRequest()` (`lib/apiAuth.ts`) — the
service role bypasses RLS, (c) run the two-tenant verify in `0134`'s footer, (d) decide per-table
on the RLS-off / no-`tenant_id` tables the verify queries list (incl. cross-tenant push fan-out in
the edge function).

**Close when:** tenant-scoped RLS is enforced and verified — **or** a decision to remain
single-tenant is recorded here.

---

## R-003 — Audit-log trigger write volume / retention

- **Opened:** 2026-06-23
- **Closed:** 2026-07-05
- **Severity:** Low–Medium
- **Status:** Closed — retention policy in place; growth is now bounded.
- **Owner:** Ryan

**Description.** The append-only `audit_log` (migration `0042`) is populated by triggers on
high-write tables (orders, subscriptions, profiles, reserves, assets, inventory_items,
event_approvals). Every write also writes an audit row. Fine at current volume; at scale it adds
write amplification and unbounded table growth on a Nano-tier database (15-connection pool).

**Impact.** Over time, `audit_log` growth consumes DB storage and the audit triggers add latency
to hot writes (e.g. order completion).

**Resolution (2026-07-05).** Migration `0117` adds `public.tidy_audit_log(keep_days int default
365)` — a `SECURITY DEFINER` pruner scheduled weekly via `pg_cron` (`tidy-audit-log`, Mon 07:10)
that deletes audit rows older than one year. Growth is now bounded at ~12 months of trail (ample
for the due-diligence story). The window is floored at 90 days in-function so a bad argument can't
erase the recent trail, and `execute` is revoked from `anon`/`authenticated` so the tamper-proof
log can't be purged by an app user — only the cron owner runs it. Trigger narrowing was considered
and deferred: the current trigger set is intentional for traceability and the retention policy
already bounds the cost.

**Close when:** ~~a retention/prune policy is in place and `audit_log` growth is bounded.~~ **Done.**
