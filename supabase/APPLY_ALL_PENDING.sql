-- ⚠️ NEVER include files from supabase/pending/ in this bundle — those are soak-gated (see
-- supabase/pending/0224_field_ops_contract.sql) and applying them early is irreversible.
--
-- ── GENERATED FILE — DO NOT EDIT BY HAND ─────────────────────────────────────────────────────
-- Regenerate with:  npm run migrations:pending -- --write
--
-- This file is the OUTPUT of comparing supabase/migrations/ against what production's ledger
-- (public.schema_migrations, via /api/migrations) says has actually been applied. Its previous
-- hand-maintained version said "apply all pending migrations" and stopped at 0035 while this
-- directory held 326 files — wrong by 291 migrations, referenced by nothing, checked by nothing.
--
-- The line below is what stops that happening again: scripts/drift.check.mjs fails the release
-- if supabase/migrations/ ever holds a migration numbered above it.
-- pending-from: 0332
-- generated-at: 2026-09-29
-- pending-count: 3
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- ============================================================
-- 0330_the_money_leaves_in_square_and_nobody_hears.sql
-- ============================================================
-- ── THE MONEY LEAVES IN SQUARE AND THIS APP NEVER HEARS ────────────────────────────────────────
-- 2026-09-29, the same audit that found 0329. The Square webhook handles subscription.*,
-- invoice.payment_made, invoice.payment_failed and payment.* — and nothing else. There is no
-- refund.* branch and no dispute.* branch. So:
--
--   a refund issued in Square    →  money leaves the business, and this database never learns
--   a chargeback opened          →  a deadline starts running, and nothing here knows it exists
--
-- That is not an oversight at the edge of the product. The app's own money panel carries a link
-- reading "REFUNDS & DISPUTES — SQUARE DASHBOARD", so the intended workflow deliberately sends the
-- owner somewhere the database cannot see the result. And 0313's own function says the quiet part:
--
--     "Marking one refunded records that a refund WAS MADE — it does not make one.
--      The card never touches this app; the money moves in Square."
--
-- Correct, and exactly half the loop. The half that was missing is Square telling us back.
--
-- ── THE SAME SHAPE AS 0329, WITH THE MONEY GOING THE OTHER WAY ─────────────────────────────────
-- 0329 was written because an order's status only ever meant "our POST returned 200" and Apliiq's
-- refusal arrived by email. This is that again: shop_orders.refund_amount_cents only ever means
-- "somebody typed it into this app", and Square's record of the same event arrives nowhere.
--
-- ── WHY EVIDENCE TABLES AND NOT A COLUMN ───────────────────────────────────────────────────────
-- The obvious move is for the webhook to add to shop_orders.refund_amount_cents. Two reasons not to:
--
--   1. It would not be idempotent. The webhook's own comment says a prior attempt that died
--      mid-processing re-runs, "every write below is idempotent" — and `x = x + amount` is the one
--      shape that is not. A retry would double-count a refund. That is the kind of bug that ends
--      with a number nobody can explain.
--   2. refund_amount_cents already HAS one writer: set_shop_order_status (0313), which enforces the
--      legal moves and demands a reason. A webhook writing the same column is a second writer, and
--      this repo has spent a week paying for those.
--
-- So Square's record lands in its own tables, keyed by Square's own ids, written idempotently. The
-- operator's record stays where it is, written by the one function that owns it. And because those
-- are now two independent accounts of the same money, they can be COMPARED — which is the part that
-- was never possible before and is the actual product of this migration.

