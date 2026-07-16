"use client";

import AccountPill from "@/components/AccountPill";
import EditCopyPill from "@/components/EditCopyPill";
import Watermark from "@/components/Watermark";
import { Masthead, ClosingBeat } from "@/components/kit";
import OrderFunnel from "@/components/OrderFunnel";
import Reserves from "@/components/Reserves";
import StorefrontStory from "@/components/StorefrontStory";

// Order-ahead / reserve-your-drop screen, on the kit. One-off Saturday pre-orders — no
// subscription, no plan. This is also the signed-out storefront's story page: reserve first,
// then what we make (guests only), then the walk-up path. Today itself is members-only.
export default function ReserveScreen() {
  return (
    <section className="screen" id="s-reserve">
      <Watermark variant="landing" />
      <Masthead eyebrow="Order ahead" right={<div className="mast-right"><EditCopyPill group="Reserve flow" /><AccountPill /></div>} />
      <Reserves />
      <OrderFunnel initialMode="pickup" />
      <StorefrontStory />
      <ClosingBeat />
    </section>
  );
}
