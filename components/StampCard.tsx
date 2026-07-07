"use client";

import { useAuth } from "@/components/AuthProvider";

// LOYALTY STAMP CARD — every drink earns a stamp; the 10th is on us. Pure view of profiles.points,
// which the server credits on pickup (migration 0012, +1 per drink). No new data, no client writes.
const GOAL = 10;

export default function StampCard() {
  const { profile } = useAuth();
  if (!profile) return null;
  const pts = Math.max(0, profile.points || 0);
  const inCard = pts % GOAL;          // stamps on the current card
  const free = Math.floor(pts / GOAL); // free drinks earned so far
  const toGo = GOAL - inCard;
  const gotFree = inCard === 0 && pts > 0;

  return (
    <section className="stamp" aria-label="Loyalty card">
      <div className="stamp-top">
        <span className="stamp-k">Your card</span>
        <span className="stamp-badge">{free > 0 ? `${free} free earned` : "10th is on us"}</span>
      </div>
      <div className="stamp-grid" role="img" aria-label={`${inCard} of ${GOAL} stamps`}>
        {Array.from({ length: GOAL }).map((_, i) => (
          <span key={i} className={`stamp-dot${i < inCard ? " on" : ""}${i === GOAL - 1 ? " gift" : ""}`}>
            {i === GOAL - 1 ? "★" : i < inCard ? "●" : ""}
          </span>
        ))}
      </div>
      <div className="stamp-foot">
        {gotFree ? "Fresh card — your free cup is waiting." : `${toGo} more ${toGo === 1 ? "drink" : "drinks"} till your next free one.`}
      </div>
    </section>
  );
}
