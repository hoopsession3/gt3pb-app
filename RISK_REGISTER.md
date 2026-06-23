# GT3 Performance Bar — Risk Register

Known operational & security risks for the GT3PB platform (app, Supabase, integrations).
Add new risks at the top. Close one by setting **Status: Closed** with the date and how it was resolved.

| ID | Risk | Severity | Status | Owner |
|----|------|----------|--------|-------|
| R-001 | Unencrypted BI connection (Looker Studio → Supabase) | Medium | Accepted (temporary) | Ryan |
| R-002 | Per-tenant RLS staged but not enforced | Medium | Open (staged) | Ryan |
| R-003 | Audit-log trigger write volume / retention | Low–Medium | Open (monitor) | Ryan |

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

**Close when:** tenant-scoped RLS is enforced and verified — **or** a decision to remain
single-tenant is recorded here.

---

## R-003 — Audit-log trigger write volume / retention

- **Opened:** 2026-06-23
- **Severity:** Low–Medium
- **Status:** Open (monitor)
- **Owner:** Ryan

**Description.** The append-only `audit_log` (migration `0042`) is populated by triggers on
high-write tables (orders, subscriptions, profiles, reserves, assets, inventory_items,
event_approvals). Every write also writes an audit row. Fine at current volume; at scale it adds
write amplification and unbounded table growth on a Nano-tier database (15-connection pool).

**Impact.** Over time, `audit_log` growth consumes DB storage and the audit triggers add latency
to hot writes (e.g. order completion).

**Plan / mitigation.** Add a retention policy (e.g. a `pg_cron` job to prune/archive audit rows
older than N months) and/or narrow the triggers to the tables that genuinely need an audit trail.
Revisit when order volume grows.

**Close when:** a retention/prune policy is in place and `audit_log` growth is bounded.
