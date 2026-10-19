"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { type Ordering, type OrderingStop } from "@/lib/ordering";
import { orderingFrom, readOrdering, readStopMenu, type OrderingInputs } from "@/lib/orderingRead";
import { FOUNDING_MARKET, type Market } from "@/lib/markets";
import { sharedStore } from "@/lib/shared";
import { sameJson } from "@/lib/sharedCore";
import { useMinute } from "@/lib/useMinute";

// IS THE TRUCK TAKING CUP ORDERS? — every ordering surface asks here (Find Us, the menu, the drink
// sheet, checkout). The rule is lib/ordering's and the read is lib/orderingRead's, the same two
// /api/checkout runs before any charge (2026-10-04: until then the server read a different switch
// and a different lead, and could refuse at Pay what this hook had offered).
//
// The answer moves with the clock as well as the data — a stop's window opens at start − lead with
// nothing written anywhere — so it is recomputed on a tick and re-read every minute and whenever
// the page comes back into view. Before the first read lands it is optimistic (open, unchecked,
// no claims), and a failed read keeps the last answer: the server holds the gate either way.
export type OrderingOpen = {
  open: boolean;
  checked: boolean;                 // false until the first read lands (render optimistically)
  nextAt: string | null;            // the stop an order now is for, or the one ordering waits on
  nextName: string | null;
  pickup: boolean;                  // does THIS stop offer pickup? (per-stop opt-in, 0191)
  ordering: Ordering | null;        // the whole answer — state, stop, opensAt, readyFrom — once read
  stops: OrderingStop[];            // the city's road, for the pack line (lib/orderAhead.packDropFrom)
  // The drinks the stop an order is for pours (stop_menu, 0393) — null when no menu is set, or not read yet: it limits
  // nothing then, and Pay checks it itself (2026-10-13, R2 — the Catalog is the menu).
  stopMenu: ReadonlySet<string> | null;
};

// ONE READ FOR EVERY SCREEN THAT ASKS (R38 — the fresh audit's PERF11-10, the shared read audit-10 F5 left out). Each
// caller read the three rows for itself, every minute, hidden or not: /menu with a drink sheet open read them twice a
// minute, and a tab in the background kept polling. One store per city now (lib/shared): the first screen to ask reads and
// hears the road and the truck's switch live (stops, live_status); the city's own switch (market_live) isn't in the
// realtime publication, so the minute still reads — only while the page is on screen — and a return to the page reads at
// once. A read that fails keeps the last answer (the server holds the gate either way).
const ORDERING = sharedStore<OrderingInputs | null>({
  initial: null,
  read: async (market) => {
    if (!supabase) return undefined;
    const r = await readOrdering(supabase, market as Market).catch(() => null);
    return r?.inputs ?? undefined;
  },
  tables: () => ["live_status", "stops"],
  every: { ms: 60_000 },
  back: true,
  equal: sameJson,
});

// MARKET (0279): "the next stop" means the next stop IN THIS CITY. Defaults to the founding market,
// so every caller that passes nothing behaves exactly as it did. `refreshKey`: a page that already
// hears the road in realtime (Find Us) passes what it heard, so going live re-reads at once instead
// of on the next minute.
export function useOrderingOpen(active: boolean, market: Market = FOUNDING_MARKET, refreshKey: string = ""): OrderingOpen {
  const inputs = ORDERING.use(active && supabase ? market : null);
  // The answer moves with the clock too — a stop's window opens at start − lead with nothing written anywhere — read as
  // the screen renders (lib/useMinute: the same minute for every screen, no timer of each one's own).
  const now = useMinute();
  // What a page heard of the road changed: read again at once (not on the first draw — the store's own first read is that).
  const heard = useRef(refreshKey);
  useEffect(() => {
    if (heard.current === refreshKey) return;
    heard.current = refreshKey;
    if (active && supabase) void ORDERING.reload(market);
  }, [active, market, refreshKey]);
  const o = inputs ? orderingFrom(inputs, now) : null;
  // The stop's menu, read once per stop (it changes when the crew edits the stop, not with the clock). A failed read keeps
  // no menu — the screen limits nothing and Pay decides.
  const stopId = o?.stop?.id ?? null;
  const [menuOf, setMenuOf] = useState<{ id: string; menu: ReadonlySet<string> | null } | null>(null);
  useEffect(() => {
    if (!active || !supabase || !stopId) return;
    let alive = true;
    readStopMenu(supabase, stopId).then((r) => { if (alive && !r.error) setMenuOf({ id: stopId, menu: r.menu ? new Set(r.menu) : null }); }).catch(() => {});
    return () => { alive = false; };
  }, [active, stopId]);
  return {
    open: o ? o.open : true, checked: o !== null, ordering: o, stops: inputs?.stops ?? [],
    nextAt: o?.stop?.starts_at ?? null, nextName: o?.stop?.name ?? null, pickup: !!o?.stop?.pickup,
    stopMenu: menuOf && menuOf.id === stopId ? menuOf.menu : null,
  };
}
