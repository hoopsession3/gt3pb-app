// Live data shapes (Supabase). See supabase/migrations/0001_init.sql + 0002_referral_and_display.sql.

export interface Stop {
  id: string;
  name: string;
  location_text: string | null;
  lat: number | null;
  lng: number | null;
  status: "live" | "upcoming" | "done";
  starts_at: string | null;
  ends_at: string | null;
  when_label: string | null;
  time_label: string | null;
  tag_label: string | null;
  menu_tier: string | null;
  sort: number;
}

export interface LiveStatus {
  id: number;
  current_stop_id: string | null;
  is_live: boolean;
  next_eta: string | null;
  // Live truck position (set from the truck's phone via admin_set_truck_pos).
  truck_lat: number | null;
  truck_lng: number | null;
  pos_updated_at: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  drink_id: string;
  name: string | null;
  qty: number;
  unit_cents: number;
}

export interface Order {
  id: string;
  user_id: string | null;
  stop_id: string | null;
  status: "pending" | "ready" | "picked_up" | "cancelled";
  total_cents: number;
  paid: boolean;
  square_payment_id: string | null;
  note: string | null;
  created_at: string;
  ready_at: string | null;
  order_items?: OrderItem[];
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
