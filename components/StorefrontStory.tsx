"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { SectionHeader } from "@/components/kit";
import { useSiteCopy } from "@/lib/copy";
import Icon from "@/components/Icon";

// The brand-story close — "What We Make" pillars + a walk-up CTA + sign-off, on the kit.
// PLACEMENT IS AUDIENCE-SCOPED, not page-scoped (Ryan's de-dup question, answered with the
// data): this block renders on the two order-ahead entry doors (/reserve and /delivery),
// which double as landing pages for first-time visitors from links. A GUEST landing there
// needs the story — it's the storefront's pitch. A signed-in MEMBER re-reading "what we
// make" on every visit is noise that pushes the actual order form down a screen — so for
// members the story steps aside. One component, one rule, no duplication.
export default function StorefrontStory() {
  const router = useRouter();
  const { user } = useAuth();
  const t = useSiteCopy();
  if (user) return null;
  return (
    <>
      <SectionHeader label="What We Make" annotation="three acts" />
      <div className="pillar"><span className="pdot" style={{ background: "#B8902F" }} /><div className="px"><b>{t("home.pillar1_t")}</b><p>{t("home.pillar1_d")}</p></div></div>
      <div className="pillar"><span className="pdot" style={{ background: "#3f7d6e" }} /><div className="px"><b>{t("home.pillar2_t")}</b><p>{t("home.pillar2_d")}</p></div></div>
      <div className="pillar"><span className="pdot" style={{ background: "#B82420" }} /><div className="px"><b>{t("home.pillar3_t")}</b><p>{t("home.pillar3_d")}</p></div></div>

      <button className="btn-ter" onClick={() => router.push("/craft")}>Our craft — the how <b><Icon name="arrowRight" /></b></button>

      <div className="arr-cta">
        <button className="arr-order" onClick={() => router.push("/menu")}>{t("reserve.order_bar")}</button>
        <div className="arr-order-sub">{t("home.cta_sub")}</div>
      </div>

      <div className="signoff">{t("home.signoff")}</div>
    </>
  );
}
