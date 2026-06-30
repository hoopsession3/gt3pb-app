// Live data shapes (Supabase). See supabase/migrations/0001_init.sql + 0002_referral_and_display.sql.

export interface Stop {
  id: string;
  name: string;
  location_text: string | null;
  lat: number | null;
  lng: number | null;
  status: "live" | "upcoming" | "done";
  when_label: string | null;
  time_label: string | null;
  tag_label: string | null;
  menu_tier: string | null;
  notes: string | null;
  address: string | null;
  starts_at?: string | null; // the date/time it's on the calendar (0001)
  ends_at?: string | null;
  sort: number;
  // vendor / location management (0033)
  poc_name?: string | null;
  poc_phone?: string | null;
  poc_email?: string | null;
  service_dates?: string | null;
  archived_at?: string | null;
  vendor_id?: string | null; // linked canonical vendor/venue (0034)
}

// Vendor / venue — one relational record shared by truck stops and events (0034).
export interface Vendor {
  id: string;
  name: string;
  poc_name: string | null;
  poc_phone: string | null;
  poc_email: string | null;
  address: string | null;
  location_text: string | null;
  lat: number | null;
  lng: number | null;
  service_dates: string | null;
  notes: string | null;
  archived_at: string | null;
  sort: number;
}

export interface LiveStatus {
  id: number;
  current_stop_id: string | null;
  is_live: boolean;
  next_eta: string | null;
  // Live truck GPS — set from the truck's phone via admin_set_truck_pos, cleared on offline.
  truck_lat?: number | null;
  truck_lng?: number | null;
  pos_updated_at?: string | null;
}

export interface Order {
  id: string;
  user_id: string | null;
  customer: string | null;
  items: string[];
  total_cents: number;
  paid: boolean;
  payment_id: string | null;
  status: "new" | "preparing" | "ready" | "done" | "void";
  created_at: string;
  status_changed_at: string;
}

export interface BookingRequest {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  event_date: string | null;
  headcount: number | null;
  location_text: string | null;
  notes: string | null;
  status: "new" | "contacted" | "booked" | "declined";
  created_at: string;
}

export interface EventRow {
  id: string;
  title: string;
  type: string | null;
  day: string | null; // ISO date (events.day) — drives the Prep "by date/when" grouping
  day_label: string | null;
  start_time: string | null;
  end_time: string | null;
  location_text: string | null;
  member_only: boolean;
  capacity: number | null;
  going_count: number | null;
  blurb: string | null;
  sort: number;
  // operational event object (0024) — the "hard prep" config the pack list + command center read
  archetype?: string | null;
  rig?: "cart_only" | "trailer_only" | "trailer_plus_cart" | null;
  menu_nitro?: boolean;
  menu_nature_aid?: boolean;
  menu_salted_maple?: boolean;
  menu_bottles?: boolean;
  menu_broth?: boolean;
  power_available?: boolean | null;
  water_available?: boolean | null;
  expected_attendance?: number | null;
  duration_hrs?: number | null;
  staff_count?: number | null;
  is_live?: boolean;
  state?: string | null;
  county?: string | null;
  archived_at?: string | null; // set when filed out of the operator's active workspace (0032)
  vendor_id?: string | null;   // linked canonical vendor/venue (0034)
  category?: string | null;    // company-calendar bucket: event | admin | ops (0065)
  plan_days?: number | null;   // how many days the day-planner / run-of-show spans (0067)
  stage?: string | null;       // lifecycle: lead | confirmed | prep | live | done (0075)
}

// Per-event execution checklist (0025) — pack-list items + ad-hoc tasks, role-scoped.
export interface EventTask {
  id: string;
  event_id: string | null;      // polymorphic owner: exactly one of event_id / stop_id / meeting_note_id
  stop_id?: string | null;      // truck-stop pick lists (0040)
  meeting_note_id?: string | null; // meeting-note follow-ups (0049)
  label: string;
  section: string | null;
  kind: "pack" | "task";
  critical: boolean;
  warn?: boolean; // important backup (amber) — between critical (red) and plain
  assignee: string | null;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  due_at?: string | null;         // optional per-task deadline (0103); drives "tasks past due"
  link: string | null;
  sort: number;
  ai_proposal?: string | null;   // AI-proposed completion / answer (0061)
  ai_has_answer?: boolean | null; // true when GT3 data already answers it
  target_qty?: number | null;     // planned amount (0088)
  actual_qty?: number | null;     // confirmed actual → on hand (0088)
}

// Meeting notes (0049) — in-app system of record for talking points. Leadership-only
// (event_manager/admin/owner), tenant-scoped. Follow-ups become event_tasks owned by
// meeting_note_id, so they flow through My Tasks + push exactly like event/stop tasks.
export interface MeetingNote {
  id: string;
  title: string;
  met_on: string;          // ISO date
  summary: string | null;  // quick recap (e.g. the notee summary)
  body: string | null;     // full transcript / detail (optional)
  source: string;          // 'manual' (composer) or 'email' (notee → inbound)
  event_id: string | null; // optional relational link to an event
  created_by: string | null;
  tenant_id?: string | null;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
}

// Event location/jurisdiction lives on EventRow (state/county, 0026) for compliance.

// Alerts (0050) — tenant-scoped, severity-tiered "don't-miss" inbox. Producers insert rows; the
// push Edge Function fans out to Teams + web push by severity; the in-app inbox acknowledges.
export interface Alert {
  id: string;
  severity: "critical" | "important" | "fyi";
  category: string | null;
  title: string;
  body: string | null;
  link: string | null;
  target_user_id: string | null;
  created_by: string | null;
  ack_at: string | null;
  ack_by: string | null;
  created_at: string;
}

// Comments (0051) — polymorphic discussion threads: a comment belongs to exactly one of an
// event_task / meeting_note / alert. Replies + @mentions notify through the alert spine.
export interface Comment {
  id: string;
  body: string;
  author_id: string | null;
  event_task_id?: string | null;
  meeting_note_id?: string | null;
  alert_id?: string | null;
  mentions: string[];
  created_at: string;
}

// Limited reserves (0014_reserves.sql). Stock is server-authoritative; members
// claim via the claim_reserve RPC (atomic, no oversell).
export interface Reserve {
  id: string;
  name: string;
  blurb: string | null;
  price_cents: number;
  stock_total: number;
  stock_remaining: number;
  per_member_limit: number;
  member_only: boolean;
  status: "draft" | "live" | "sold_out" | "archived";
  drop_at: string | null;
  sort: number;
  created_at: string;
}

export interface ReserveClaim {
  id: string;
  reserve_id: string;
  user_id: string;
  qty: number;
  state: "held" | "paid" | "expired" | "cancelled";
  hold_expires_at: string | null;
  order_id: string | null;
  created_at: string;
}

// Subscriptions mirror (0015). Square is billing truth; this row is a read-only
// status cache written only by the server/webhook (service role).
export interface Subscription {
  id: string;
  user_id: string;
  square_subscription_id: string | null;
  plan: string;
  cadence: string | null;
  status: "pending" | "active" | "paused" | "canceled" | "past_due";
  current_period_end: string | null;
  square_card_id: string | null;
  created_at: string;
  updated_at: string;
}
