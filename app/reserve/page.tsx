"use client";

import AccountPill from "@/components/AccountPill";
import Watermark from "@/components/Watermark";
import Gt3Mark from "@/components/Gt3Mark";
import OrderFunnel from "@/components/OrderFunnel";
import StorefrontStory from "@/components/StorefrontStory";

// Order-ahead / reserve-your-drop screen. One-off Saturday pre-orders — no subscription, no plan.
// This is also the signed-out storefront's story page: reserve first, then what we make, then the
// walk-up path ("order from the bar" → the menu). Today itself is members-only.
export default function ReserveScreen() {
  return (
    <section className="screen" id="s-reserve">
      <Watermark variant="landing" />
      <div className="toprow">
        <div className="mast-brand mast-dark">
          <Gt3Mark tone="cream" />
          <span className="pb">Performance Bar</span>
        </div>
        <AccountPill />
      </div>
      <OrderFunnel initialMode="pickup" />
      <StorefrontStory />
    </section>
  );
}
