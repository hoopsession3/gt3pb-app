"use client";

import { useState } from "react";
import Sheet, { CloseButton } from "./Sheet";
import { LEGAL_TITLE, PrivacyText, TermsText, type LegalDoc } from "./legal/LegalText";

// THE TERMS OR THE PRIVACY POLICY, OVER WHAT YOU WERE DOING (2026-10-14, R6). The yes to texts at checkout names both
// (Twilio's review reads the opt-in for them), and a link to /terms left the order behind half filled. Opened here, the
// page's own words (components/legal/LegalText) sit in a sheet over checkout; a link inside swaps to the other page, and
// Close is where it always is.
export default function LegalSheet({ open, onClose }: { open: LegalDoc | null; onClose: () => void }) {
  const [shown, setShown] = useState<LegalDoc | null>(open);
  const [was, setWas] = useState<LegalDoc | null>(open);
  if (open !== was) { setWas(open); setShown(open); }   // a new link tapped from outside: that page
  if (!open || !shown) return null;
  const title = LEGAL_TITLE[shown];
  return (
    <Sheet open onClose={onClose} label={title} className="legal-sheet"
      header={<div className="flex items-center"><b className="text-subhead font-semibold">{title}</b><CloseButton onClick={onClose} /></div>}>
      <div className="legal-wrap pt-0">
        {shown === "terms" ? <TermsText onLink={setShown} /> : <PrivacyText />}
      </div>
    </Sheet>
  );
}
