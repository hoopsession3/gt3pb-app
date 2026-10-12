"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import Gt3Mark from "@/components/Gt3Mark";
import MemberCard from "@/components/MemberCard";
import { clickable } from "@/lib/a11y";
import { fillCopy, useSiteCopy } from "@/lib/copy";
import Icon from "@/components/Icon";
import { cardOf, STAMP_GOAL } from "@/lib/loyalty";

// LOYALTY STAMP CARD — every drink earns a stamp; ten earn a free cup. Pure view of profiles.points,
// which the server credits on pickup (migration 0012, +1 per drink). No new data, no client writes.
// Wears the shared GT3 card frame (gold ground + machined hairline + brand mark) so it reads as one
// family with the membership card and the status card. Tapping it opens the member's own card
// (StatusCard) — the loyalty card IS the door to "your card."
//
// Copy (stamp.*, group "Loyalty card") is owner-editable but Settings-only, not inline-click-
// editable — see the comment on that group in lib/copy.ts: the WHOLE card below is one tap target,
// so an inline EditableCopy anywhere inside it would nest a second interactive control inside the
// section's own role="button". Reach it via the Edit pill on the Today masthead instead.
export default function StampCard() {
  const { profile } = useAuth();
  const t = useSiteCopy();
  const [cardOpen, setCardOpen] = useState(false);
  if (!profile) return null;
  // lib/loyalty's card (C6): stamps on the card now, and free cups READY — one given at the window is gone (0387).
  const { stamps: inCard, free, toNext: toGo } = cardOf(profile.points);
  const GOAL = STAMP_GOAL;
  const gotFree = inCard === 0 && free > 0; // a full card, nothing on the next one yet
  const near = !gotFree && toGo <= 2;

  // free===1 vs 2+ get their own copy key (proper singular/plural, not a baked-in word swap) —
  // toGo, below, never needs the same split: the "near" branch only ever sees toGo 1 or 2 and its
  // line has no plural noun in it, and the default "progress" branch only ever sees toGo 3+ (near
  // catches 1-2, gotFree catches the toGo===GOAL "card full" case) so "drinks" there is always
  // correct — a singular form would be genuinely unreachable, not just untested.
  const badge = gotFree
    ? t("stamp.badge_full")
    : free > 0
      ? fillCopy(t(free === 1 ? "stamp.badge_earned_one" : "stamp.badge_earned_other"), { count: String(free) })
      : t("stamp.badge_default");
  const foot = gotFree
    ? t("stamp.foot_full")
    : near
      ? fillCopy(t("stamp.foot_near"), { count: String(toGo) })
      : fillCopy(t("stamp.foot_progress"), { count: String(toGo) });

  return (
    <>
      <section
        className={`stamp tappable${gotFree ? " won" : near ? " near" : ""}`}
        aria-label="Your loyalty card — open your member card"
        {...clickable(() => setCardOpen(true))}
      >
        <div className="stamp-top">
          <span className="stamp-brand"><Gt3Mark tone="cream" /><span className="stamp-k">{t("stamp.kicker")}</span></span>
          <span className="k-tag gold fill">{badge}</span>
        </div>
        <div className="stamp-grid" role="img" aria-label={`${inCard} of ${GOAL} stamps`}>
          {Array.from({ length: GOAL }).map((_, i) => (
            <span key={i} className={`stamp-dot${i < inCard ? " on" : ""}${i === GOAL - 1 ? " gift" : ""}`}>
              {i === GOAL - 1 ? <Icon name="star" /> : i < inCard ? <Icon name="dot" /> : ""}
            </span>
          ))}
        </div>
        <div className="stamp-foot">
          <span>{foot}</span>
          <span className="stamp-open" aria-hidden="true">{t("stamp.open_cta")}</span>
        </div>
      </section>
      <MemberCard open={cardOpen} onClose={() => setCardOpen(false)} />
    </>
  );
}
