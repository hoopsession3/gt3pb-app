"use client";

import { useRouter } from "next/navigation";
import AccountPill from "@/components/AccountPill";
import Watermark from "@/components/Watermark";
import Gt3Mark from "@/components/Gt3Mark";
import OrderFunnel from "@/components/OrderFunnel";
import { useSiteCopy } from "@/lib/copy";

// Order-ahead / reserve-your-drop screen. One-off Saturday pre-orders — no subscription, no plan.
// This is also the signed-out storefront's story page: reserve first, then what we make, then the
// walk-up path ("order from the bar" → the menu). Today itself is members-only.
export default function ReserveScreen() {
  const router = useRouter();
  const t = useSiteCopy();
  return (
    <section className="screen" id="s-reserve">
      <Watermark variant="menu" />
      <div className="toprow">
        <div className="mast-brand mast-dark">
          <Gt3Mark tone="cream" />
          <span className="pb">Performance Bar</span>
        </div>
        <AccountPill />
      </div>
      <OrderFunnel initialMode="pickup" />

      <div className="dchapter"><span className="dchn">What We Make</span><span className="dchw">three acts</span></div>
      <div className="dchrule" />
      <div className="pillar"><span className="pdot" style={{ background: "#B8902F" }} /><div className="px"><b>{t("home.pillar1_t")}</b><p>{t("home.pillar1_d")}</p></div></div>
      <div className="pillar"><span className="pdot" style={{ background: "#3f7d6e" }} /><div className="px"><b>{t("home.pillar2_t")}</b><p>{t("home.pillar2_d")}</p></div></div>
      <div className="pillar"><span className="pdot" style={{ background: "#B82420" }} /><div className="px"><b>{t("home.pillar3_t")}</b><p>{t("home.pillar3_d")}</p></div></div>

      <div className="arr-cta">
        <button className="arr-order" onClick={() => router.push("/menu")}>{t("reserve.order_bar")}</button>
        <div className="arr-order-sub">{t("home.cta_sub")}</div>
      </div>

      <div className="signoff">{t("home.signoff")}</div>
    </section>
  );
}