create table if not exists public.square_refunds (
  -- Square's refund id IS the key. That is what makes the write idempotent: a replayed webhook
  -- conflicts and updates rather than inserting a second row for one refund.
  id            text primary key,
  tenant_id     uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  payment_id    text not null,
  order_id      uuid references public.shop_orders(id) on delete set null,
  amount_cents  int  not null check (amount_cents >= 0),
  -- Square's own words: PENDING | COMPLETED | REJECTED | FAILED. Only COMPLETED is money that left,
  -- and the status is kept rather than filtered at write time so a refund that later fails is
  -- visibly a refund that later failed, not a row that silently disappears.
  status        text not null,
  reason        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists square_refunds_payment on public.square_refunds (payment_id);
create index if not exists square_refunds_order   on public.square_refunds (order_id);

alter table public.square_refunds enable row level security;

drop policy if exists square_refunds_read on public.square_refunds;
create policy square_refunds_read on public.square_refunds for select using (public.is_admin());
-- No insert/update/delete policy for `authenticated`, on purpose: every row here is Square's
-- testimony, written by the webhook holding the service role after an HMAC check. A client that can
-- write this table can claim a refund happened that never did.
grant select on public.square_refunds to authenticated;

comment on table public.square_refunds is
  'Square''s own record of money refunded, keyed by Square''s refund id so a webhook replay updates rather than double-counts. NOT the same fact as shop_orders.refund_amount_cents, which is what an operator recorded in this app — the two are deliberately separate so v_shop_money_drift can compare them.';

create table if not exists public.square_disputes (
  id            text primary key,
  tenant_id     uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  payment_id    text not null,
  order_id      uuid references public.shop_orders(id) on delete set null,
  amount_cents  int  not null check (amount_cents >= 0),
  -- Square's dispute states, kept verbatim: INQUIRY_EVIDENCE_REQUIRED, EVIDENCE_REQUIRED,
  -- PROCESSING, WON, LOST, ACCEPTED. Kept as text rather than a check constraint because a state
  -- this app has not heard of must still be recordable — a dispute we cannot store is a dispute we
  -- cannot answer.
  state         text,
  -- THE FIELD THIS TABLE EXISTS FOR. Miss it and the dispute is lost by default, for the full
  -- amount plus the bank's fee. It is the reason a dispute is an obligation and not just an alert.
  due_at        timestamptz,
  reason        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists square_disputes_payment on public.square_disputes (payment_id);
create index if not exists square_disputes_due     on public.square_disputes (due_at)
  where due_at is not null;

alter table public.square_disputes enable row level security;

drop policy if exists square_disputes_read on public.square_disputes;
create policy square_disputes_read on public.square_disputes for select using (public.is_admin());
grant select on public.square_disputes to authenticated;

comment on table public.square_disputes is
  'Chargebacks, from Square''s webhook. due_at is the evidence deadline — the one date in this app where silence costs the full amount plus a fee, which is why it is surfaced through v_obligations with every other deadline rather than living in an alert that scrolls away.';

-- ── THE RECONCILIATION ─────────────────────────────────────────────────────────────────────────
-- Two independent accounts of the same money, and the gap between them. This is the whole point of
-- keeping them apart: before today there was one number, written by hand, with nothing to check it
-- against.
--
-- `verdict` is written for a person reading it cold at the end of a month, not for a machine.
create or replace view public.v_shop_money_drift with (security_invoker = on) as
select o.id                                                as order_id,
       o.created_at,
       coalesce(nullif(btrim(o.ship_name), ''), o.email, 'Guest') as who,
       o.status,
       o.total_cents,
       o.refund_amount_cents                               as recorded_in_app,
       coalesce(s.square_cents, 0)                         as refunded_in_square,
       coalesce(s.square_cents, 0) - coalesce(o.refund_amount_cents, 0) as gap_cents,
       coalesce(d.open_disputes, 0)                        as open_disputes,
       case
         when coalesce(d.open_disputes, 0) > 0
           then 'A chargeback is open on this order — evidence is due.'
         when coalesce(s.square_cents, 0) > coalesce(o.refund_amount_cents, 0)
           then 'Square refunded more than this app has recorded. Somebody refunded in Square and the order was never updated.'
         when coalesce(o.refund_amount_cents, 0) > coalesce(s.square_cents, 0)
           then 'This app records a refund Square has no completed record of. Either it was never actually issued, or it was issued outside this payment.'
         else 'Agrees.'
       end                                                 as verdict
  from public.shop_orders o
  left join lateral (
    -- COMPLETED only. A pending or rejected refund is not money that left, and counting one would
    -- make this view cry wolf in the direction that matters least.
    select sum(r.amount_cents)::int as square_cents
      from public.square_refunds r
     where r.payment_id = o.payment_id and r.status = 'COMPLETED'
  ) s on true
  left join lateral (
    select count(*)::int as open_disputes
      from public.square_disputes x
     where x.payment_id = o.payment_id
       and coalesce(x.state, '') not in ('WON', 'LOST', 'ACCEPTED')
  ) d on true
 where o.payment_id is not null;

revoke all on public.v_shop_money_drift from anon;
grant select on public.v_shop_money_drift to authenticated;

comment on view public.v_shop_money_drift is
  'Every order where this app''s record of refunds and Square''s disagree, plus any order with an open chargeback. Exists because refund_amount_cents is what an operator typed and square_refunds is what Square did, and until 0330 nothing compared them.';

-- ── ONE HOME FOR DEADLINES: v_obligations gains a 12th source ────────────────────────────────
-- 0320's view, verbatim from its own file, with one branch added. Restated in full because that
-- is what 'create or replace view' requires — the other eleven branches are byte-for-byte 0320's,
-- spliced programmatically rather than retyped, because retyping 200 lines of other people's
-- deadlines to add one of mine is how a different deadline quietly stops working.

create or replace view public.v_obligations as
with raw as (

  -- EQUIPMENT SERVICE. asset_maintenance is a LOG, so the next due date is the one on the most
  -- recent entry per asset, not one row per historical entry. distinct on does that; counting rows
  -- instead would report the same overdue tool once per time it has ever been serviced.
  select 'asset_maintenance'                                as source,
         m.id::text                                          as subject_id,
         'Equipment'                                         as area,
         'Service due'                                       as kind,
         coalesce(a.name, 'Equipment')                       as title,
         m.kind || ' last done ' || to_char(m.performed_on, 'Mon FMDD') || '.' as detail,
         m.next_due_on                                       as due_on,
         '/crew?s=garage'                                    as route,
         a.market                                            as market,
         null::uuid                                          as owner_user_id
    from (
      select distinct on (asset_id) * from public.asset_maintenance
       where next_due_on is not null
       order by asset_id, performed_on desc, created_at desc
    ) m
    join public.assets a on a.id = m.asset_id
   where coalesce(a.status, 'active') <> 'retired'

  union all

  -- PERMITS AND LICENCES. compliance_rules has no due column; what it has is verified_on, and
  -- v_compliance_freshness already owns the judgement about when that has gone stale. Re-deriving
  -- the threshold here would be a second opinion, so the due date is expressed in the view's own
  -- terms: a year after it was last confirmed, or today if nobody ever recorded a date.
  select 'compliance_rules', f.id::text, 'Compliance', 'Needs re-checking',
         f.label,
         f.freshness || coalesce(' · ' || f.authority, '') || '.',
         coalesce(f.verified_on + 365, current_date),
         '/crew?s=prep',
         null,
         null::uuid
    from public.v_compliance_freshness f
   where f.freshness <> 'fresh'

  union all

  -- CERTIFICATIONS. A lapsed food-safety cert is a person who cannot legally work the event.
  select 'academy_certifications', c.user_id::text || ':' || c.cert_key, 'People', 'Certification expires',
         coalesce(p.display_name, 'A crew member') || ' — ' || c.cert_key,
         'Awarded ' || to_char(c.awarded_at, 'Mon FMDD, YYYY') || '.',
         c.expires_at::date,
         '/crew?s=team',
         p.market,
         c.user_id
    from public.academy_certifications c
    left join public.profiles p on p.id = c.user_id
   where c.expires_at is not null

  union all

  -- ASSIGNED TRAINING with a date on it.
  select 'academy_assignments', t.id::text, 'People', 'Training due',
         coalesce(p.display_name, 'A crew member') || ' — ' || t.target_key,
         'Assigned ' || t.target_type || '.',
         t.due_at::date,
         '/crew?s=team',
         p.market,
         t.user_id
    from public.academy_assignments t
    left join public.profiles p on p.id = t.user_id
   where t.due_at is not null

  union all

  -- OFFERS OUT. Only ones actually awaiting an answer: a draft that expires is not a deadline.
  select 'offer_letters', o.id::text, 'Hiring', 'Offer expires',
         o.candidate_name || ' — ' || o.title,
         'Sent ' || coalesce(to_char(o.sent_at, 'Mon FMDD'), 'recently') || ', no answer yet.',
         o.expires_on,
         '/crew?s=team&a=offers',
         o.market,
         o.candidate_user_id
    from public.offer_letters o
   where o.expires_on is not null and o.status in ('sent', 'countered')

  union all

  -- MONEY OWED TO US.
  select 'invoices', i.id::text, 'Money', 'Invoice due',
         coalesce(b.company, 'An account') || ' — ' || to_char(i.amount_cents / 100.0, 'FM$999,999.00'),
         i.terms || ', issued ' || to_char(i.issued_at, 'Mon FMDD') || '.',
         i.due_at,
         '/crew?s=money',
         b.market,
         null::uuid
    from public.invoices i
    left join public.business_accounts b on b.id = i.business_id
   where i.due_at is not null and i.status in ('open', 'sent')

  union all

  -- AGREEMENTS RUNNING OUT.
  select 'operator_agreements', g.id::text, 'Franchise', 'Agreement ends',
         g.operator_name || ' — ' || g.market,
         'Version ' || g.version || ', ' || g.status || '.',
         g.ends_on,
         '/crew?s=money',
         g.market,
         g.operator_user_id
    from public.operator_agreements g
   where g.ends_on is not null and g.status in ('accepted', 'signed', 'active')

  union all

  -- THE COMPANY'S OWN COMMITMENTS.
  select 'goals', gl.id::text, 'Command', 'Goal due',
         gl.title,
         'At ' || round(gl.current_value)::text || ' of ' || round(gl.target_value)::text ||
           coalesce(' ' || nullif(gl.unit, ''), '') || '.',
         gl.due_date,
         '/crew?s=command',
         null,
         null::uuid
    from public.goals gl
   where gl.due_date is not null and gl.status = 'active'

  union all

  select 'initiatives', n.id::text, 'Command', 'Initiative target',
         n.title, coalesce(n.summary, 'No summary recorded.'), n.target_date,
         '/crew?s=command', null, null::uuid
    from public.initiatives n
   where n.target_date is not null and n.status in ('planning', 'active')

  union all

  select 'os_workstreams', w.id::text, 'Command', 'Next action due',
         w.name, coalesce(w.next_action, 'No next action recorded.'), w.due,
         '/crew?s=command', null, w.owner_user_id
    from public.os_workstreams w
   where w.due is not null and w.status <> 'parked'

  union all

  -- TODOS. event_tasks are deliberately absent — task_due_alerts already sweeps those every ten
  -- minutes, and telling somebody twice by two mechanisms that cannot see each other is worse than
  -- the silence this view exists to fix. todos have never had a sweeper of any kind.
  select 'todos', d.id::text, 'Work', 'To-do due',
         d.title, coalesce('Category: ' || nullif(d.category, ''), 'Uncategorised.'), d.due_on,
         '/crew?s=day', null, d.assignee
    from public.todos d
   where d.due_on is not null and not d.done

  -- CHARGEBACK EVIDENCE (0330). The one deadline in this app where silence costs the full amount
  -- plus a fee: a dispute has a date by which evidence must be with Square, and missing it loses by
  -- default. It can only arrive from Square's webhook, and before 0330 nothing here knew a dispute
  -- existed at all. Excludes the states that are already decided.
  union all
  select 'square_disputes'                                    as source,
         d.id                                                as subject_id,
         'Money'                                              as area,
         'Chargeback evidence due'                            as kind,
         coalesce(nullif(btrim(so.ship_name), ''), so.email, 'A card dispute') as title,
         'A customer disputed ' || to_char(coalesce(d.amount_cents, 0) / 100.0, 'FM999999990.00')
           || '. Evidence has to be with Square by this date or it is lost by default.' as detail,
         (d.due_at at time zone 'America/New_York')::date    as due_on,
         '/crew?s=money&a=shoporders'                        as route,
         null::text                                          as market,
         null::uuid                                          as owner_user_id
    from public.square_disputes d
    left join public.shop_orders so on so.payment_id = d.payment_id
   where d.due_at is not null
     and coalesce(d.state, '') not in ('WON', 'LOST', 'ACCEPTED')
)
select r.source, r.subject_id, r.area, r.kind, r.title, r.detail, r.due_on,
       (r.due_on - current_date) as days_out,
       case when r.due_on <  current_date then 'overdue'
            when r.due_on <= current_date + 14 then 'soon'
            else 'upcoming' end as severity,
       r.route, r.market, r.owner_user_id
  from raw r
 where r.due_on is not null;
-- security_invoker so every base table's RLS still decides who sees each row (0312's rule). Restated
-- because `create or replace view` does NOT preserve the setting when the definition is replaced.
alter view public.v_obligations set (security_invoker = on);
revoke all on public.v_obligations from public, anon;
grant select on public.v_obligations to authenticated;

comment on view public.v_obligations is
  'Every business deadline the app stores and nothing was watching, in one shape. Deliberately EXCLUDES event_tasks, brew_batches and reserve_claims — those already have cron sweepers, and being told twice by two mechanisms that cannot see each other is worse than the silence this fixes. 0330 added chargeback evidence deadlines, which are the only ones here that cost money by default if missed.';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Refunds and chargebacks from Square now reach the app','fix','Money',
   'Money refunded in the Square dashboard never made it back into this app, and a chargeback was invisible here entirely — including the deadline to respond to one, which is lost by default if missed. Square now reports both. Refunds are kept as Square''s own record alongside what was entered here, and the two are compared, so "someone refunded in Square and nobody updated the order" is a line you can read instead of a number nobody can explain. A chargeback''s evidence deadline appears with every other deadline in the business.',
   '2026-09-29', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0330_the_money_leaves_in_square_and_nobody_hears',
  'square_refunds + square_disputes + v_shop_money_drift, and a 12th branch on v_obligations. The Square webhook handled subscription/invoice/payment events and had NO refund.* or dispute.* branch, so money leaving the business never reached this database and a chargeback deadline did not exist here at all — while the app''s own money panel sent the owner to the Square dashboard to do exactly those two things. Square''s record is kept separately from the operator''s (refund_amount_cents, still written only by 0313''s set_shop_order_status) because a webhook doing x = x + amount is the one write that is not idempotent on a retry, and because two independent accounts of the same money can be compared — which v_shop_money_drift does and nothing did before.');

