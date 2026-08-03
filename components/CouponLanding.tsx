"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trackFunnel } from "@/lib/funnel";
import Watermark from "@/components/Watermark";

// COUPON LANDING (0268) — where a printed QR points. The scan COUNTS ITSELF (funnel_events, the
// same zero-PII spine every storefront funnel uses), then the page routes by what the code IS in
// the engine: an order-repricing code walks straight into the pack flow with the code pre-applied;
// the free-pour-on-return card explains the Loop hand-off (its redemption is a bottle coming back,
// logged crew-side, not a checkout event). Codes are DATA — rename, retire, or re-offer in Money ›
// Codes and this page follows with zero deploys. The printed QR never goes stale.

type Cpn = { ok: boolean; code?: string; kind?: string; label?: string; active?: boolean };

export default function CouponLanding({ code }: { code: string }) {
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
                <p className="cpn-sub">Your code is in — it applies itself at checkout.</p>
                <Link className="cpn-cta" href={`/reserve?code=${encodeURIComponent(cpn.code ?? code)}`}>Order your bottles →</Link>
                <div className="cpn-code">code <b>{cpn.code}</b></div>
              </>
            ) : (
              <>
                <p className="cpn-sub">Bring your empty GT3 bottle back to any pop-up or pickup — show this screen, get your pour, and the bottle goes back into the Loop.</p>
                <Link className="cpn-cta" href="/menu">See what&apos;s pouring →</Link>
              </>
            )}
          </>
        ) : (
          <>
            <h1 className="cpn-offer">That offer has wrapped</h1>
            <p className="cpn-sub">This card&apos;s run has ended — but the good stuff hasn&apos;t.</p>
            <Link className="cpn-cta" href="/menu">See the menu →</Link>
          </>
        )}
      </div>
    </main>
  );
}
