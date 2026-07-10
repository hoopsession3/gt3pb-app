"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useRealtimeTable } from "./realtime";

// Work streams — the business's operating lanes (0159). Categories stay atomic; a stream rolls
// many of them into one accountable lane with an owner. Table-backed so tenants reshape their own
// lanes; DEFAULT_STREAMS mirrors the founding seed so every surface renders even before the table
// answers (or on a fresh tenant that hasn't been provisioned yet).
export type WorkStream = {
  id?: string;
  key: string;
  label: string;
  color: string;
  icon?: string | null;   // icon KEY resolved by the client icon set (see OperatorNav STREAM_ICONS)
  categories: string[];
  sections: string[];
  owner_role: string | null;
  owner_user_id: string | null;
  sort: number;
};

export const DEFAULT_STREAMS: WorkStream[] = [
  { key: "service", icon: "service",    label: "Service",    color: "#5b9a6b", categories: ["stop", "drop", "delivery", "order", "prep"],    sections: ["now", "prep", "stops", "driver"],              owner_role: "operator",      owner_user_id: null, sort: 1 },
  { key: "events", icon: "events",     label: "Events",     color: "#6fa8dc", categories: ["event", "booking", "ops"],                      sections: ["plan", "prep"],             owner_role: "event_manager", owner_user_id: null, sort: 2 },
  { key: "production", icon: "production", label: "Production", color: "#c9a227", categories: ["brew", "inventory"],                            sections: ["brew", "garage"],                     owner_role: "operator",      owner_user_id: null, sort: 3 },
  { key: "brand", icon: "brand",      label: "Brand",      color: "#2bb3a3", categories: ["content"],                                      sections: ["studio"],                   owner_role: "admin",         owner_user_id: null, sort: 4 },
  { key: "business", icon: "business",   label: "Business",   color: "#8b5cf6", categories: ["money", "admin", "strategy", "task", "system"], sections: ["money", "customers", "team", "goals", "notes"], owner_role: "owner",       owner_user_id: null, sort: 5 },
];

export const streamOfCategory = (cat: string | null | undefined, streams: WorkStream[]): WorkStream | null =>
  (cat && streams.find((s) => s.categories.includes(cat))) || null;

export function useWorkStreams() {
  const [streams, setStreams] = useState<WorkStream[]>(DEFAULT_STREAMS);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("work_streams")
      .select("id, key, label, color, icon, categories, sections, owner_role, owner_user_id, sort")
      .order("sort");
    if (data?.length) setStreams(data as WorkStream[]);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable("work_streams", load);
  return streams;
}
