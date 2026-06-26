-- 0072 — PRODUCTION SCHEDULE: clear test data and seed GT3's real upcoming schedule.
-- Owner confirmed all current events + truck stops are test data. Approach (safe + reversible):
--   • events  → ARCHIVED (not hard-deleted: a stray test order/sale referencing one would abort the
--               whole migration; archiving hides them from every active view and is reversible).
--   • stops   → marked 'done' and unlinked from the live truck (no FK risk).
-- Then seed the real schedule. Times on stops are sensible PLACEHOLDERS — set exact times in-app
-- (Now → Live truck). Spelling normalized: Five Forks (two words), Mercedes-Benz, Atlanta BeltLine.

-- ── 1) clear test data ──────────────────────────────────────────────────────
update public.live_status set current_stop_id = null, is_live = false where id = 1;
update public.stops  set status = 'done'              where status <> 'done';
update public.events set archived_at = now(), is_live = false where archived_at is null;

-- ── 2) truck on the ground (stops) — production ─────────────────────────────
insert into public.stops (name, location_text, starts_at, status, note, sort) values
  ('Atlanta BeltLine — World Cup Weekend', 'Atlanta BeltLine, Atlanta, GA', timestamptz '2026-07-27 11:00:00-04', 'upcoming', 'World Cup weekend.', 10),
  ('Wine Express — Five Forks',            'Wine Express, Five Forks',      timestamptz '2026-07-01 17:00:00-04', 'upcoming', 'Contact: Sandy.',   20),
  ('Wine Express — Five Forks',            'Wine Express, Five Forks',      timestamptz '2026-07-08 17:00:00-04', 'upcoming', 'Contact: Sandy.',   21),
  ('Wine Express — Five Forks',            'Wine Express, Five Forks',      timestamptz '2026-07-10 17:00:00-04', 'upcoming', 'Contact: Sandy.',   22),
  ('Wine Express — Five Forks',            'Wine Express, Five Forks',      timestamptz '2026-07-11 17:00:00-04', 'upcoming', 'Contact: Sandy.',   23);

-- ── 3) events — production ──────────────────────────────────────────────────
insert into public.events (title, day, day_label, location_text, category, blurb, sort) values
  ('Mercedes-Benz Car Show', date '2026-06-28', 'SUN', 'Mercedes-Benz', 'event', 'Car show appearance.', 10);
