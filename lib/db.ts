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
  sort: number;
}

export interface LiveStatus {
  id: number;
  current_stop_id: string | null;
  is_live: boolean;
  next_eta: string | null;
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
  day_label: string | null;
  start_time: string | null;
  end_time: string | null;
  location_text: string | null;
  member_only: boolean;
  capacity: number | null;
  going_count: number | null;
  blurb: string | null;
  sort: number;
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