-- verify:
--   select * from public.v_shop_money_drift where verdict <> 'Agrees.';
--   select source, kind, title, due_on, severity from public.v_obligations
--     where source = 'square_disputes' order by due_on;
--   select count(*) from public.v_obligations;   -- must be >= the count before 0330

-- ============================================================
-- 0331_a_deep_link_nothing_was_checking.sql
-- ============================================================
-- ── A DEEP LINK NOTHING WAS CHECKING ───────────────────────────────────────────────────────────
-- 2026-09-29. 0329 shipped an alert pointing at a `shop` section. There is no such section. The
-- shop lives under `money`, in an accordion panel with the id `shoporders`, and that link quietly
-- redirects to the top of the money page — so the alert that exists to put a stalled paid order in
-- front of somebody dropped them at the top of a long page with no idea what they were looking for.
-- (The broken string is deliberately not written out below: this file is now read by that check.)
--
-- lib/records.ts wrote the rule down before I broke it: "A link that half-works is worse than one
-- that plainly does not."
--
-- ── WHY THE GATE THAT EXISTS DID NOT CATCH IT ──────────────────────────────────────────────────
-- The smoke suite already reads every /crew?s= link against OperatorNav's real section list and
-- against the ids in the JSX. It caught this instantly — in app/api/square/webhook/route.ts, while
-- 0330 was being written. It did NOT catch 0329, because it walks app/, components/ and lib/ and
-- migrations are none of those.
--
-- So the rule was right, its reach was wrong, and the half of the app that produces the most alerts
-- — pg_cron functions in SQL — was the half nobody was reading. That is fixed in the same commit
-- as this, in scripts/smoke.cjs, from 0331 forward.
--
-- This migration fixes the damage already applied: the function, and the alert row it has already
-- written into Ryan's inbox.

