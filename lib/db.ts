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
  sort: number;
}

export interface LiveStatus {
  id: number;
  current_stop_id: string | null;
  is_live: boolean;
  next_eta: string | null;
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
