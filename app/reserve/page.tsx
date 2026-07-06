"use client";

import AccountPill from "@/components/AccountPill";
import Watermark from "@/components/Watermark";
import Gt3Mark from "@/components/Gt3Mark";
import OrderAhead from "@/components/OrderAhead";

// Order-ahead / reserve-your-drop screen. One-off Saturday pre-orders — no subscription, no plan.
export default function ReserveScreen() {
  return (
    <section className="screen" id="s-reserve">
      <Watermark variant="menu" />
      <div className="toprow">
        <div className="mast-brand">
          <Gt3Mark tone="ink" />
          <span className="pb">Performance Bar</span>
        </div>
        <AccountPill />
      </div>
      <OrderAhead />
    </section>
  );
}
