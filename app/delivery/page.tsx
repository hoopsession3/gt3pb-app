"use client";

import AccountPill from "@/components/AccountPill";
import OrderFunnel from "@/components/OrderFunnel";
import { useAuth } from "@/components/AuthProvider";

// Sunday delivery is now one arm of the unified order funnel — the same screen serves pickup, and
// the in-funnel toggle flips between them without losing the pack. This route just deep-links to
// the delivery mode (marketing splash / promo CTAs point here).
export default function DeliveryPage() {
  const { enabled } = useAuth();
  if (!enabled) return null;
  return (
    <section className="screen" id="s-delivery">
      <div className="toprow">
        <div className="eyb">Order Ahead</div>
        <AccountPill />
      </div>
      <OrderFunnel initialMode="delivery" />
    </section>
  );
}
