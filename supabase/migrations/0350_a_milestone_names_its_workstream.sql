-- ── A MILESTONE NAMES ITS WORKSTREAM ───────────────────────────────────────────────────────────
-- 2026-10-05. The form audit, part 3e. Ryan: "if relational database, generate pick list … when I
-- fill out it's hard to know what's relational."
--
-- A milestone's Workstream on the Command board has been a text box since 0201, its placeholder
-- "content · events · delivery…" — the words the Aug-1 launch's planning meeting used. 0264 then made
-- the portfolio: the named workstreams, one owner each, audited every Monday, shown directly above
-- the board on the same screen and edited in a sheet whose own field reads "Workstream". The two
-- never met. Of the words production's milestones carry — branding, logistics, content, delivery,
-- events, vip — only "events" spells a workstream, so the chip on a milestone pointed at no stream,
-- no owner and no audit, and the next person to type one would spell it a new way.
--
-- 1. THE LINK. initiative_milestones.workstream_id → os_workstreams, on delete set null. The text
--    column stays: it is what a milestone filed before this still says, and what it goes on saying
--    if its workstream is ever taken out of the portfolio.
--
-- 2. THE WORDS FOLLOW THE LINK. When a milestone names its workstream, the database writes that
--    stream's name into the words. One writer: the words cannot say one stream while the link says
--    another, whoever writes the row — the board, an agent, or a paste in this editor.
--
-- 3. WHAT ALREADY SPELLS A WORKSTREAM IS LINKED, AND NOTHING ELSE. Words equal to exactly one
--    stream's name, ignoring case and the spaces around it, are linked to that stream — 0307's rule
--    for owners. The rest are not guessed: "branding" may be Print & Brand Assets, and "logistics"
--    could be D2C Delivery Ops or Trailer & Venue; whoever filed them picks, and until then the board
--    marks them as words that link to nothing. The board's own match (lib/portfolio.matchStream) is
--    this rule in TypeScript, and scripts/db.milestone.test.mjs and scripts/smoke.cjs run one list of
--    cases (scripts/fixtures/workstream-words.json) through both.
--
-- os_workstreams is the portfolio (0264), not work_streams (0159, the lanes the nav, goals and the
-- calendar are filed to). 0264 kept the two apart on purpose; a milestone is a dated deliverable of a
-- managed workstream, and the portfolio is where a workstream's owner and next action are kept.

-- ── 1) the link ────────────────────────────────────────────────────────────────────────────────
alter table public.initiative_milestones
  add column if not exists workstream_id uuid references public.os_workstreams(id) on delete set null;

create index if not exists initiative_milestones_workstream_idx
  on public.initiative_milestones (workstream_id) where workstream_id is not null;

comment on column public.initiative_milestones.workstream_id is
  'The portfolio workstream (os_workstreams, 0264) this milestone is filed to (0350). workstream keeps the words: the stream''s name, written by the database when the link is set, or words typed before 0350.';
comment on column public.initiative_milestones.workstream is
  'The words for the milestone''s workstream. With workstream_id set, the database writes the stream''s name here (milestone_workstream_words); without it, words typed before 0350, which link to nothing.';

-- ── 2) the words follow the link ───────────────────────────────────────────────────────────────
create or replace function public.milestone_workstream_words() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.workstream_id is not null then
    new.workstream := (select s.name from public.os_workstreams s where s.id = new.workstream_id);
  end if;
  return new;
end $$;
-- A trigger's function, and nothing else's: it runs as its owner so it can read the stream's name
-- whatever the person saving may read, and no role calls it directly.
revoke all on function public.milestone_workstream_words() from public, anon, authenticated;

drop trigger if exists milestone_workstream_words on public.initiative_milestones;
create trigger milestone_workstream_words
  before insert or update of workstream_id, workstream on public.initiative_milestones
  for each row execute function public.milestone_workstream_words();

-- ── 3) what already spells a workstream is linked ──────────────────────────────────────────────
update public.initiative_milestones m
   set workstream_id = s.id
  from public.os_workstreams s
 where m.workstream_id is null
   and coalesce(btrim(m.workstream), '') <> ''
   and lower(btrim(s.name)) = lower(btrim(m.workstream))
   and (select count(*) from public.os_workstreams s2
         where lower(btrim(s2.name)) = lower(btrim(m.workstream))) = 1;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A milestone is filed to a workstream from the portfolio','improvement','Command',
   'On the Command board a milestone''s workstream is picked from the portfolio above it, and the milestone shows that workstream by its current name, with who owns it, instead of a typed word that pointed at nothing. A milestone whose word already spelled a workstream is linked to it; the others keep their words, marked as linked to nothing, until someone picks.',
   '2026-10-05', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0350_a_milestone_names_its_workstream',
  'initiative_milestones.workstream_id → os_workstreams (on delete set null); milestone_workstream_words writes the stream''s name into workstream whenever the link is set; words that spell exactly one stream (case and outer spaces ignored) linked to it, nothing else guessed.');

-- verify:
--   select count(*) from public.initiative_milestones where workstream_id is not null;          -- the "events" ones
--   select workstream, workstream_id is not null as linked from public.initiative_milestones order by sort;
--   select tgname from pg_trigger where tgrelid = 'public.initiative_milestones'::regclass and tgname = 'milestone_workstream_words';
