-- ── WHAT WE TOLD THE CUSTOMER ──────────────────────────────────────────────────────────────────
-- 2026-09-29. Ryan bought the first flagship cap. The card cleared, the order recorded, Apliiq
-- accepted it, and the confirmation screen said "You'll get an email now". No email arrived.
--
-- Resend's own log had the answer: one 403 on /emails at the minute of the order, with a 200 on
-- either side of it. But nothing IN THIS APP could say that. The send returned a boolean that was
-- discarded, and there is no table anywhere in 325 migrations that records a message sent to a
-- customer. Three questions an operator has to be able to answer about a paid order, and this
-- schema could answer none of them:
--
--   did we email them?              nothing recorded either way
--   what exactly did we say?        the text was built inline and thrown away
--   can I send it again?            only by writing a second message by hand — which is how the
--                                   customer ends up with two different accounts of one order
--
-- This table is the answer to all three, and it is what the "resend receipt" button reads and
-- writes. Every message the app sends a customer lands here, sent or failed, with the provider's
-- own words when it failed.
--
-- ── IT IS A LOG, NOT A DRAFT ───────────────────────────────────────────────────────────────────
-- Rows are append-only from the app's side: no update, no delete policy. A record of what was said
-- to a customer that anybody can quietly edit afterwards is not a record — and this is exactly the
-- kind of row that gets read out in a chargeback.

create table if not exists public.customer_messages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  -- Null when the message is not about one order (an integrations test, a broadcast later on).
  order_id    uuid references public.shop_orders(id) on delete cascade,
  channel     text not null check (channel in ('email','sms')),
  kind        text not null,                       -- receipt | receipt_resend | shipped | test | …
  to_address  text not null,
  subject     text,
  body        text not null,
  -- 'sent' or 'failed'. There is no 'skipped': a message nobody tried to send does not belong in a
  -- record of what the customer was told.
  status      text not null check (status in ('sent','failed')),
  -- The provider's words when it failed — "Resend 403: …". Null on success.
  detail      text,
  -- Null when the app sent it on its own; set when a person pressed the button. The difference
  -- matters when somebody asks why a customer got two receipts.
  sent_by     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists customer_messages_order on public.customer_messages (order_id, created_at desc);
create index if not exists customer_messages_failed on public.customer_messages (created_at desc) where status = 'failed';

alter table public.customer_messages enable row level security;

-- Crew read it — it is an operational record, and the whole point is that somebody working an order
-- can see whether the customer has heard from us.
drop policy if exists customer_messages_read on public.customer_messages;
create policy customer_messages_read on public.customer_messages for select
  using (public.is_admin());

-- No insert, update or delete policy for `authenticated` ON PURPOSE. Every write comes from a
-- server route holding the service role, immediately after a send actually happened. A client that
-- can write this table can write "we emailed them" about a message that was never sent, which is
-- worse than having no table at all.
grant select on public.customer_messages to authenticated;

comment on table public.customer_messages is
  'Every message this app has sent a customer: the exact text, whether it left, and the provider''s reason when it did not. Append-only; written by server routes only. Read by the shop order record and by whoever is answering "did they hear from us?".';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Every email we send a customer is now on the order','fix','Shop',
   'The first cap order was charged, printed and never emailed, and nothing in the app could say whether a receipt had gone out or what it said. Each order now carries a record of every message sent about it — the exact wording, whether it left, and the provider''s own reason when it did not — and a receipt can be sent again from the order itself, word for word the same one.',
   '2026-09-29', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0326_what_we_told_the_customer',
  'customer_messages. A paid order could not answer did-we-email-them, what-did-we-say, or send-it-again — there was no table for it in 325 migrations. Append-only, service-role writes only: a client that can insert here can claim a message was sent that never was. Reads are is_admin() because it is an operational record, and it is the row that gets quoted in a chargeback.');

-- verify:
--   select id, order_id, channel, kind, status, detail, created_at
--     from public.customer_messages order by created_at desc limit 20;
--   select count(*) from public.customer_messages where status = 'failed';
--   select polname, polcmd from pg_policy where polrelid = 'public.customer_messages'::regclass;
--   -- expect exactly one policy, for select.
