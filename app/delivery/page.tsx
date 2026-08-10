"use client";

import AccountPill from "@/components/AccountPill";
import EditableCopy from "@/components/EditableCopy";
import Watermark from "@/components/Watermark";
import { Masthead, ClosingBeat } from "@/components/kit";
import OrderFunnel from "@/components/OrderFunnel";
import StorefrontStory from "@/components/StorefrontStory";
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
        <div className="dops-empty">Delivery isn&apos;t live yet — check back soon.</div>
        <ClosingBeat />
      </section>
    );
  }
  return (
    <section className="screen" id="s-delivery">
      <Watermark variant="landing" />
      <Masthead eyebrow={<EditableCopy k="masthead.delivery" value={t("masthead.delivery")} />} right={<AccountPill />} />
      <OrderFunnel initialMode="delivery" />
      <StorefrontStory />
      <ClosingBeat />
    </section>
  );
}
