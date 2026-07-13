-- 0198 — Maintenance & audit log: the owner's record of every audit run on the app
-- One row per audit (interop, a11y, performance, security, cohesion, dependency, data, custom): what
-- kind, when it ran, the prompt used, the result/score, a summary, findings, and an optional link to
-- the published artifact. Drives the Settings → "Maintenance & audits" dashboard (last-run per type,
-- overdue-by-cadence, health at a glance). Staff read; admins/owners write.

create table if not exists public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  kind         text not null default 'custom'
    check (kind in ('interop','a11y','performance','security','cohesion','dependency','data','custom')),
  title        text not null,
  status       text not null default 'info' check (status in ('pass','warn','fail','info')),
  score        int check (score is null or (score >= 0 and score <= 10)),  -- optional 0–10
  summary      text,
  prompt       text,        -- the audit prompt / how it was run
  findings     text,        -- the result detail (markdown ok)
  artifact_url text,        -- link to a published audit artifact, if any
  ran_on       date not null default current_date,
  cadence      text not null default 'once' check (cadence in ('once','weekly','monthly','quarterly')),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  constraint audit_title_len check (char_length(title) <= 160)
);
create index if not exists audit_log_ran_idx  on public.audit_log (ran_on desc);
create index if not exists audit_log_kind_idx on public.audit_log (kind);

drop trigger if exists stamp_tenant_tg on public.audit_log;
create trigger stamp_tenant_tg before insert on public.audit_log
  for each row execute function public.stamp_tenant();

alter table public.audit_log enable row level security;
drop policy if exists "audit staff read" on public.audit_log;
create policy "audit staff read" on public.audit_log for select using ((select public.is_staff()));
drop policy if exists "audit admin write" on public.audit_log;
create policy "audit admin write" on public.audit_log for all
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "tenant isolation" on public.audit_log;
create policy "tenant isolation" on public.audit_log as restrictive
  for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
grant select, insert, update, delete on public.audit_log to authenticated;

-- Seed the audits already run this build cycle so the dashboard opens with real history.
insert into public.audit_log (kind, title, status, score, summary, findings, ran_on, cadence, artifact_url)
select * from (values
  ('interop'::text, 'Interoperability audit', 'warn'::text, 9, 'Whole-app cross-feature links audited; 4/10 → 9/10 after fixes. Only pricing consolidation deferred.',
    'Fixed: brew re-derive, OpsPlan dedupe, stop→vendor binding, per-stop order-ahead, guided copilot, vendor propagation, pack-list refresh, B2B→customer spine, P&L click-through, money-truth (Square book-of-record, blended COGS, brew→inventory). Deferred: pricing consolidation (7 sources).'::text,
    current_date, 'quarterly'::text, 'https://claude.ai/code/artifact/964484af-851d-4e3e-91d6-b550ebd7b50c'),
  ('a11y', 'Accessibility (axe-core, every screen)', 'pass', 10, 'axe-core 4.12 across all 17 screens. Customer surface: 0 violations after fixes. Every dialog now named.',
    'Fixed systemically: .g3 role, Leaflet map role, <main> landmark, per-route h1, nav landmark, viewport zoom, and the Sheet dialog-name (every popout). Crew console needs an authenticated pass (script committed).', current_date, 'monthly', null),
  ('performance', 'Lighthouse performance (mobile, top 5)', 'warn', 7, 'Scores 74–78 mobile. TBT 0 / CLS 0 (excellent); LCP capped by the intro splash on first visit. Bundle ~681KB gz.',
    'Levers: intro splash (first-visit LCP), guest / → /truck double-load (fixed via edge proxy on a branch), 184KB unused first-load JS (Supabase client). Preconnect to Supabase shipped.', current_date, 'monthly', null),
  ('security', 'API authz + rate-limiting audit', 'warn', 6, 'Object-level authz is solid (no IDOR/BOLA). Rate-limiting is the gap: the shared limiter is wired into 1 of ~40 routes.',
    'CRITICAL: /api/concierge unauth AI spend-DoS. HIGH: /api/checkout unauth card charges (card-testing); 24+ staff/owner AI routes unthrottled. MED: errors/report + waitlist limiter (global bucket). LOW: notes/inbound token in query + non-constant-time compare.', current_date, 'quarterly', null),
  ('cohesion', 'Crew console UI cohesion audit', 'warn', 6, 'The design system exists (Panel · crew-group · KPI strip) but only 2 of 16 tabs use it. Money is the 10/10 template.',
    'Best: money (KPI strip → crew-group → uniform Panels), then settings. Worst: customers (4 — two header systems in one tab), prep (5 — 3 section idioms), garage (5 — a third parallel collapsible), team (5 — no grouping). Enforce: glance-first KPIs, crew-group dividers, one Panel container, one empty/loading state, one button system.', current_date, 'quarterly', null)
) as v
where not exists (select 1 from public.audit_log);

-- verify:
--   select to_regclass('public.audit_log');       -- non-null
--   select kind, status, score, ran_on from public.audit_log order by ran_on desc;
