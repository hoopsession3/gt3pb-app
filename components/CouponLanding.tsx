"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trackFunnel } from "@/lib/funnel";
import EditableCopy from "@/components/EditableCopy";
import Watermark from "@/components/Watermark";
import { useSiteCopy } from "@/lib/copy";

// COUPON LANDING (0268) — where a printed QR points. The scan COUNTS ITSELF (funnel_events, the
// same zero-PII spine every storefront funnel uses), then the page routes by what the code IS in
// the engine: an order-repricing code walks straight into the pack flow with the code pre-applied;
// the free-pour-on-return card explains the Loop hand-off (its redemption is a bottle coming back,
// logged crew-side, not a checkout event). Codes are DATA — rename, retire, or re-offer in Money ›
// Codes and this page follows with zero deploys. The printed QR never goes stale.

type Cpn = { ok: boolean; code?: string; kind?: string; label?: string; active?: boolean };

export default function CouponLanding({ code }: { code: string }) {
  const t = useSiteCopy();
  const [cpn, setCpn] = useState<Cpn | null>(null);
  useEffect(() => {
    trackFunnel("coupon", code.toUpperCase().slice(0, 40));   // the scan counter — fire once per landing
    fetch(`/api/coupon/${encodeURIComponent(code)}`)
      .then((r) => r.json()).then(setCpn)
      .catch(() => setCpn({ ok: false }));
  }, [code]);

  const checkoutKind = cpn?.kind === "amount_off" || cpn?.kind === "percent_off" || cpn?.kind === "price_override";
  return (
    <main className="cpn">
      <Watermark variant="landing" />
      <div className="cpn-card">
        <div className="cpn-brand">GT3 PERFORMANCE BAR</div>
        {cpn === null ? (
          <p className="cpn-sub">One sec…</p>
        ) : cpn.ok && cpn.active ? (
          <>
            <h1 className="cpn-offer">{cpn.label}</h1>
            {checkoutKind ? (
              <>
                <EditableCopy k="coupon.checkout_sub" value={t("coupon.checkout_sub")} as="p" className="cpn-sub" />
                {/* CTAs sit inside a <Link> → plain t(), not inline-editable. */}
                <Link className="cpn-cta" href={`/reserve?code=${encodeURIComponent(cpn.code ?? code)}`}>{t("coupon.checkout_cta")}</Link>
                <div className="cpn-code">{t("coupon.code_label")} <b>{cpn.code}</b></div>
              </>
            ) : (
              <>
                <EditableCopy k="coupon.loop_body" value={t("coupon.loop_body")} as="p" className="cpn-sub" multiline />
                <Link className="cpn-cta" href="/menu">{t("coupon.loop_cta")}</Link>
              </>
            )}
          </>
        ) : (
          <>
            <EditableCopy k="coupon.ended_title" value={t("coupon.ended_title")} as="h1" className="cpn-offer" />
            <EditableCopy k="coupon.ended_sub" value={t("coupon.ended_sub")} as="p" className="cpn-sub" />
            <Link className="cpn-cta" href="/menu">{t("coupon.ended_cta")}</Link>
          </>
        )}
      </div>
    </main>
  );
}
