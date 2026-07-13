-- 0200 — Changelog / "What we've built": the human-readable, categorized record of every improvement
-- shipped, so a cofounder (or any leader) can reference the whole build without reading git. This is
-- the institutional-memory layer — the thing small businesses die without because it lives in one
-- founder's head. One row per shipped improvement: title, category, the part of the app it touched,
-- a one-line summary, the date, and a highlight flag for the big ones. Staff read; admins write.

create table if not exists public.changelog (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  title       text not null,
  category    text not null default 'feature'
    check (category in ('feature','improvement','fix','brand','growth','ops','money','security','design')),
  area        text,                                   -- Ordering · Studio · Pipeline · Money · Crew · Brand · Membership · Delivery · AI · Ops · Alerts · Garage
  summary     text not null,                          -- one plain-language line a non-engineer can read
  shipped_on  date not null default current_date,
  highlight   boolean not null default false,         -- the headline wins, surfaced first
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists changelog_shipped_idx on public.changelog (shipped_on desc);
create index if not exists changelog_cat_idx on public.changelog (category);

drop trigger if exists stamp_tenant_tg on public.changelog;
create trigger stamp_tenant_tg before insert on public.changelog
  for each row execute function public.stamp_tenant();

alter table public.changelog enable row level security;
drop policy if exists "changelog staff read" on public.changelog;
create policy "changelog staff read" on public.changelog for select using ((select public.is_staff()));
drop policy if exists "changelog admin write" on public.changelog;
create policy "changelog admin write" on public.changelog for all
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "tenant isolation" on public.changelog;
create policy "tenant isolation" on public.changelog as restrictive
  for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
grant select, insert, update, delete on public.changelog to authenticated;

-- Seed the build so far (from the Build Log, June 20 – July 13). Idempotent: skips any title already there.
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Load-out by space, not just weight','feature','Garage','The pack list knows if it physically fits the rig — every item footprint measured against the trailer or vehicle bay, live.','2026-06-26', false),
  ('Per-task due dates + overdue pings','feature','Crew','Any task can carry its own deadline; it turns red when overdue and pings the assignee the moment it slips.','2026-06-26', false),
  ('COGS calculator','money','Money','Cost of goods per drink and per batch, with a blended menu margin — every uncosted line flagged.','2026-06-30', false),
  ('Add-to-calendar everywhere','improvement','Ops','One-tap add-to-calendar on events, stops and the customer page — a universal .ics plus a Google link.','2026-06-30', false),
  ('Studio became a full publishing desk','feature','Studio','Caption linter, true-to-format post mockups, a repurpose engine, a media library, and a drag-to-arrange feed.','2026-06-30', true),
  ('Alerts now reach your phone','fix','Alerts','Added the missing alerts-to-push webhook and de-duplicated it, so approvals and task-due alerts push exactly once.','2026-06-30', false),
  ('Brand compliance pass','brand','Brand','Two audits stripped every invented health claim from the storefront and retired detox / toxin-free / gene-expression brand-wide, with compliant reframes.','2026-06-30', true),
  ('Road Flyer generator + 13 templates','feature','Brand','On-brand flyers made in the app — 13 luxury cuts in one GT3 family, with an AI that suggests the right cut.','2026-07-01', false),
  ('The member card is a photo frame','growth','Membership','Members drop in a photo and the gold card frames it into a share-ready portrait — and every share carries a join code.','2026-07-10', true),
  ('Our Craft brand page','brand','Brand','The Art and the Chemistry — the process story with the caffeine-molecule mark (three 3s make GT3), claim-safe throughout.','2026-07-10', false),
  ('Owner-minted discount codes','growth','Money','Mint a redeemable code (percent, set price, or free) as data — customers enter it at checkout, priced live and forge-proof.','2026-07-10', false),
  ('Quiet hours + morning digest','improvement','Alerts','Set a quiet window; non-critical alerts hold and gather into a morning digest. Critical alerts always come through.','2026-07-10', false),
  ('Sales-proposal lifecycle','feature','Pipeline','Every opportunity holds a co-authored outreach strategy through draft to sent to won/lost, on an append-only decision trail.','2026-07-10', false),
  ('One launcher for every AI copilot','feature','AI','All 24 copilots open from one launcher — search what you want to do, see only what your role can run, and jump straight there.','2026-07-12', true),
  ('B2B office delivery','feature','Delivery','Monday office bulk delivery end-to-end — amber gallon jugs, purpose-built ordering, and standing weekly orders.','2026-07-12', false),
  ('Chief-of-Staff agent','feature','AI','A meeting note — typed, transcribed, or a photo of handwriting — becomes a proposed set of operations you approve one by one.','2026-07-12', true),
  ('Interoperability wave (4 to 8 out of 10)','improvement','Ops','Feature-to-feature data now flows: moving an event date re-derives the brew schedule, stops bind to the vendor book, P&L links back to its event, and more.','2026-07-12', false),
  ('Maintenance and Audits dashboard','ops','Crew','An owner Audit tab that tracks every audit run on the app — kind, score, date, findings, and when it is due to re-run.','2026-07-12', false),
  ('Square double-charge fix','fix','Money','The checkout idempotency key is now stable per attempt, so a retry after an ambiguous failure can never charge a card twice.','2026-07-13', true),
  ('Money, RLS and cancel tests + CI gate','security','Ops','The crown-jewel money paths now have real tests, on an in-process database, that block a broken change from merging.','2026-07-13', false),
  ('Rate-limiting + AI claim-guard','security','AI','The public endpoints are throttled, and a mechanical guard stops any prohibited health claim from leaving the AI — our number-one legal line, enforced in code.','2026-07-13', false),
  ('Crew console cohesion pass','design','Crew','Customers, Prep, Garage and Team now open glance-first like Money — KPIs, dividers, and uniform panels.','2026-07-13', false),
  ('Content calendar week view','design','Studio','The content schedule opens on a beautiful, interactive week view; month is one toggle away.','2026-07-13', false),
  ('Privacy-first funnel analytics','feature','Money','See where guests drop off across order, reserve, delivery and sign-up — anonymous, no cookies, no personal data.','2026-07-13', false),
  ('Live deal ROI what-if','feature','Pipeline','Play with a partnership cut percentage and see the real dollar split and margin against the floor before you commit the deal.','2026-07-13', false),
  ('Actionable morning briefing','improvement','Crew','The Chief-of-Staff briefing is now a control surface — check off the overdue item and spin any recommendation into an assigned task, right from the card.','2026-07-13', true),
  ('Bookings folded into Pipeline','improvement','Pipeline','Inbound booking requests are now the intake stage of one lead funnel, instead of a separate tab to keep in sync.','2026-07-13', false),
  ('No more Untitled ops rows','fix','Crew','Stops, events, vendors and content are created with a real name from the start — no placeholder junk left behind.','2026-07-13', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select category, count(*) from public.changelog group by category order by 2 desc;
--   select shipped_on, title from public.changelog order by shipped_on desc limit 10;
