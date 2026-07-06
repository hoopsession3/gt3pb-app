"use client";

import { useRouter } from "next/navigation";
import { PACK_SIZES, PACK_TAG, packTotal, dollars } from "@/lib/orderAhead";

// Order-ahead, surfaced on the front door — reserve a Saturday drop. One-off pre-order: no
// subscription, no plan, no recurring billing. Replaces the old subscription pitch (dormant).
export default function ReservePitch() {
  const router = useRouter();
  const go = () => router.push("/reserve");
  return (
    <section className="subpitch">
      <div className="eyb">Order Ahead</div>
      <h2>The bottles you love, brewed to order.</h2>
      <p>Reserve a Saturday drop — 3, 6, or 12 bottles, brewed to order and ready when you reach the window. No plan, no commitment.</p>
      <div className="subpitch-packs">
        {PACK_SIZES.map((s) => (
          <button key={s} type="button" className="subpitch-pack" onClick={go} aria-label={`Reserve ${s} bottles`}>
            {PACK_TAG[s] && <span className="subpitch-tag">{PACK_TAG[s]}</span>}
            <b>{s}</b><span>bottles</span><em>{dollars(packTotal(s, "return"))}</em>
          </button>
        ))}
      </div>
      <button type="button" className="subpitch-cta" onClick={go}>Reserve this week&rsquo;s drop</button>
      <div className="subpitch-fine">Order by Wed 6 PM · pickup Saturday · bring bottles back for the best price.</div>
    </section>
  );
}