create or replace function public.shop_order_stall_watchdog(stale_hours int default 24)
  returns int language plpgsql security definer set search_path = public as $$
declare
  r        record;
  open_id  uuid;
  raised   int := 0;
begin
  -- greatest(...,1) so a mistaken 0 cannot turn this into "alert on every order the moment it is paid".
  for r in
    select o.id, o.who, o.status, o.age_hours, o.total_cents, o.items
      from public.v_shop_orders o
     where o.waiting_on_us
       and o.age_hours >= greatest(stale_hours, 1)
     order by o.age_hours desc
  loop
    -- ONE open alert per ORDER, not per condition — subject_id is what makes two stalled orders two
    -- lines instead of one that keeps overwriting itself. Once acknowledged, a later stall of the
    -- same order opens a fresh alert: an owner who cleared it is asking to be told again.
    select a.id into open_id
      from public.alerts a
     where a.kind = 'shop_order_stalled'
       and a.subject_id = r.id
       and a.ack_at is null
     order by a.created_at desc
     limit 1;

    if open_id is not null then
      -- Still stuck. Same episode: refresh what it says, leave the tally alone (see above).
      update public.alerts
         set last_seen_at = now(),
             body = r.who || ' paid ' || to_char((coalesce(r.total_cents, 0) / 100.0), 'FM999990.00')
                    || ' for ' || coalesce(r.items, 'this order') || ' and it has not moved in '
                    || r.age_hours || ' hours. Status is "' || r.status || '", which means this app '
                    || 'sent it and heard nothing since — not that the printer accepted it. Apliiq '
                    || 'refuses orders by EMAIL to the account owner; nothing about a refusal ever '
                    || 'reaches here. Open Apliiq and confirm this order actually exists there.'
       where id = open_id;
    else
      insert into public.alerts (severity, category, title, body, link, kind, subject_id, last_seen_at)
      values (
        'critical', 'order',
        'A paid order has not moved in ' || r.age_hours || ' hours',
        r.who || ' paid ' || to_char((coalesce(r.total_cents, 0) / 100.0), 'FM999990.00')
          || ' for ' || coalesce(r.items, 'this order') || ' and it has not moved in '
          || r.age_hours || ' hours. Status is "' || r.status || '", which means this app sent it '
          || 'and heard nothing since — not that the printer accepted it. Apliiq refuses orders by '
          || 'EMAIL to the account owner; nothing about a refusal ever reaches here. Open Apliiq and '
          || 'confirm this order actually exists there.',
        '/crew?s=money&a=shoporders', 'shop_order_stalled', r.id, now()
      );
      raised := raised + 1;
    end if;
  end loop;
  return raised;
