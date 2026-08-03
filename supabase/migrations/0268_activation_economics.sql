-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0268 · ACTIVATION ECONOMICS (2026-08-03 — Playbook v1.1 §05 + p.14, built as a system, not a
-- bolt-on. Ryan: "ensure to not cause cohesive conflication or piece mealing functionality …
-- interoperability in all we have built, like a system architect.")
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The integration contract — what this round deliberately does NOT create:
--
--   • NO parallel coupon system. The app already has a discount-code ENGINE (member_benefits
--     scope='code', 0176) that reprices orders server-side at checkout. The $5-off QR coupon is
--     minted HERE as a row in that engine (new kind 'amount_off'), managed in the existing Codes
--     panel, redeemed in the existing order funnel. Scans ride funnel_events (0199) — the check
--     just learns a 'coupon' funnel; the anon-insert policy and funnel_counts() aggregates are
--     already there.
--   • NO delivery Activity type. Deliveries are already RECORDED as orders (delivery_orders,
--     drop_orders, business_orders) — re-logging them here would double-count revenue. The
--     activity ledger carries only what orders can't: activation COST, bottles stocked/pulled,
--     samples poured → buyers converted. Revenue stays reconciled on the 0216 basis; activity
--     revenue feeds ACCOUNT-level KPIs and payback math only, never the Money headline.
--   • NO second loyalty mechanism. profiles.points (0012) stays the rewards engine. loop_txns is
--     a RETURN LEDGER — when the loyalty-mechanic decision lands (due 8/6), a small trigger can
--     bridge returns → points; the pilot rides the existing engine either way.
--   • NO second container float. business_accounts.jug_balance (0187) keeps office gallon jugs;
--     loop_txns counts Loop BOTTLE returns. Different container, different ledger, on purpose.
--
-- What it DOES create: the two genuinely missing objects from Playbook p.14 —
--   account_activities — Activity{type, account, date, bottles, revenue, conv} + cost_cents,
--                        the column that makes "cost to uplift an opportunity" DYNAMIC.
--   loop_txns          — LoopTxn{return, credit}, the evidence meter for the 8/6 decision.
-- Plus one wire: opportunities.business_account_id, so a LIVE account's real recurring revenue
-- (business_orders) can answer its own payback question.

-- ── the activity ledger ─────────────────────────────────────────────────────────────────────────
create table if not exists public.account_activities (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  event_id       uuid references public.events(id) on delete set null,  -- a pop-up AT a booked event links, never duplicates it
  type           text not null check (type in ('popup','sampler','event','restock','other')),
  on_date        date not null default ((now() at time zone 'America/New_York')::date),
  bottles        int check (bottles is null or bottles >= 0),          -- restock: added to the shelf
  pulled         int check (pulled  is null or pulled  >= 0),          -- restock: expired/pulled (spoilage numerator)
  stock_after    int check (stock_after is null or stock_after >= 0),  -- restock: on the shelf when leaving → sell-through math
  sampled        int check (sampled is null or sampled >= 0),          -- pours given
  buyers         int check (buyers  is null or buyers  >= 0),          -- pours that converted (sample→purchase numerator)
  revenue_cents  int check (revenue_cents is null or revenue_cents >= 0),
  cost_cents     int check (cost_cents    is null or cost_cents    >= 0),
  note           text check (note is null or char_length(note) <= 240),
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists account_activities_opp  on public.account_activities(opportunity_id, on_date desc);
create index if not exists account_activities_date on public.account_activities(on_date desc);

alter table public.account_activities enable row level security;
drop policy if exists "activities staff read" on public.account_activities;
create policy "activities staff read" on public.account_activities for select using ((select public.is_staff()));
drop policy if exists "activities staff write" on public.account_activities;
create policy "activities staff write" on public.account_activities for all
  using ((select public.is_staff())) with check ((select public.is_staff()));
drop trigger if exists stamp_tenant_tg on public.account_activities;
create trigger stamp_tenant_tg before insert on public.account_activities for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.account_activities;
create policy "tenant isolation" on public.account_activities as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

-- ── the Loop return ledger ──────────────────────────────────────────────────────────────────────
create table if not exists public.loop_txns (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  on_date        date not null default ((now() at time zone 'America/New_York')::date),
  returns        int  not null default 1 check (returns > 0),
  credit_cents   int  not null default 200,   -- the decided $2 across the board (8/2 session)
  customer_id    uuid references public.customers(id) on delete set null,      -- when known → the 8/6 loyalty bridge
  opportunity_id uuid references public.opportunities(id) on delete set null,  -- partner-facilitated → the partner-credit question gets data
  note           text check (note is null or char_length(note) <= 160),
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists loop_txns_date on public.loop_txns(on_date desc);

alter table public.loop_txns enable row level security;
drop policy if exists "loop staff read" on public.loop_txns;
create policy "loop staff read" on public.loop_txns for select using ((select public.is_staff()));
drop policy if exists "loop staff insert" on public.loop_txns;
create policy "loop staff insert" on public.loop_txns for insert with check ((select public.is_staff()));
drop policy if exists "loop admin change" on public.loop_txns;
create policy "loop admin change" on public.loop_txns for update
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "loop admin delete" on public.loop_txns;
create policy "loop admin delete" on public.loop_txns for delete using ((select public.is_admin()));
drop trigger if exists stamp_tenant_tg on public.loop_txns;
create trigger stamp_tenant_tg before insert on public.loop_txns for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.loop_txns;
create policy "tenant isolation" on public.loop_txns as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

-- ── the revenue wire ────────────────────────────────────────────────────────────────────────────
-- A pipeline account that goes LIVE starts ordering through the B2B spine (business_accounts →
-- business_orders, 0187). Linking the two lets the uplift rail answer payback from REAL recurring
-- revenue instead of hand-entered MRR alone.
alter table public.opportunities add column if not exists business_account_id uuid references public.business_accounts(id) on delete set null;
create index if not exists opportunities_bizacct on public.opportunities(business_account_id) where business_account_id is not null;

-- ── the code engine learns a flat-amount kind ───────────────────────────────────────────────────
-- '$5 off' isn't a percent and isn't a price override — it's an amount off the order. One new kind;
-- every existing surface (storefront code box, server repricing, Codes panel) inherits it.
alter table public.member_benefits drop constraint if exists member_benefits_kind_check;
alter table public.member_benefits add constraint member_benefits_kind_check
  check (kind in ('free_refill', 'price_override', 'percent_off', 'amount_off'));

-- ── the funnel spine learns the coupon funnel ───────────────────────────────────────────────────
-- A QR scan is a funnel step like any other. Same anon-insert policy, same aggregate reads.
alter table public.funnel_events drop constraint if exists funnel_events_funnel_check;
alter table public.funnel_events add constraint funnel_events_funnel_check
  check (funnel in ('order','reserve','delivery','signup','office','coupon'));

-- ── redemption becomes a recorded fact ──────────────────────────────────────────────────────────
-- Checkout has always VALIDATED codes server-side; now the order remembers which code priced it,
-- so "coupon redemptions" is a query, not a tally sheet.
alter table public.orders      add column if not exists benefit_code text check (benefit_code is null or char_length(benefit_code) <= 40);
alter table public.drop_orders add column if not exists benefit_code text check (benefit_code is null or char_length(benefit_code) <= 40);

-- ── seed: coupon card A, as data in the existing engine ─────────────────────────────────────────
-- Card B (free-pour-on-return) is deliberately NOT a checkout code — it's redeemed in person as a
-- Loop return (loop_txns row). Its QR still lands on /c/GT3-POUR and its scans still count in the
-- coupon funnel; there's just no order-repricing rule to mint. One mechanic per engine.
insert into public.member_benefits (scope, code, kind, target, value_cents, label)
select 'code', 'GT3-5OFF', 'amount_off', null, 500, '$5 off — coupon card A (QR)'
where not exists (select 1 from public.member_benefits where lower(code) = lower('GT3-5OFF'));

-- Verify (prod, after apply):
--   select count(*) from pg_policies where tablename in ('account_activities','loop_txns');       -- 6
--   insert into public.funnel_events (funnel, step) values ('coupon','GT3-5OFF');                  -- ok
--   select kind from public.member_benefits where code = 'GT3-5OFF';                               -- amount_off
