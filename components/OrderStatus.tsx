"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useAppStable } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import Icon from "@/components/Icon";
import { readyWords, waitingToOpen } from "@/lib/ordering";
import { leadOrder, orderNo } from "@/lib/activeOrder";   // not lib/today: every page mounts this bar
import { orderLine } from "@/lib/orderWords";
import { money } from "@/lib/money";
import { forgetRef, useHeldRef, type HeldRef } from "@/lib/paidRef";   // not lib/tickets: every page mounts this bar
import { useMyActiveOrders, useOrderActions, ETA_WORDS } from "./useMyOrders";
import Said from "./Said";

// A live "your order" banner for signed-in members — preparing → ready in realtime,
// no push permission required (RLS lets a member read only their own orders). A guest's
// order rides here too, by the ticket the phone holds (R3c, components/GuestOrderBar).
//
// NOT ON TODAY (2026-10-13, R3): Today leads with the order itself — its number, its steps, the buttons that tell the
// truck — so the bar above the tabs would say it twice. Every other screen keeps the bar. The reads and the actions are
// components/useMyOrders, shared with Today's card.
//
// ITS WORDS ARE TODAY'S (2026-10-13, R3b): "Order received", "Preparing your order…" and "ready at the bar" were this
// bar's own; the order reads the same here, on Today, in the toast and in the push (lib/orderWords).

// A signed-out phone's order, by its ticket (R3c): loaded only for someone signed out, so a member's pages carry none.
const GuestOrderBar = dynamic(() => import("./GuestOrderBar"), { ssr: false });

export default function OrderStatus() {
  const path = usePathname();
  const { ready, user } = useAuth();
  const paidRef = useHeldRef();
  // A charge that didn't record (R7): its reference, on every page — Today too, which has no card for an order the crew
  // has yet to add — until the person says the crew has it. Above the order bar, not in its place (R7b): a later order's
  // "Ready — grab it" was kept out of the bar for as long as the reference stayed.
  const ref = paidRef ? <RefBar r={paidRef} /> : null;
  // Not on Today (its card is the order) and not on the order's own page (it is the order).
  if (path === "/" || path === "/order") return ref;
  if (user) return <>{ref}<OrderBar /></>;
  // Not before the session is known: a member is never shown the guest's bar for a moment.
  return ready ? <>{ref}<GuestOrderBar /></> : ref;
}

function OrderBar() {
  const { nameOf } = useAppStable(); // the Catalog's names (R2)
  const { orders, stale, reload } = useMyActiveOrders();
  const [etaOpen, setEtaOpen] = useState(false); // chips fold until asked for
  const o = leadOrder(orders);
  const { setEta, etaBusy, cancel, canceling } = useOrderActions(o, reload);
  if (!o) return null;
  const items = o.items.map(nameOf).join(" · ");
  // Placed ahead of a stop (0343): "in about 8 minutes" for hours read as "any minute now". It says when.
  const label = orderLine(o.status, o.status === "new" && o.ready_from && waitingToOpen(o)
    ? readyWords({ state: "ahead", readyFrom: o.ready_from }) : null) || "Your order";

  return (
    <div className={`orderbar-wrap st-${o.status}`}>
      {/* Not a live region (R12 — the 10/10 audit, F12): the bar re-read its Cancel and its number at each change. Where
          the order stands is said when it changes. */}
      <div className={`orderbar st-${o.status}`}>
        <span className="orderbar-dot" />
        <div className="orderbar-main">
          <Said as="b" quietFirst>{label}</Said>
          <span>{items}{orders.length > 1 ? ` · +${orders.length - 1} more` : ""}{stale ? " · offline — last known" : ""}</span>
        </div>
        {/* Paid at the window, the order is the crew's to cancel: the database refuses it from a
            phone (0341), so the button that can only fail is not here. */}
        {o.status === "new" && !o.collected_at && (
          <button type="button" className="btn-del" onClick={cancel} disabled={canceling}>
            {canceling ? "Canceling…" : "Cancel"}
          </button>
        )}
        <span className="orderbar-tag">{orderNo(o.id)}</span>
      </div>
      {/* Talk to the truck — folded until asked for; once set, it collapses to the answer. */}
      {etaOpen ? (
        <div className="orderbar-eta" role="group" aria-label="Tell the truck">
          {([["on_way", "compass"], ["outside", "pin"], ["late", "clock"]] as const).map(([k, icon]) => (
            <button key={k} type="button" className={`k-chip sm${o.eta_status === k ? " on" : ""}`} disabled={etaBusy} onClick={async () => { await setEta(k); setEtaOpen(false); }} aria-pressed={o.eta_status === k}>
              <Icon name={icon} /> {ETA_WORDS[k]}
            </button>
          ))}
        </div>
      ) : o.eta_status ? (
        <div className="orderbar-eta collapsed">
          <span className="eta-set"><Icon name={({ on_way: "compass", outside: "pin", late: "clock" } as const)[o.eta_status]} /> {ETA_WORDS[o.eta_status]} <Icon name="check" /></span>
          <button type="button" className="eta-change hit-44" onClick={() => setEtaOpen(true)}>change</button>
        </div>
      ) : (
        <button type="button" className="eta-tell" onClick={() => setEtaOpen(true)}>Tell the truck ›</button>
      )}
    </div>
  );
}

/** Paid, and the order not saved: what to show at the window, kept for the day (lib/paidRef holdRef). */
function RefBar({ r }: { r: HeldRef }) {
  const said = r.ref ? `Show ref #${r.ref} at the window` : "Show this at the window";
  return (
    <div className="orderbar-wrap st-new">
      <div className="orderbar st-new">
        <span className="orderbar-dot" />
        <div className="orderbar-main">
          <Said as="b" quietFirst>{said}</Said>
          <span>Paid {money(r.cents)} — the crew is adding your order.</span>
        </div>
        <button type="button" className="eta-change hit-44" onClick={forgetRef} aria-label={`Got it — the crew has my order. ${said}`}>Got it</button>
      </div>
    </div>
  );
}
