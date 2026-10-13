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

const ACTIVE = new Set(["new", "preparing", "ready"]);
const POLL_MS = 20_000;   // the member's bar hears the row change; a guest's reads it again while it is in front of them
type Seen = { no: string; status: string; items: string[]; ready_from: string | null; placed_at: string };

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
    return data as Seen;
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
