import { notFound } from "next/navigation";
import { BUSINESS, BUILD_STATS, STATUS_LABEL } from "@/lib/architecture";
import Watermark from "@/components/Watermark";

// Read-only PARTNER share of "what we've built" — capabilities + build footprint only. NO financials
// (revenue/inventory/members stay owner-only on /architecture), no auth, no DB; pure manifest data.
// Unguessable path + noindex; renders only on the exact key. Rotate the link by changing SHARE_KEY.
const SHARE_KEY = "gt3-built-k7m9x4q2";

export const metadata = {
  title: "GT3 Performance Bar — what we've built",
  robots: { index: false, follow: false },
};

export default async function BuiltShare({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (key !== SHARE_KEY) notFound();

  return (
    <section className="screen arch">
      <Watermark variant="share" />
      <div className="toprow"><div className="eyb">GT3PB · Performance Bar</div></div>
      <div className="h-title">What we&apos;ve built</div>
      <div className="h-sub">A complete operating system for the business — customer storefront, every back-of-house workflow, the brand studio, and an AI layer that proposes work for people to approve. Built by a two-person team with an AI build pipeline.</div>

      <div className="prog-build-grid" style={{ marginTop: 18 }}>
        {BUILD_STATS.items.map((s) => (
          <div key={s.l} className="prog-build-card"><span className="prog-build-n">{s.n}</span><span className="prog-build-l">{s.l}</span></div>
        ))}
      </div>

      <div className="arch-biz" style={{ marginTop: 20 }}>
        {BUSINESS.map((b) => (
          <div key={b.id} className="biz-card">
            <div className="biz-head">
              <span className="biz-icon" aria-hidden>{b.icon}</span>
              <span className="biz-name">{b.name}</span>
              <span className={`arch-st st-${b.status}`}>{STATUS_LABEL[b.status]}</span>
            </div>
            <p className="biz-outcome">{b.outcome}</p>
          </div>
        ))}
      </div>

      <div className="prog-foot" style={{ marginTop: 20, paddingBottom: 24 }}>GT3 Performance Bar · what we&apos;ve built, together · {BUILD_STATS.asOf}</div>
    </section>
  );
}
