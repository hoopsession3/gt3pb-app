import { notFound } from "next/navigation";
import { BUSINESS, BUILD_STATS, STATUS_LABEL } from "@/lib/architecture";
import Watermark from "@/components/Watermark";
import BuiltBack from "@/components/BuiltBack";

// Read-only PARTNER share of "what we've built" — capabilities + build footprint only. NO financials
// (revenue/inventory/members stay owner-only on /architecture), no auth, no DB; pure manifest data.
// Unguessable path + noindex; renders only on the exact key. Rotate the link by changing SHARE_KEY.
const SHARE_KEY = "gt3-built-k7m9x4q2";

export const metadata = {
  title: "GT3 Performance Bar — what we've built",
  robots: { index: false, follow: false },
};

// Real customer feedback (from the GT3 Brew Feedback collection). Lightly trimmed; attributed by
// first name + last initial. Static here so this page stays DB-free and public-safe.
const REVIEWS: { quote: string; who: string; stars?: number }[] = [
  { quote: "I have epilepsy, and caffeine usually leaves me feeling unwell. Their Dusk blend could be the answer for me — absolutely delicious, and I honestly feel BETTER than usual. Hear me when I say that just doesn't happen.", who: "Daniela S.", stars: 5 },
  { quote: "Shoutout to Ryan for the cold brew — it was soo good! Let us know where and how we can get more.", who: "Neighborhood run group" },
  { quote: "I'm not a coffee drinker, but my wife is and she loved it. Took some to her school — she's a teacher — and they were impressed too.", who: "A regular" },
  { quote: "Light and airy, but it still does the job of what coffee should do — exactly what you want if you're a real coffee drinker.", who: "Early taster" },
  { quote: "I really tasted a difference — the notes were soo subtle.", who: "A regular" },
  { quote: "It was SO good — thank you!", who: "Amanda S." },
];

export default async function BuiltShare({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (key !== SHARE_KEY) notFound();

  return (
    <section className="screen arch">
      <Watermark variant="share" />
      <BuiltBack />
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

      <div className="rev-h" style={{ marginTop: 28 }}>What people are saying</div>
      <div className="rev-grid">
        {REVIEWS.map((r, i) => (
          <figure key={i} className="rev-card">
            {r.stars ? <div className="rev-stars" aria-label={`${r.stars} out of 5`}>{"★".repeat(r.stars)}</div> : null}
            <blockquote className="rev-q">{r.quote}</blockquote>
            <figcaption className="rev-who">— {r.who}</figcaption>
          </figure>
        ))}
      </div>

      <div className="prog-foot" style={{ marginTop: 20, paddingBottom: 24 }}>GT3 Performance Bar · what we&apos;ve built, together · {BUILD_STATS.asOf}</div>
    </section>
  );
}