end $$;

-- The alert 0329 already raised is carrying the broken link. Fixing the function does not fix a row
-- that is already in the inbox, and that row is about a real paid order somebody still has to act on.
-- Matched on "is not the right link" rather than on the one wrong value it happens to hold. That
-- fixes any other wrong link of this kind too, and it keeps the broken string from living on in a
-- file the deep-link check now reads.
update public.alerts
   set link = '/crew?s=money&a=shoporders'
 where kind = 'shop_order_stalled'
   and coalesce(link, '') <> '/crew?s=money&a=shoporders';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The stalled-order alert now opens the order','fix','Shop',
   'The alert added yesterday for a paid order that has stopped moving linked to a page section that does not exist, so tapping it landed you at the top of the money page instead of on the order. It now opens the shop orders panel directly, and the alert already sitting in the inbox was corrected too.',
   '2026-09-29', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0331_a_deep_link_nothing_was_checking',
  'shop_order_stall_watchdog re-emitted with a link that exists. 0329 pointed the alert at a section named shop; there is no such section — the shop is a panel (shoporders) inside money — so the alert raised to put a stalled paid order in front of somebody dropped them at the top of an unrelated page. The smoke suite already checks every /crew?s= link against OperatorNav and the JSX ids, and caught the same mistake in the Square webhook within the hour; it missed 0329 because it walked app/, components/ and lib/ and not supabase/migrations/. Reach fixed in the same commit. The alert row already in the inbox is updated too, because fixing the function does not fix a row already written.');

