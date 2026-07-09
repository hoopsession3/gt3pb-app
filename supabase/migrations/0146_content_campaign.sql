-- 0146 — tie a post to a campaign / theme. One free-text column; the Studio picker reuses existing
-- values (a datalist) so categorization stays cohesive and light, not a taxonomy to maintain.
alter table public.content_items add column if not exists campaign text;
create index if not exists content_items_campaign_idx on public.content_items(campaign) where campaign is not null;
-- verify: select count(*) from information_schema.columns where table_name='content_items' and column_name='campaign';  -- 1
select count(*) as col from information_schema.columns where table_name='content_items' and column_name='campaign';
