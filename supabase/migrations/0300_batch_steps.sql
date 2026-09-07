-- 0300 — A batch you can actually work from.
--
-- WHAT WAS WRONG. The recipes have carried an ordered method since 0079 — six steps each, one action
-- apiece, which is the right shape. The problem is that they were only ever rendered in one place:
-- the PLANNING result, as a flat <ol> under a "Method" heading, before the batch even exists. Once
-- you commit the batch and walk over to actually brew it, the steps are gone. There is a Start brew
-- sheet, an Adjust sheet, a Batch log sheet and a Bottle loadout sheet, and not one of them shows you
-- what to do.
--
-- So the instructions are not badly written so much as unreachable at the moment they are needed, and
-- unusable when they are: nothing to tick, no quantities for THIS run, no timer, and no memory. A
-- cold extraction runs twelve to twenty hours. Whoever starts it is frequently not whoever finishes
-- it, and a list you cannot mark is a list the second person has to guess their way into.
--
-- WHY THE STEPS ARE COPIED ONTO THE BATCH. The obvious build is a jsonb column of ticked indexes
-- pointing at brew_recipes.method. That breaks the moment anyone edits the recipe mid-brew: step 4
-- was "cold-extract 12-20 hrs" when it was ticked and is something else by the time the batch is
-- read back, and the record now says a person did a thing they never did. The method is snapshotted
-- onto the batch on first open. What was ticked is what it said at the time — for twenty hours that
-- is not a hypothetical.
--
-- WHAT IS NOT HERE. The Toddy Cafe Series card is a good piece of instructional design and it is
-- also the manufacturer's procedure for their vessel, not GT3's recipe — different ratio, and it
-- calls for a twenty-minute bloom that GT3's method does not have. Recording it against the vessel
-- was offered and declined: the app carries GT3's method only. This migration changes how the steps
-- are delivered and not one word of what they say.

create table if not exists public.brew_batch_steps (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  batch_id    uuid not null references public.brew_batches(id) on delete cascade,
  step_no     int  not null check (step_no > 0),
  step_text   text not null,          -- snapshotted from the recipe, not a pointer into it
  done_at     timestamptz,
  done_by     uuid references auth.users(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now(),
  unique (batch_id, step_no)
);
create index if not exists brew_batch_steps_batch_idx on public.brew_batch_steps (batch_id, step_no);

alter table public.brew_batch_steps enable row level security;
drop policy if exists "steps staff" on public.brew_batch_steps;
create policy "steps staff" on public.brew_batch_steps for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "tenant isolation" on public.brew_batch_steps;
create policy "tenant isolation" on public.brew_batch_steps as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
grant select, insert, update on public.brew_batch_steps to authenticated;

drop trigger if exists stamp_tenant_tg on public.brew_batch_steps;
create trigger stamp_tenant_tg before insert on public.brew_batch_steps
  for each row execute function public.stamp_tenant();
drop trigger if exists audit_brew_batch_steps on public.brew_batch_steps;
create trigger audit_brew_batch_steps after insert or update or delete
  on public.brew_batch_steps for each row execute function public.audit_row();

comment on table public.brew_batch_steps is
  'The method as it stood when this batch was opened, one row per step, with who ticked it and when. Copied rather than referenced so an edit to the recipe cannot rewrite what somebody already did.';

-- ── open the checklist ─────────────────────────────────────────────────────────────────────────
create or replace function public.ensure_batch_steps(p_batch_id uuid)
returns setof public.brew_batch_steps language plpgsql security definer set search_path = public as $$
declare b public.brew_batches; m text[];
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select * into b from public.brew_batches where id = p_batch_id;
  if not found then raise exception 'No such batch.'; end if;

  if not exists (select 1 from public.brew_batch_steps where batch_id = p_batch_id) then
    select r.method into m from public.brew_recipes r where r.id = b.recipe_id;
    -- A batch whose recipe was deleted still deserves a checklist rather than a crash; it just has
    -- nothing to put in it, and the caller can see that it is empty.
    if m is not null then
      insert into public.brew_batch_steps (batch_id, tenant_id, step_no, step_text)
      select p_batch_id, b.tenant_id, ord, txt
        from unnest(m) with ordinality as t(txt, ord)
       where btrim(coalesce(txt, '')) <> '';
    end if;
  end if;

  return query select * from public.brew_batch_steps where batch_id = p_batch_id order by step_no;
end $$;
revoke all on function public.ensure_batch_steps(uuid) from public;
grant execute on function public.ensure_batch_steps(uuid) to authenticated;

create or replace function public.set_batch_step(p_batch_id uuid, p_step_no int, p_done boolean)
returns public.brew_batch_steps language plpgsql security definer set search_path = public as $$
declare s public.brew_batch_steps;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  update public.brew_batch_steps
     set done_at = case when p_done then coalesce(done_at, now()) else null end,
         done_by = case when p_done then coalesce(done_by, auth.uid()) else null end
   where batch_id = p_batch_id and step_no = p_step_no
  returning * into s;
  if not found then raise exception 'That step is not on this batch. Open the checklist first.'; end if;
  return s;
end $$;
revoke all on function public.set_batch_step(uuid, int, boolean) from public;
grant execute on function public.set_batch_step(uuid, int, boolean) to authenticated;

-- ── how far along is it ────────────────────────────────────────────────────────────────────────
create or replace view public.v_batch_progress as
select b.id as batch_id, b.recipe_name, b.market, b.batch_gal, b.status, b.ready_at,
       count(s.id)                                   as steps_total,
       count(s.id) filter (where s.done_at is not null) as steps_done,
       (select s2.step_no from public.brew_batch_steps s2
         where s2.batch_id = b.id and s2.done_at is null
         order by s2.step_no limit 1)                as next_step_no,
       (select s2.step_text from public.brew_batch_steps s2
         where s2.batch_id = b.id and s2.done_at is null
         order by s2.step_no limit 1)                as next_step,
       (count(s.id) > 0 and count(s.id) = count(s.id) filter (where s.done_at is not null)) as all_done
  from public.brew_batches b
  left join public.brew_batch_steps s on s.batch_id = b.id
 group by b.id, b.recipe_name, b.market, b.batch_gal, b.status, b.ready_at;

revoke all on public.v_batch_progress from public, anon;
grant select on public.v_batch_progress to authenticated;

comment on view public.v_batch_progress is
  'Where each batch has got to in its own method, and what the next unticked step is — the thing whoever walks up mid-brew needs to know.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Brew steps you can work from, and tick off','improvement','Prep',
   'Every recipe has carried its method for a long time, but it only ever appeared while planning a batch — once the batch existed and it was time to actually brew, the steps were nowhere. They now live on the batch itself: numbered, with this run''s real quantities beside them, ticked off as you go and remembered. A cold extraction runs most of a day and the person who starts it often is not the person who finishes it, so the checklist keeps who did what and when. The steps are copied onto the batch when you open it, so editing a recipe mid-brew cannot rewrite what somebody already did.',
   '2026-09-06', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select * from public.ensure_batch_steps('<batch id>');
--   select * from public.v_batch_progress where steps_total > 0;
