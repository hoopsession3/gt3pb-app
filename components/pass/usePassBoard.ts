"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { chime } from "@/lib/chime";
import { haptic } from "@/lib/haptics";
import { usePassMuted, setPassUp } from "@/lib/passSound";
import { devicePref, useDevicePref } from "@/lib/devicePref";
import { isNetworkError, saveSnapshot, readSnapshot, readQueue, OFFLINE_EVENT } from "@/components/offline";
import { snapshotUsable } from "@/lib/offline";
import {
  readBoard, keepSame, snapDue, mergeRow, feedState, readHere, hereAfter, scopeFrom, newOrderWords, newOrdersWords, outsideWords,
  holdMove, underHeld, heldFromQueue, heldKey,
  OPEN_CAP, NOWHERE, PASS_FEED_EVENT, type BoardDown, type Here, type Scope, type Held, type HeldKind,
} from "@/lib/passBoard";
import type { Order } from "@/lib/db";
import { useApp } from "@/components/AppProvider";
import { useLatestRead } from "@/lib/useLatestRead";

// THE PASS'S BOARD — what it holds and how it stays true (2026-10-11, the KDS program, wave 2: out of app/crew/page.tsx,
// where it was the top half of the Kitchen function). The read, the realtime feed, the 15-second reconcile, the set of
// orders already rung, the order reads land in, and how sure the board is of itself. The screen is ThePass; the rules it
// runs are lib/passBoard's.

// Kitchen mounts in the Now list AND full-screen Service mode; a fixed channel name races
// removeChannel on the toggle (realtime channels are keyed by name). Unique per subscription.
let kdsChanSeq = 0;

// WHAT THIS PHONE SHOWS (2026-10-11): every order, or only the ones sold here — the stop the truck is live at, or the live
// event (lib/passBoard isHere). Kept on the phone (lib/devicePref), every order by default.
export const PASS_SCOPE = devicePref("gt3-pass-scope");
export const usePassScope = (): Scope => scopeFrom(useDevicePref(PASS_SCOPE));
export const setPassScope = (s: Scope): void => PASS_SCOPE.write(s);

