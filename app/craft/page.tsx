"use client";

import { useRouter } from "next/navigation";
import AccountPill from "@/components/AccountPill";
import Watermark from "@/components/Watermark";
import Gt3Mark from "@/components/Gt3Mark";
import { useSiteCopy } from "@/lib/copy";

// OUR CRAFT — the education page, by purpose. Not just coffee & cocoa: every menu ingredient, grouped
// by what it's FOR — Activation, Hydration, Rebuild/Fuel — in confident, fact-forward GT3 voice ("your
// body runs on the same fuel; here's what's in the cup and what it does"). Bold, but factual: we state
// composition + generally-recognized, sourced nutrition properties and NEVER cross into disease/cure/
// detox/allergen-safety claims. EVERY line is owner-editable via site_copy (useSiteCopy). Ingredient
// blocks are one "Name — fact" per line, edited as a block. The caffeine molecule is factual chemistry.

// Split a "Name — fact\nName — fact" block into rows (em-dash separates name from its line).
function ings(block: string): { n: string; d: string }[] {
  return block.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(" — ");
    return i > 0 ? { n: l.slice(0, i), d: l.slice(i + 3) } : { n: "", d: l };
  });
}

export default function CraftScreen() {
  const router = useRouter();
  const t = useSiteCopy();

  const Pillar = ({ k }: { k: "act" | "hyd" | "reb" }) => (
    <div className="craft-sec">
      <span className="craft-sec-n">{t(`craft.${k}_label`)}</span>
      <h2 className="craft-sec-h">{t(`craft.${k}_title`)}</h2>
      <p className="craft-body">{t(`craft.${k}_intro`)}</p>
      <ul className="craft-ings">
        {ings(t(`craft.${k}_items`)).map((it, i) => (
          <li key={i} className="craft-ing">
            <span className="craft-ing-dot" aria-hidden />
            <div className="craft-ing-x">{it.n && <b>{it.n}</b>}<p>{it.d}</p></div>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <section className="screen craft" id="s-craft">
      <Watermark variant="landing" />
      <div className="toprow">
        <div className="mast-brand mast-dark">
          <Gt3Mark tone="cream" />
          <span className="pb">Performance Bar</span>
        </div>
        <AccountPill />
      </div>

      {/* HERO — art & chemistry, the molecule */}
      <header className="craft-hero">
        <span className="craft-eye">{t("craft.eye")}</span>
        <h1 className="craft-h1">{t("craft.h1_l1")} <i>{t("craft.h1_em1")}</i><br />{t("craft.h1_l2")} <i>{t("craft.h1_em2")}</i></h1>
        <p className="craft-lede">{t("craft.lede")}</p>
        <div className="craft-mol">
          <img src="/brand/caffeine-gt3.svg" alt="The caffeine molecule — a purine ring with three methyl groups, the three 3s of GT3" />
          <span className="craft-mol-cap">{t("craft.mol_cap")}</span>
        </div>
      </header>

      {/* PHILOSOPHY — the same fuel */}
      <p className="craft-fuel">{t("craft.fuel")}</p>

      {/* THE THREE PILLARS — every ingredient, by purpose */}
      <Pillar k="act" />
      <Pillar k="hyd" />
      <Pillar k="reb" />

      {/* THE MARK (the molecule = GT3) */}
      <div className="craft-sec">
        <span className="craft-sec-n">{t("craft.mark_label")}</span>
        <h2 className="craft-sec-h">{t("craft.mark_title")}</h2>
        <p className="craft-body">{t("craft.mark_body")}</p>
      </div>

      {/* CLOSE */}
      <div className="craft-close">
        <p className="craft-close-line">{t("craft.close_line")}</p>
        <div className="craft-cta">
          <button className="craft-cta-b" onClick={() => router.push("/menu")}>{t("craft.cta_menu")}</button>
          <button className="craft-cta-b ghost" onClick={() => router.push("/reserve")}>{t("craft.cta_reserve")}</button>
        </div>
      </div>

      <div className="signoff">{t("craft.signoff")}</div>
    </section>
  );
}
