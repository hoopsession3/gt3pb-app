"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useApp } from "./AppProvider";
import Icon from "@/components/Icon";
import { readyWords, waitingToOpen } from "@/lib/ordering";
import { leadOrder, orderNo } from "@/lib/activeOrder";   // not lib/today: every page mounts this bar
import { useMyActiveOrders, useOrderActions, ETA_WORDS } from "./useMyOrders";

// A live "your order" banner for signed-in members — preparing → ready in realtime,
// no push permission required (RLS lets a member read only their own orders). Guests
// (no account) still get the at-checkout confirmation; this closes the loop for members.
//
// NOT ON TODAY (2026-10-13, R3): Today leads with the order itself — its number, its steps, the buttons that tell the
// truck — so the bar above the tabs would say it twice. Every other screen keeps the bar. The reads and the actions are
// components/useMyOrders, shared with Today's card.
const STATUS_LABEL: Record<string, string> = {
  new: "Order received",
  preparing: "Preparing your order…",
  ready: "Ready — grab it at the bar",
};

export default function OrderStatus() {
  const path = usePathname();
  if (path === "/") return null;
  return <OrderBar />;
}

function OrderBar() {
  const { nameOf } = useApp(); // the Catalog's names (R2)
  const { orders, stale, reload } = useMyActiveOrders();
  const [etaOpen, setEtaOpen] = useState(false); // chips fold until asked for
  const o = leadOrder(orders);
  const { setEta, etaBusy, cancel, canceling } = useOrderActions(o, reload);
  if (!o) return null;
  const items = o.items.map(nameOf).join(" · ");
  // Placed ahead of a stop (0343): "Order received" for hours read as "any minute now". It says when.
  const label = o.status === "new" && o.ready_from && waitingToOpen(o)
    ? readyWords({ state: "ahead", readyFrom: o.ready_from })
    : STATUS_LABEL[o.status] ?? "Your order";

  return (
    <div className={`orderbar-wrap st-${o.status}`}>
      <div className={`orderbar st-${o.status}`} role="status" aria-live="polite">
        <span className="orderbar-dot" />
        <div className="orderbar-main">
          <b>{label}</b>
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
          <button type="button" className="eta-change" onClick={() => setEtaOpen(true)}>change</button>
        </div>
      ) : (
        <button type="button" className="eta-tell" onClick={() => setEtaOpen(true)}>Tell the truck ›</button>
      )}
    </div>
  );
}
