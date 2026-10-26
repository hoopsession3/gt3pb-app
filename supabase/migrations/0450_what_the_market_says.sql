-- ── 0450 — WHAT THE MARKET SAYS ───────────────────────────────────────────────────────────────────────────────────
-- 2026-10-25. R56, phase D of the investor-ready vision (Ryan, 2026-10-25: "AI do a market research and give a score of
-- success… continuous AI market research with citations, never invented… explainable scores, not probabilities").
-- Paste into Supabase → SQL Editor → Run. A second run changes nothing. Needs 0449.
--
-- WHAT.
--   vision_research — what a plan's market research found, one finding a row: its topic (demand, competition, costs,
--   the location, the rules, trends), the claim in a sentence, the figure if it has one, and where it came from — the
--   source's address (https only) and title, when the source dates itself, and when GT3 read it. A finding arrives
--   "proposed": the research route keeps only findings whose address the web search actually returned (an address the
--   model wrote that no search returned is dropped, never stored). An owner or admin accepts or rejects each one; only
--   accepted findings count in a plan's score, and every one keeps its link. Accepting says which way it bears on the
--   plan — for it, against it, or neither — a person's reading of the source, never the model's.
--   Owners and admins read and write — the research sits beside the plan's money. No link reads it (vision_shared is
--   unchanged). Every change is in Settings › Activity log.
--
-- set lock_timeout (database F16): one table made, its triggers and policies.
-- existing rows: none changed.
-- rollback: drop table vision_research cascade.
-- changelog: none — the owners' own screen.

set lock_timeout = '5s';

create table if not exists public.vision_research (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  plan_id      uuid not null references public.vision_plans(id) on delete cascade,
  run_id       uuid,
  topic        text not null check (topic in ('demand','competition','costs','location','rules','trends')),
  claim        text not null check (length(claim) between 1 and 600),
  figure       text check (figure is null or length(figure) <= 120),
  source_url   text not null check (source_url ~ '^https://' and length(source_url) <= 1000),
  source_title text check (source_title is null or length(source_title) <= 300),
  published    text check (published is null or length(published) <= 60),
  retrieved_at timestamptz not null default now(),
  status       text not null default 'proposed' check (status in ('proposed','accepted','rejected')),
  bearing      text check (bearing is null or bearing in ('for','against','neutral')),
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists vision_research_plan on public.vision_research (plan_id, retrieved_at desc);

drop trigger if exists stamp_tenant_tg on public.vision_research;
create trigger stamp_tenant_tg before insert on public.vision_research for each row execute function public.stamp_tenant();
alter table public.vision_research enable row level security;
drop policy if exists "vision research admin" on public.vision_research;
create policy "vision research admin" on public.vision_research for all using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "tenant isolation" on public.vision_research;
create policy "tenant isolation" on public.vision_research as restrictive for all
  using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()));
revoke all on public.vision_research from public, anon, authenticated;
grant select, insert, update, delete on public.vision_research to authenticated;
drop trigger if exists admin_audit_vision_research on public.vision_research;
create trigger admin_audit_vision_research after insert or update or delete on public.vision_research for each row execute function public.log_admin_audit();

-- verify (numbers only):
--   select count(*) from public.vision_research;   -- 0 (first run)
select public.record_migration('0450_what_the_market_says');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
