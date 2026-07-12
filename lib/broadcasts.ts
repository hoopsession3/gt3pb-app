"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useRealtimeTable } from "./realtime";

// BROADCASTS (0196) — the operator's live announcement bar. RLS decides visibility (a guest only ever
// receives an active, in-window, audience='all' row), so the client just reads and renders. Realtime-
// subscribed so a publish/toggle shows for everyone without a refresh.
export type Broadcast = {
  id: string;
  title: string;
  body: string | null;
  kind: "announcement" | "promo" | "maintenance";
  style: "info" | "success" | "warning" | "brand";
  audience: "all" | "members" | "staff";
  cta_label: string | null;
  cta_href: string | null;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
};

// The broadcasts THIS viewer should currently see (RLS already filters to active/in-window/audience;
// we re-check the window client-side so a scheduled end hides it without waiting for a refetch).
export function useLiveBroadcasts(): Broadcast[] {
  const [rows, setRows] = useState<Broadcast[]>([]);
  const load = async () => {
    if (!supabase) return;
    const { data } = await supabase.from("broadcasts").select("*").eq("active", true).order("created_at", { ascending: false });
    const now = Date.now();
    setRows(((data as Broadcast[]) ?? []).filter((b) =>
      (!b.starts_at || new Date(b.starts_at).getTime() <= now) &&
      (!b.ends_at || new Date(b.ends_at).getTime() >= now)));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useRealtimeTable(["broadcasts"], load);
  return rows;
}
