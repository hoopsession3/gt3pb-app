"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { useRealtimeTable } from "./realtime";
import { inWindow, nextEdge, LONGEST_WAIT_MS } from "./broadcastWindow";

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

// The broadcasts THIS viewer should currently see (RLS already filters to active/in-window/audience; the screen keeps
// each one's window too, so a scheduled end takes it down on time — lib/broadcastWindow, R13).
export function useLiveBroadcasts(): Broadcast[] {
  return useBroadcastsRead().live;
}

/** The live broadcasts and where the read stands: "reading" until a read has answered, "read", or "failed" (R38 — the
 *  bar's held place, lib/holds: none is let go of only once a read has said none). */
export function useBroadcastsRead(): { live: Broadcast[]; state: "reading" | "read" | "failed" } {
  const [rows, setRows] = useState<Broadcast[]>([]);
  const [state, setState] = useState<"reading" | "read" | "failed">("reading");
  const [now, setNow] = useState(() => Date.now());
  const load = async () => {
    if (!supabase) { setState("failed"); return; }
    // A failed read pulled every banner off the site — including one announcing a closure.
    const { data, error } = await supabase.from("broadcasts").select("*").eq("active", true).order("created_at", { ascending: false });
    if (error) { setState((s) => (s === "read" ? s : "failed")); return; }
    setRows((data as Broadcast[]) ?? []);
    setState("read");
    setNow(Date.now());
  };
  useRealtimeTable(["broadcasts"], load, { loadOnMount: true });
  // Look again at the next start or end.
  useEffect(() => {
    const at = nextEdge(rows, now);
    if (at === null) return;
    const t = setTimeout(() => setNow(Date.now()), Math.min(at - now, LONGEST_WAIT_MS));
    return () => clearTimeout(t);
  }, [rows, now]);
  const live = useMemo(() => rows.filter((b) => inWindow(b, now)), [rows, now]);
  return { live, state };
}
