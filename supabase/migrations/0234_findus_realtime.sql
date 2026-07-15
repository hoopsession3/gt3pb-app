-- 0234 — Find Us reads the road live. The unified surface subscribes to field_ops (the mirrors
-- write it on every stop/event change), so the spine table joins the realtime publication like
-- stops/live_status did in 0001. RLS still guards the wire: subscribers only receive rows their
-- role can SELECT (anon = is_public rows, per 0233's door).
do $$ begin
  alter publication supabase_realtime add table public.field_ops;
exception when duplicate_object then null;
end $$;
