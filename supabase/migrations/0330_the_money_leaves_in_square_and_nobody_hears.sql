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
