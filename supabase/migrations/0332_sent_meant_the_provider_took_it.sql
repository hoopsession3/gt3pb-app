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