-- verify:
--   select kind, link from public.alerts where kind = 'shop_order_stalled';
--   -- every row must read /crew?s=money&a=shoporders

-- ============================================================
-- 0332_sent_meant_the_provider_took_it.sql
-- ============================================================
-- ── "SENT" MEANT THE PROVIDER TOOK IT, NOT THAT ANYONE GOT IT ──────────────────────────────────
-- 2026-09-29. 0326 built customer_messages so a paid order could answer three questions it could
-- not answer before: did we email them, what exactly did we say, and can I send it again. It works.
-- What it does not do is say whether the message ARRIVED, and the word it uses makes it sound like
-- it does:
--
--     status = 'sent'   ←  the Resend API returned 2xx to our POST
--
-- That is the same sentence 0329 had to remove from the Apliiq status one migration earlier, in a
-- table written the day before. A hard bounce, a spam complaint, a suppressed address: none of them
-- reach this app, and a receipt that never landed is indistinguishable here from one that was read.
--
-- The first cap order is the case in point. Its receipt was never sent at all — a 403, because
-- NOTIFY_FROM_EMAIL is not on a verified domain — and the only reason anybody knows is that Ryan
-- went and read Resend's dashboard by hand. The next failure will be a bounce, and there is no
-- dashboard trip that finds that one before a customer does.
--
-- ── WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT ───────────────────────────────────────────────
-- `status` keeps its meaning exactly. It is what THIS APP did — it handed the message to a provider
-- and the provider took it, or refused it. Widening it to include 'bounced' would make one column
-- answer two different questions, and the answer to "did we try" would start depending on what a
-- mail server in another company decided hours later.
--
-- So delivery is recorded beside it, in the provider's own words, arriving through
-- /api/resend/webhook. Three timestamps and one detail, because those are the four things an
-- operator actually asks: did it land, did it bounce, did they mark it spam, and what did the server
-- say. `outcome` in v_customer_message_outcome is the one-word answer composed from them, so no
-- screen has to re-derive the precedence and get it subtly different from the next screen.
--
-- provider_id is the join. Resend's id for the message, captured at send time (lib/notify returned
-- `{ ok: true }` and threw the body away until today). Nothing else can match their webhook to our
-- row: not the address, which repeats, and not the time, which is a guess.

