"use client";

import { useRouter } from "next/navigation";
import { useSiteCopy } from "@/lib/copy";

// The brand-story close — "What We Make" pillars + a walk-up CTA + sign-off. /reserve had this
// hardcoded; /delivery (the funnel's other deep-link entry point, same OrderFunnel underneath) had
// none of it, so landing on one felt like the finished storefront and the other felt like a bare
// form. Both order-ahead entry points get the same close now.
export default function StorefrontStory() {
  const router = useRouter();
  const t = useSiteCopy();
  return (
    <>
      <div className="dchapter"><span className="dchn">What We Make</span><span className="dchw">three acts</span></div>
      <div className="dchrule" />
      <div className="pillar"><span className="pdot" style={{ background: "#B8902F" }} /><div className="px"><b>{t("home.pillar1_t")}</b><p>{t("home.pillar1_d")}</p></div></div>
      <div className="pillar"><span className="pdot" style={{ background: "#3f7d6e" }} /><div className="px"><b>{t("home.pillar2_t")}</b><p>{t("home.pillar2_d")}</p></div></div>
      <div className="pillar"><span className="pdot" style={{ background: "#B82420" }} /><div className="px"><b>{t("home.pillar3_t")}</b><p>{t("home.pillar3_d")}</p></div></div>

      <button className="craft-link" onClick={() => router.push("/craft")}>Our craft — the how &rarr;</button>

      <div className="arr-cta">
        <button className="arr-order" onClick={() => router.push("/menu")}>{t("reserve.order_bar")}</button>
        <div className="arr-order-sub">{t("home.cta_sub")}</div>
      </div>

      <div className="signoff">{t("home.signoff")}</div>
    </>
  );
}
