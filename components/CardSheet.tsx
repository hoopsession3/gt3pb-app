"use client";

import Sheet from "@/components/Sheet";
import Icon from "@/components/Icon";
import Gt3Mark from "@/components/Gt3Mark";
import MembershipCard from "@/components/MembershipCard";

// SHOW CARD (2026-10-12, A2 of the account audit; the owner approved the mockups). There were two "member cards": the
// account menu's opened the status card — the one that spins, takes your photo and shares — which can't be scanned,
// and the scannable one lived only on /3mpire. The menu's quick action opens the scannable card now, at the window in
// one tap; its photo and finish are inside it ("Show off your status"). Loaded by the tap that opens it, like the
// menu itself (components/AccountPill).
export default function CardSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} label="Your member card" className="acs-sheet"
      header={
        <div className="acs-head">
          <span className="acs-head-t"><Gt3Mark tone="cream" /> Your card</span>
          <button type="button" className="isheet-x" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
      }>
      <MembershipCard />
    </Sheet>
  );
}