alter table public.customer_messages add column if not exists provider_id   text;
alter table public.customer_messages add column if not exists delivered_at  timestamptz;
alter table public.customer_messages add column if not exists bounced_at    timestamptz;
alter table public.customer_messages add column if not exists complained_at timestamptz;
alter table public.customer_messages add column if not exists delivery_detail text;

-- The webhook arrives knowing only Resend's id, so that lookup has to be indexed and it has to be
-- unique: two rows claiming one provider id would make a bounce ambiguous, and the honest answer to
-- "which message bounced" cannot be "one of these".
create unique index if not exists customer_messages_provider
  on public.customer_messages (provider_id) where provider_id is not null;

create index if not exists customer_messages_undelivered
  on public.customer_messages (created_at desc)
  where status = 'sent' and delivered_at is null and bounced_at is null;

comment on column public.customer_messages.provider_id is
  'Resend''s own id for this message, captured at send time. The join for /api/resend/webhook — the address repeats and the timestamp is a guess, so this is the only thing that can match their news to our row.';
comment on column public.customer_messages.delivered_at is
  'When the receiving server ACCEPTED it, per Resend. Distinct from status=''sent'', which only ever meant Resend took our POST. A row that is sent and never delivered is the case this column exists to make visible.';
comment on column public.customer_messages.bounced_at is
  'When it came back. A bounced receipt is a customer who paid and heard nothing, and before 0332 it looked identical here to one that was read.';

