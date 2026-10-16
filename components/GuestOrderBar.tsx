"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useApp } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import { ticketPath, useHeldTickets } from "@/lib/tickets";
import { orderLine } from "@/lib/orderWords";
import { readyWords, waitingToOpen } from "@/lib/ordering";

// A SIGNED-OUT PHONE'S ORDER, IN THE BAR (2026-10-13, R3c — the rest of board 09: "the phone keeps the link, so Today
// and Find Us can show 'Your order #4F2A' to a signed-out phone too"). A member's bar reads their own rows; a guest has
// none to read, only the ticket the confirmation gave them (lib/tickets). The newest one this phone holds is read
// through order_ticket (0395) — that one order and nothing else — and while it is in, being made or ready, it rides
// above the tabs in the bar's own words, and a tap opens its page. Done or canceled, it leaves; a ticket that can't be
// read leaves too (its page says why). It loads only for someone signed out (components/OrderStatus), so a member's
// pages carry none of it.
//
// CANCELED, IT SAYS SO (2026-10-15, R7 of the customer re-audit). A guest's order the crew canceled left the bar without a
// word — a guest has no email or push with us, so the bar was the only place to hear it. For the hour after, the bar says
// Canceled and what becomes of the money, and a tap opens the order's page.

const ACTIVE = new Set(["new", "preparing", "ready"]);
const POLL_MS = 20_000;   // the member's bar hears the row change; a guest's reads it again while it is in front of them
const CANCELED_SAID_MS = 60 * 60 * 1000;   // a canceled order rides the bar for the hour after
type Seen = { no: string; status: string; items: string[]; ready_from: string | null; placed_at: string;
  moved_at?: string | null; paid?: boolean; at_window?: boolean; recentlyCanceled?: boolean };

export default function GuestOrderBar() {
  const held = useHeldTickets();
  const lead = held?.[0] ?? null;
  return lead ? <TicketBar t={lead.t} /> : null;
}

function TicketBar({ t }: { t: string }) {
  const { nameOf } = useApp();
  const seen = useAsyncData<Seen | null>(async () => {
    if (!supabase) return null;
    const { data, error } = await supabase.rpc("order_ticket", { p_ticket: t });
    if (error) throw new Error(error.message);
    const d = data as Seen;
    // Read once per answer, not while drawing: canceled within the hour.
    return { ...d, recentlyCanceled: d.status === "void" && !!d.moved_at && Date.now() - Date.parse(d.moved_at) < CANCELED_SAID_MS };
  }, [t]);
  const o = seen.data;
  const live = !!o && ACTIVE.has(o.status);
  const reload = seen.reload;
  useEffect(() => {
    if (!live) return;
    const tick = () => { if (document.visibilityState === "visible") void reload(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [live, reload]);
  if (o?.recentlyCanceled) {
    const money = o.at_window ? "What you paid at the window comes back there." : o.paid ? "Your card is being refunded in full." : "Nothing was charged.";
    return (
      <div className="orderbar-wrap st-void" role="status" aria-live="polite">
        <Link href={ticketPath(t)} className="orderbar orderbar-void text-inherit no-underline" aria-label={`Order ${o.no} was canceled. ${money} Open it`}>
          <span className="orderbar-dot" />
          <span className="orderbar-main">
            <b>Canceled</b>
            <span>{money}</span>
          </span>
          <span className="orderbar-tag">{o.no}</span>
        </Link>
      </div>
    );
  }
  if (!o || !live) return null;
  const ahead = o.status === "new" && waitingToOpen({ created_at: o.placed_at, ready_from: o.ready_from });
  const label = orderLine(o.status, ahead && o.ready_from ? readyWords({ state: "ahead", readyFrom: o.ready_from }) : null) || "Your order";
  return (
    <div className={`orderbar-wrap st-${o.status}`} role="status" aria-live="polite">
      <Link href={ticketPath(t)} className={`orderbar st-${o.status} text-inherit no-underline`} aria-label={`${label} Order ${o.no} — open it`}>
        <span className="orderbar-dot" />
        <span className="orderbar-main">
          <b>{label}</b>
          <span>{o.items.map(nameOf).join(" · ")}{seen.error ? " · offline — last known" : ""}</span>
        </span>
        <span className="orderbar-tag">{o.no}</span>
      </Link>
    </div>
  );
}
