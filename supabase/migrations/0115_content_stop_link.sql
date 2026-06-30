-- Studio content can be tied to a truck stop, not just an event.
-- Mirrors the existing event_id relation so a piece can promote a stop drop.
alter table public.content_items
  add column if not exists stop_id uuid references public.stops(id) on delete set null;

create index if not exists content_items_stop_id_idx on public.content_items(stop_id);
