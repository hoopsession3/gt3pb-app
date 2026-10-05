"use client";

import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { errorMessage } from "@/lib/errorMessage";
import type { BookSite, BookVenue } from "@/lib/venues";

// THE VENUE BOOK, ONCE (2026-10-05, the form audit, part 4) — what components/VenuePick lists: every
// vendor row (lib/venues decides which are venues, and names a linked one the pick no longer offers)
// and every place on file (vendor_locations, 0226). One read shared by every pick on the screen, the
// way useCrew is the crew's. The events list used to read the whole book, every column, to fill the
// card's <select>, and the picker under it then read the linked venue's places again on every open.
//
// A failed read is said, not passed off as an empty book: `error` is the database's sentence, and the
// pick tells the person the record keeps the venue it has. Kept for a minute; a venue added, approved
// or moved anywhere refreshes every pick on the screen (realtime), and the pick that added one
// refreshes it at once.

export type VenueBook = { venues: BookVenue[]; sites: BookSite[] };
type State = { book: VenueBook | null; error: string | null; at: number };

const TTL_MS = 60_000;
const VENUE_COLS = "id, name, status, kind, market, address, location_text, lat, lng, poc_name, poc_phone, poc_email, service_dates, archived_at";
const SITE_COLS = "id, vendor_id, label, address, location_text, lat, lng, is_primary, sort, archived_at";

let state: State = { book: null, error: null, at: 0 };
let inflight: Promise<State> | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => state;

async function fetchBook(): Promise<State> {
  if (!supabase) return { book: null, error: "offline", at: Date.now() };
  try {
    const [v, s] = await Promise.all([
      supabase.from("vendors").select(VENUE_COLS).order("name"),
      supabase.from("vendor_locations").select(SITE_COLS).is("archived_at", null),
    ]);
    const error = v.error?.message ?? s.error?.message ?? null;
    if (error) return { book: state.book, error, at: Date.now() };
    return { book: { venues: (v.data ?? []) as BookVenue[], sites: (s.data ?? []) as BookSite[] }, error: null, at: Date.now() };
  } catch (e) {
    return { book: state.book, error: errorMessage(e), at: Date.now() };
  }
}

/** Read the book again now, and hand every pick on the screen the answer. `after` — a write this
 *  screen just made — waits out a read already on its way, which may have started before the write. */
export function reloadVenues(after = false): Promise<State> {
  if (inflight) return after ? inflight.then(() => reloadVenues()) : inflight;
  inflight = fetchBook().then((next) => {
    state = next; inflight = null;
    for (const l of listeners) l();
    return state;
  });
  return inflight;
}

export function useVenues(): { book: VenueBook | null; error: string | null; loading: boolean; reload: (after?: boolean) => Promise<State> } {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { if (!state.book || Date.now() - state.at > TTL_MS) reloadVenues(); }, []);
  // A venue approved, renamed or given an address anywhere is the venue every pick shows.
  useRealtimeTable(["vendors", "vendor_locations"], () => { reloadVenues(); });
  return { book: s.book, error: s.error, loading: !s.book && !s.error, reload: reloadVenues };
}
