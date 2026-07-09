"use client";

import AccountPill from "@/components/AccountPill";
import Watermark from "@/components/Watermark";
import OrderFunnel from "@/components/OrderFunnel";
import StorefrontStory from "@/components/StorefrontStory";
import { useAuth } from "@/components/AuthProvider";

// Sunday delivery is now one arm of the unified order funnel — the same screen serves pickup, and
// the in-funnel toggle flips between them without losing the pack. This route just deep-links to
// the delivery mode (marketing splash / promo CTAs point here). Same storefront close as /reserve —
// this used to be a bare form below the ZIP check with nothing after it; a direct link here read as
// unfinished next to its mirror-image sibling.
export default function DeliveryPage() {
  const { enabled } = useAuth();
  if (!enabled) return null;
  return (
    <section className="screen" id="s-delivery">
      <Watermark variant="landing" />
      <div className="toprow">
        <div className="eyb">Order Ahead</div>
        <AccountPill />
      </div>
      <OrderFunnel initialMode="delivery" />
      <StorefrontStory />
    </section>
  );
}