-- ── THE ONE-WORD ANSWER, COMPOSED ONCE ─────────────────────────────────────────────────────────
-- Precedence matters and is easy to get subtly wrong twice: a message can be delivered AND later
-- complained about, and the complaint is the more important fact. Written here so no screen decides
-- it independently.
create or replace view public.v_customer_message_outcome with (security_invoker = on) as
select m.id, m.tenant_id, m.order_id, m.channel, m.kind, m.to_address, m.subject,
       m.status, m.detail, m.sent_by, m.created_at,
       m.provider_id, m.delivered_at, m.bounced_at, m.complained_at, m.delivery_detail,
       case
         when m.status = 'failed'      then 'never sent'
         when m.complained_at is not null then 'marked as spam'
         when m.bounced_at   is not null then 'bounced'
         when m.delivered_at is not null then 'delivered'
         when m.channel <> 'email'       then 'sent'
         -- Sent, and nothing heard back. Not a failure — Resend reports delivery within seconds
         -- normally, so after an hour this is the state worth looking at, and before an hour it is
         -- simply too early to say. Saying "delivered" here would be the whole bug again.
         when m.created_at < now() - interval '1 hour' then 'no delivery confirmation'
         else 'in flight'
       end as outcome
  from public.customer_messages m;

revoke all on public.v_customer_message_outcome from anon;
grant select on public.v_customer_message_outcome to authenticated;

comment on view public.v_customer_message_outcome is
  'Every customer message with a one-word answer to "did it arrive". Composed here rather than in a screen because the precedence (a complaint outranks a delivery) is exactly the kind of rule that ends up written twice and differently.';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('An email that bounced no longer looks like one that was read','fix','Shop',
   'The order record could say a receipt was sent, but "sent" only ever meant the email provider accepted it — a message that bounced, or got marked as spam, or never reached anyone, looked exactly the same. Each message now carries what actually happened to it, in the provider''s own words, and a bounced receipt raises an alert naming the customer and the order instead of waiting for them to complain.',
   '2026-09-29', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0332_sent_meant_the_provider_took_it',
  'customer_messages gains provider_id/delivered_at/bounced_at/complained_at/delivery_detail, plus v_customer_message_outcome. 0326 recorded what the customer was told; "sent" meant Resend returned 2xx, which is the same overstatement 0329 removed from the Apliiq status one migration earlier and in a table written the day before. status keeps its meaning — what THIS APP did — and delivery is recorded beside it from Resend''s webhook, because widening status would make one column answer two questions and make "did we try" depend on what a mail server decided hours later. provider_id is the only possible join: the address repeats and the timestamp is a guess. lib/notify had been discarding it.');

-- verify:
--   select outcome, count(*) from public.v_customer_message_outcome group by 1 order by 2 desc;
--   select kind, to_address, outcome, delivery_detail from public.v_customer_message_outcome
--     where outcome in ('bounced','marked as spam','no delivery confirmation') order by created_at desc;
