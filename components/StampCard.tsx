"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import Gt3Mark from "@/components/Gt3Mark";
import StatusCard from "@/components/StatusCard";
import { clickable } from "@/lib/a11y";

// LOYALTY STAMP CARD — every drink earns a stamp; the 10th is on us. Pure view of profiles.points,
// which the server credits on pickup (migration 0012, +1 per drink). No new data, no client writes.
// Wears the shared GT3 card frame (gold ground + machined hairline + brand mark) so it reads as one
// family with the membership card and the status card. Tapping it opens the member's own card
// (StatusCard) — the loyalty card IS the door to "your card."
const GOAL = 10;

export default function StampCard() {
  const { profile } = useAuth();
  const [cardOpen, setCardOpen] = useState(false);
  if (!profile) return null;
  const pts = Math.max(0, profile.points || 0);
  const inCard = pts % GOAL;          // stamps on the current card
  const free = Math.floor(pts / GOAL); // free drinks earned so far
  const toGo = GOAL - inCard;
  const gotFree = inCard === 0 && pts > 0; // just completed a card
  const near = !gotFree && toGo <= 2;

  return (
    <>
      <section
        className={`stamp tappable${gotFree ? " won" : near ? " near" : ""}`}
        aria-label="Your loyalty card — open your member card"
        {...clickable(() => setCardOpen(true))}
      >
        <div className="stamp-top">
          <span className="stamp-brand"><Gt3Mark tone="cream" /><span className="stamp-k">Your card</span></span>
          <span className="stamp-badge">{gotFree ? "🎉 Card full" : free > 0 ? `${free} free ${free === 1 ? "drink" : "drinks"} earned` : "10th is on us"}</span>
        </div>
        <div className="stamp-grid" role="img" aria-label={`${inCard} of ${GOAL} stamps`}>
          {Array.from({ length: GOAL }).map((_, i) => (
            <span key={i} className={`stamp-dot${i < inCard ? " on" : ""}${i === GOAL - 1 ? " gift" : ""}`}>
              {i === GOAL - 1 ? "★" : i < inCard ? "●" : ""}
            </span>
          ))}
        </div>
        <div className="stamp-foot">
          <span>
            {gotFree ? "Your 10th is on us — mention it at the window."
              : near ? `So close — just ${toGo} more till a free cup.`
              : `${toGo} more ${toGo === 1 ? "drink" : "drinks"} till your next free one.`}
          </span>
          <span className="stamp-open" aria-hidden="true">Open your card ›</span>
        </div>
      </section>
      <StatusCard open={cardOpen} onClose={() => setCardOpen(false)} />
    </>
  );
}
