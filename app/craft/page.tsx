"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AccountPill from "@/components/AccountPill";
import EditCopyPill from "@/components/EditCopyPill";
import EditableCopy from "@/components/EditableCopy";
import Watermark from "@/components/Watermark";
import { Masthead, ClosingBeat } from "@/components/kit";
import { useSiteCopy } from "@/lib/copy";
import Button from "@/components/Button";
import Icon from "@/components/Icon";
import Sheet, { CloseButton } from "@/components/Sheet";
import { clickable } from "@/lib/a11y";

// OUR CRAFT — the education page, by purpose. Not just coffee & cocoa: every menu ingredient, grouped
// by what it's FOR — Activation, Hydration, Rebuild/Fuel — in confident, fact-forward GT3 voice ("your
// body runs on the same fuel; here's what's in the cup and what it does"). Bold, but factual: we state
// composition + generally-recognized, sourced nutrition properties and NEVER cross into disease/cure/
// detox/allergen-safety claims. EVERY line is owner-editable via site_copy (useSiteCopy) — most now
// inline on this page (2026-07-17); the ingredient blocks and both CTAs stay Settings-only, see the
// comments below for why. The caffeine molecule is factual chemistry.
//
// ONE LINE AN INGREDIENT (2026-10-09, round 2 — Ryan: "Craft lines", approved). The page put 554 words
// between its opening and its only button, four and a half screens down: every ingredient's whole story,
// in full, one after another, under a philosophy band that said the lede again. Each ingredient is one line
// now — its name, and the drink it is in — that opens its whole story in a sheet; the band went; and the
// menu is one button under the opening as well as at the close.

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
  const [story, setStory] = useState<{ n: string; d: string } | null>(null);

  const Pillar = ({ k }: { k: "act" | "hyd" | "reb" }) => (
    <div className="craft-sec">
      <EditableCopy k={`craft.${k}_label`} value={t(`craft.${k}_label`)} as="span" className="craft-sec-n" />
      <EditableCopy k={`craft.${k}_title`} value={t(`craft.${k}_title`)} as="h2" className="craft-sec-h" />
      <EditableCopy k={`craft.${k}_intro`} value={t(`craft.${k}_intro`)} as="p" className="craft-body" multiline />
      {/* Ingredient list stays Settings-only: ings() parses one raw "Name — fact" per line block into
          a styled bullet list, and EditableCopy can only show a flat string at rest — its non-edit
          render is exactly what a bare {t(...)} would show, so wrapping this would replace the
          formatted list with raw "Name — fact\nName — fact" text for EVERY visitor, not just owners.
          Still editable, as one block, via Settings › Business › Brand & customer app. */}
      <ul className="craft-ings">
        {ings(t(`craft.${k}_items`)).map((it, i) => (
          <li key={i}>
            <div className="craft-ing min-h-11 cursor-pointer" {...clickable(() => setStory(it))} aria-haspopup="dialog">
              <span className="craft-ing-dot" aria-hidden />
              <div className="craft-ing-x flex-1 min-w-0"><b>{it.n || it.d}</b></div>
              <Icon name="chevronRight" className="text-cream-muted" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <section className="screen craft" id="s-craft">
      <Watermark variant="landing" />
      <Masthead eyebrow={<EditableCopy k="craft.eye" value={t("craft.eye")} />} right={<div className="mast-right"><EditCopyPill group="Craft page" /><AccountPill /></div>} />

      {/* HERO — art & chemistry, the molecule */}
      <header className="craft-hero">
        <h1 className="craft-h1">
          <EditableCopy k="craft.h1_l1" value={t("craft.h1_l1")} /> <i><EditableCopy k="craft.h1_em1" value={t("craft.h1_em1")} /></i><br />
          <EditableCopy k="craft.h1_l2" value={t("craft.h1_l2")} /> <i><EditableCopy k="craft.h1_em2" value={t("craft.h1_em2")} /></i>
        </h1>
        <EditableCopy k="craft.lede" value={t("craft.lede")} as="p" className="craft-lede" multiline />
        <div className="craft-mol">
          <img src="/brand/caffeine-gt3.svg" alt="The caffeine molecule — a purine ring with three methyl groups, the three 3s of GT3" />
          <EditableCopy k="craft.mol_cap" value={t("craft.mol_cap")} as="span" className="craft-mol-cap" />
        </div>
      </header>

      {/* The menu, under the opening — the page's one action, a screen in instead of four and a half. */}
      <div className="flex justify-center mt-6">
        <Button kind="primary" onClick={() => router.push("/menu")}>{t("craft.cta_menu")}</Button>
      </div>

      {/* THE THREE PILLARS — every ingredient, by purpose */}
      <Pillar k="act" />
      <Pillar k="hyd" />
      <Pillar k="reb" />

      {/* THE MARK (the molecule = GT3) */}
      <div className="craft-sec">
        <EditableCopy k="craft.mark_label" value={t("craft.mark_label")} as="span" className="craft-sec-n" />
        <EditableCopy k="craft.mark_title" value={t("craft.mark_title")} as="h2" className="craft-sec-h" />
        <EditableCopy k="craft.mark_body" value={t("craft.mark_body")} as="p" className="craft-body" multiline />
      </div>

      {/* CLOSE */}
      <div className="craft-close">
        <EditableCopy k="craft.close_line" value={t("craft.close_line")} as="p" className="craft-close-line" />
        <div className="craft-cta">
          {/* CTA text stays plain — inside real <button>s, same nested-interactive rule as the menu
              chips, ReservePitch's CTA, and StorefrontStory's "Order from the bar" button. Still
              editable via Settings › Business › Brand & customer app. */}
          <Button kind="primary" onClick={() => router.push("/menu")}>{t("craft.cta_menu")}</Button>
          <Button kind="secondary" onClick={() => router.push("/reserve")}>{t("craft.cta_reserve")}</Button>
        </div>
      </div>

      <EditableCopy k="craft.signoff" value={t("craft.signoff")} as="div" className="signoff" />
      <ClosingBeat />

      {/* An ingredient's whole story, one tap from its line. */}
      {story && (
        <Sheet open onClose={() => setStory(null)} label={story.n || "Ingredient"} className="paper"
          header={<div className="flex items-center"><b className="text-subhead font-semibold">{story.n || "Ingredient"}</b><CloseButton onClick={() => setStory(null)} /></div>}>
          <p className="dl-sub">{story.d}</p>
        </Sheet>
      )}
    </section>
  );
}