export function usePassBoard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  // The pass's sound is this phone's setting, kept in one home (lib/passSound) — the bell below and
  // Settings › You › Notifications › Pass sound both change it, and the Pass reads it as it draws (2026-10-06).
  const muted = usePassMuted();
  // WHAT THE BOARD IS, AND HOW SURE OF IT THE PASS IS (2026-10-11). It said "The pass is clear" before its first read
  // had landed, and again under a raw "Backend error"; and a read made after the session had gone came back empty (RLS
  // shows a signed-out phone no orders), cleared the board, overwrote the board saved for offline, and called that
  // clear too. boardAt: when the board on screen was read — from the database, or the one this phone saved (0: no
  // board yet, so the pass is loading, not clear). down: the last read failed — "net" with no signal, "auth" with no
  // session, "read" for anything else; the board stays, and says how old it is. live: the realtime feed is connected.
  const [boardAt, setBoardAt] = useState(0);
  const [down, setDown] = useState<BoardDown>("");
  const [live, setLive] = useState(true);
  // How many open orders the last read did not bring (lib/passBoard readBoard), and where the truck is selling now.
  const [more, setMore] = useState(0);
  const [here, setHere] = useState<Here>(NOWHERE);
  const seeded = useRef(false);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  // The Pass is up while this board is: a new order rings here, and not a second time from the shell (lib/passSound).
  useEffect(() => { setPassUp(true); return () => setPassUp(false); }, []);
  // How many open tickets a read asks for: OPEN_CAP, and as many again each time "Show them" is tapped.
  const cap = useRef(OPEN_CAP);
  // A NEW ORDER IS SAID, POLITELY (2026-10-11): one line for a screen reader — the board's only live region (ThePass
  // draws it; the whole board was one, and read out every ticket's age each second). `n` makes the same words said twice
  // a new line.
  const [said, setSaid] = useState<{ text: string; n: number }>({ text: "", n: 0 });
  const say = useCallback((text: string) => setSaid((s) => ({ text, n: s.n + 1 })), []);

  // Ring + buzz + flash when a genuinely new order lands (not on initial seed / own taps).
  // The Catalog's names (R2): what a screen reader hears is what the ticket prints. Through a ref, so the menu landing (a
  // new nameOf) never tears down and reopens the board's realtime feed.
  const { nameOf } = useApp();
  const nameRef = useRef(nameOf);
  useEffect(() => { nameRef.current = nameOf; }, [nameOf]);
  const announceNew = useCallback((row: Order) => {
    if (!seeded.current) return;
    if (!mutedRef.current) { chime(); haptic("alert"); }
    say(newOrderWords(row, nameRef.current));
    setFlash((p) => new Set(p).add(row.id));
    setTimeout(() => setFlash((p) => { const n = new Set(p); n.delete(row.id); return n; }), 6000);
  }, [say]);
  // EVERY NEW ORDER RINGS, ONCE (2026-10-11). It rang only for a realtime INSERT, so an order whose insert the feed
  // missed — a socket asleep in an apron, a reconnect — came in silently with the next reconcile. Now the first time this
  // board sees an order, from the feed or from a read, it rings if it is new: once per order, never for the board's
  // first read, and never twice when the feed and a read both bring it.
  const known = useRef<Set<string>>(new Set());
  // OVERLAPPING READS LAND IN ORDER (2026-10-11): the reconcile, a return to the screen, a reconnect and a drained queue
  // can all ask at once. Only the newest read asked for is applied — a slow old answer never puts an older board back
  // (lib/useLatestRead since R17; it was a counter here).
  // The board as the phone last kept it, and when (lib/passBoard snapDue).
  const lastSnap = useRef<{ rows: readonly Order[]; at: number } | null>(null);
  // WHAT THIS PHONE HAS MOVED AND NOT YET HEARD BACK (R11, lib/passBoard holdMove/underHeld): every read and every feed row
  // is drawn under these, so a read that lands before a write (or while the write waits in the queue for signal) no longer
  // puts a ticket back in its old lane, or a collection back to unpaid. A reload starts from the moves still queued.
  const held = useRef<Map<string, Held>>(new Map());
  const drawn = useCallback((rows: Order[]): Order[] => {
    const r = underHeld(rows, held.current, Date.now(), new Set(readQueue().map((q) => q.key)));
    held.current = r.held;
    return r.rows;
  }, []);

  // Active board + recently-completed (last 30 min) so picked-up orders linger for
  // review / recall instead of vanishing instantly. Bounded (lib/passBoard readBoard).
  // READ, THEN SET — THE NEWEST READ'S ANSWER ONLY (R17, lib/useLatestRead; it was this board's own counter): the read
  // asks the session and the board, and what is drawn from the answer happens as the answer comes, never as the effect
  // that starts the read runs.
  const readNewest = useLatestRead();
  const load = useCallback(() => readNewest(async () => {
    if (!supabase) return null;
    // The session first: with none, nothing this read could say is about the pass (`down` above).
    const auth = await supabase.auth.getSession();
    const res = auth.data.session ? await readBoard(supabase, Date.now(), cap.current) : null;
    return { auth, res };
  }, (answer) => {
    if (!answer) return;
    const { auth, res } = answer;
    const error = res ? res.error : auth.error;
    if (!res || error) {
      const net = isNetworkError(error?.message);
      // No signal on a fresh open → show the last-known board (clearly labeled) instead of an
      // error over a blank pass. Taps still work; writes queue and sync when the signal returns.
      if (!seeded.current && net) {
        const snap = readSnapshot<Order[]>("gt3-kds-snap");
        if (snap && snapshotUsable(snap.at, Date.now())) {
          setOrders(snap.data); setBoardAt(snap.at);
          for (const o of snap.data) known.current.add(o.id);
          seeded.current = true;
        }
      }
      setDown(net ? "net" : res ? "read" : "auth");
      return;
    }
    const rows = drawn(res.rows);
    const fresh = seeded.current ? rows.filter((o) => o.status === "new" && !known.current.has(o.id)) : [];
    for (const o of rows) known.current.add(o.id);
    seeded.current = true;
    setOrders((prev) => keepSame(prev, rows)); setBoardAt(Date.now()); setDown(""); setMore(res.more);
    const at = Date.now();
    if (snapDue(lastSnap.current, rows, at)) { saveSnapshot("gt3-kds-snap", rows); lastSnap.current = { rows, at }; }
    fresh.forEach(announceNew);
    if (fresh.length > 1) say(newOrdersWords(fresh.length));
  }), [readNewest, announceNew, say, drawn]);
  // Where the truck is selling now — read when the Pass opens and when the feed comes back; between those, the feed's own
  // changes say it (lib/passBoard hereAfter). A failed read keeps what the board had.
  const readHereNewest = useLatestRead();   // read, then set (R17), as the board's
  const loadHere = useCallback(() => readHereNewest(async () => (supabase ? readHere(supabase) : null), (r) => {
    if (r && !r.error) setHere((h) => (h.eventId === r.here.eventId && h.stopId === r.here.stopId ? h : r.here));
  }), [readHereNewest]);
  // Merge a single row into state (no refetch). Keeps recently-done; drops voids and
  // stale dones (those fall off on the next reconcile).
  const apply = useCallback((row: Order | null, removed = false) => {
    if (!row?.id) return;
    const now = Date.now();
    setOrders((prev) => mergeRow(prev, row, removed, now));
  }, []);
  // A row from the feed is the database's, drawn under this phone's holds (a voided one, or one this phone voided, leaves).
  const fromFeed = useCallback((row: Order | null, removed: boolean) => {
    if (!row?.id || removed) { apply(row, removed); return; }
    const [shown] = drawn([row]);
    apply(shown ?? row, !shown);
  }, [apply, drawn]);
  /** A move drawn now, held until the database says it back (or HOLD_MS, or the queue sends it). */
  const hold = useCallback((o: Order, kind: HeldKind, patch: Partial<Order>) => {
    held.current = holdMove(held.current, o, kind, patch, Date.now());
  }, []);
  /** A move the database refused: let go of it — the read that follows draws the truth. */
  const release = useCallback((o: Order, kind: HeldKind) => {
    const next = new Map(held.current); next.delete(heldKey(kind, o.id)); held.current = next;
  }, []);

  // "I'm OUTSIDE" rings the pass once per order — the customer is at the window, call the name.
  const rungOutside = useRef<Set<string>>(new Set());
  const announceOutside = useCallback((row: Order) => {
    if (!seeded.current || !row.eta_status || row.eta_status !== "outside" || rungOutside.current.has(row.id)) return;
    rungOutside.current.add(row.id);
    if (!mutedRef.current) { chime(); haptic("alert"); }
    say(outsideWords(row));
    setFlash((p) => new Set(p).add(row.id));
    setTimeout(() => setFlash((p) => { const n = new Set(p); n.delete(row.id); return n; }), 6000);
  }, [say]);

  useEffect(() => {
    if (!held.current.size) held.current = heldFromQueue(readQueue());
    load();
    void loadHere();
    const recon = setInterval(() => load(), 15000);                // reconcile safety net
    // When the offline queue drains (OfflineChip replayed it), reconcile immediately so the
    // board swaps from optimistic/snapshot state to server truth.
    const onQueue = () => { if (readQueue().length === 0) load(); };
    // Back on the screen, read again (2026-10-11): a phone that slept missed every change, and the feed replays none.
    // The console's own refresh — the pull, and the read after 30s away (lib/realtime) — never reaches the Pass: it is
    // a dialog, and the pull stands down over one (lib/gesture heldBy), so the Pass keeps its own.
    const onVis = () => { if (document.visibilityState === "visible") { load(); void loadHere(); } };
    window.addEventListener(OFFLINE_EVENT, onQueue);
    document.addEventListener("visibilitychange", onVis);
    const stop = () => { clearInterval(recon); window.removeEventListener(OFFLINE_EVENT, onQueue); document.removeEventListener("visibilitychange", onVis); };
    if (!supabase) return stop;
    const sb = supabase;
    // THE FEED SAYS WHEN IT DROPS, AND CATCHES UP WHEN IT IS BACK (2026-10-11). Realtime rejoins by itself after an error
    // or a timeout but replays nothing it missed, so the board reads again the moment it is back; until then the Pass
    // says "Reconnecting…" and the 15-second reconcile carries the board. A channel the server closed is never
    // rejoined, so a new one is opened.
    // ONE CHANNEL FOR THE PASS'S OWN TABLES (2026-10-11): the orders, and the two facts that say where "here" is — the
    // truck's live stop and the live event — on the one subscription, not a channel each.
    let alive = true, broke = false, retry = 0;
    let ch: RealtimeChannel | null = null;
    const join = () => {
      ch = sb
        .channel(`admin-kds-${++kdsChanSeq}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (p) => {
          const row = (p.eventType === "DELETE" ? p.old : p.new) as Order;
          fromFeed(row, p.eventType === "DELETE");
          if (p.eventType !== "DELETE" && row?.id) {
            if (row.status === "new" && !known.current.has(row.id)) announceNew(row);
            known.current.add(row.id);
          }
          if (p.eventType === "UPDATE" && row) announceOutside(row);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "live_status" }, (p) => setHere((h) => hereAfter(h, "live_status", p)))
        .on("postgres_changes", { event: "*", schema: "public", table: "events" }, (p) => setHere((h) => hereAfter(h, "events", p)))
        .subscribe((status) => {
          if (!alive) return;
          if (status === "SUBSCRIBED") { setLive(true); if (broke) { broke = false; load(); void loadHere(); } return; }
          broke = true; setLive(false);
          if (status === "CLOSED") retry = window.setTimeout(join, 5000);
        });
    };
    join();
    return () => { alive = false; clearTimeout(retry); stop(); if (ch) sb.removeChannel(ch); };
  }, [load, loadHere, fromFeed, announceNew, announceOutside]);

  // The feed's state, told to the rest of the app whenever it changes (lib/passBoard feedState).
  const feed = feedState(down, live);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(PASS_FEED_EVENT, { detail: { state: feed, at: Date.now() } }));
  }, [feed]);

  // "+N more open orders — Show them": read as many again.
  const showMore = useCallback(() => { cap.current += OPEN_CAP; void load(); }, [load]);

  return { orders, flash, said, muted, boardAt, down, live, more, here, apply, hold, release, load, showMore };
}
