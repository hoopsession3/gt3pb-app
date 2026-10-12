"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import AccountPill from "@/components/AccountPill";
import EditableCopy from "@/components/EditableCopy";
import Watermark from "@/components/Watermark";
import { Masthead, ClosingBeat } from "@/components/kit";
import OrderFunnel from "@/components/OrderFunnel";
import { useAuth } from "@/components/AuthProvider";
import { useSiteCopy } from "@/lib/copy";

// Sunday delivery is one arm of the unified order funnel — the same screen serves pickup, and
// the in-funnel toggle flips between them without losing the pack. This route deep-links to the
// delivery mode (marketing splash / promo CTAs point here). Same kit anatomy as /reserve.
export default function DeliveryPage() {
  const { enabled } = useAuth();
  const t = useSiteCopy();
  if (!enabled) {
    return (
      <section className="screen" id="s-delivery">
        <Watermark variant="landing" />
        <Masthead eyebrow={<EditableCopy k="masthead.delivery" value={t("masthead.delivery")} />} right={<AccountPill />} />
        <EditableCopy k="delivery.not_live" value={t("delivery.not_live")} as="div" className="dops-empty" />
        <ClosingBeat />
      </section>
    );
  }
  return (
    <section className="screen" id="s-delivery">
      <Watermark variant="landing" />
      <Masthead eyebrow={<EditableCopy k="masthead.delivery" value={t("masthead.delivery")} />} right={<AccountPill />} />
      {/* Under the line above it, not against it (2026-10-09). */}
      <div className="mt-4"><Suspense fallback={<OrderFunnel initialMode="delivery" />}><DeliveryFunnel /></Suspense></div>
      <ClosingBeat />
    </section>
  );
}

// /delivery?for=office opens the funnel on its office side (2026-10-12, A2 of the account audit: Shop's "For your
// office" and the office page's "Set up office delivery"). Read as the router reads it, so a tap from another page lands
// right — and read once, as it arrives: the funnel's own Pickup · Delivery switch rewrites the address without it, and
// that must not start the funnel over (the cart with it).
function DeliveryFunnel() {
  const params = useSearchParams();
  const [office] = useState(() => params.get("for") === "office");
  return <OrderFunnel initialMode="delivery" initialAudience={office ? "office" : "home"} />;
}
