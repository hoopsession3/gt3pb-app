"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { type Ordering, type OrderingStop } from "@/lib/ordering";
import { orderingFrom, readOrdering, readStopMenu, type OrderingInputs } from "@/lib/orderingRead";
import { FOUNDING_MARKET, type Market } from "@/lib/markets";

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

const REREAD_MS = 60_000;
const TICK_MS = 30_000;

// MARKET (0279): "the next stop" means the next stop IN THIS CITY. Defaults to the founding market,
// so every caller that passes nothing behaves exactly as it did. `refreshKey`: a page that already
// hears the road in realtime (Find Us) passes what it heard, so going live re-reads at once instead
// of on the next minute.
export function useOrderingOpen(active: boolean, market: Market = FOUNDING_MARKET, refreshKey: string = ""): OrderingOpen {
  const [inputs, setInputs] = useState<OrderingInputs | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !supabase) return;
    let alive = true;
    const read = async () => {
      const r = await readOrdering(supabase!, market).catch(() => null);
      if (!alive || !r?.inputs) return;
      setInputs(r.inputs);
      setNow(Date.now());
    };
    void read();
    const reread = setInterval(read, REREAD_MS);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    const onVis = () => { if (document.visibilityState === "visible") void read(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(reread); clearInterval(tick); document.removeEventListener("visibilitychange", onVis); };
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
