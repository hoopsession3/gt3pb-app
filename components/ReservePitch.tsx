"use client";

import { useRouter } from "next/navigation";
import { PACK_SIZES, PACK_TAG, packTotal, dollars } from "@/lib/orderAhead";
import { useSiteCopy } from "@/lib/copy";

// Order-ahead, surfaced on the front door — reserve a Saturday drop. One-off pre-order: no
// subscription, no plan, no recurring billing. Replaces the old subscription pitch (dormant).
// Copy is owner-editable (Studio → Brand → Front-end copy).
export default function ReservePitch() {
  const router = useRouter();
  const t = useSiteCopy();
  const go = () => router.push("/reserve");
  return (
    <section className="subpitch">
      <div className="eyb">{t("pitch.kicker")}</div>
      <h2>{t("pitch.headline")}</h2>
      <p>{t("pitch.body")}</p>
      <div className="subpitch-packs">
        {PACK_SIZES.map((s) => (
          <button key={s} type="button" className="subpitch-pack" onClick={go} aria-label={`Reserve ${s} bottles`}>
            {PACK_TAG[s] && <span className="subpitch-tag">{PACK_TAG[s]}</span>}
            <b>{s}</b><span>bottles</span><em>{dollars(packTotal(s, "return"))}</em>
          </button>
        ))}
      </div>
      <button type="button" className="subpitch-cta" onClick={go}>{t("pitch.cta")}</button>
      <div className="subpitch-fine">{t("pitch.fine")}</div>
    </section>
  );
}
