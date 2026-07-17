"use client";

import { useRouter } from "next/navigation";
import { PACK_SIZES, PACK_TAG, packTotal, dollars } from "@/lib/orderAhead";
import { useSiteCopy } from "@/lib/copy";
import EditableCopy from "@/components/EditableCopy";

// Order-ahead, surfaced on the front door — reserve a Saturday drop. One-off pre-order: no
// subscription, no plan, no recurring billing. Replaces the old subscription pitch (dormant).
// Copy is owner-editable (Studio → Brand → Front-end copy).
export default function ReservePitch() {
  const router = useRouter();
  const t = useSiteCopy();
  const go = () => router.push("/reserve");
  return (
    <section className="subpitch">
      <EditableCopy k="pitch.kicker" value={t("pitch.kicker")} as="div" className="eyb" />
      <EditableCopy k="pitch.headline" value={t("pitch.headline")} as="h2" />
      <EditableCopy k="pitch.body" value={t("pitch.body")} as="p" multiline />
      <div className="subpitch-packs">
        {PACK_SIZES.map((s) => (
          <button key={s} type="button" className="subpitch-pack" onClick={go} aria-label={`Reserve ${s} bottles`}>
            {PACK_TAG[s] && <span className="subpitch-tag">{PACK_TAG[s]}</span>}
            <b>{s}</b><span>bottles</span><em>{dollars(packTotal(s, "return"))}</em>
          </button>
        ))}
      </div>
      {/* CTA text stays plain — it's inside a real <button>, and EditableCopy's edit affordance is
          itself a role="button" element; nesting the two is both an interaction conflict (which
          click wins?) and invalid/ARIA-unfriendly markup. Same call already made for the menu
          category chips and the per-drink list rows. Still editable via Settings → Front-end copy. */}
      <button type="button" className="subpitch-cta" onClick={go}>{t("pitch.cta")}</button>
      <EditableCopy k="pitch.fine" value={t("pitch.fine")} as="div" className="subpitch-fine" multiline />
    </section>
  );
}
