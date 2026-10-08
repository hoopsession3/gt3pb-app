"use client";

import { useState } from "react";
import Sheet, { CloseButton } from "@/components/Sheet";
import { ConciergeChat } from "./Concierge";
import { ConnectBody } from "./ConnectHub";
import { DisplayControls } from "./DisplayToggle";
import type { Asked } from "@/lib/helpSheets";

// ASK US, CONNECT AND DISPLAY, AS SHEETS (2026-10-08, the iPhone chrome round, approved). On a phone the floating
// rail is gone (components/FloatRail): Ask us is the button beside the account avatar, and Connect and Display are
// rows in the account menu (components/AccountSheet) and in the crew's More (components/OperatorNav). Each says which
// sheet with an event (lib/helpSheets); the shell loads this on the first ask and hands it the ask. In the frame
// (desktop, iPad) the rail still opens its own. The same bodies either way — ConciergeChat, ConnectBody and
// DisplayControls — so nothing is written twice. The concierge stays mounted once asked for, closed, so a second
// "Ask us" comes back to the same conversation.
export default function HelpSheets({ asked }: { asked: Asked }) {
  const [closed, setClosed] = useState(0);
  const open = asked.n !== closed ? asked.which : null;
  const close = () => setClosed(asked.n);
  return (
    <>
      <ConciergeChat open={open === "gt3-open-concierge"} onClose={close} />
      {open === "gt3-open-display" && (
        <Sheet open onClose={close} label="Display and text size"
          header={<div className="flex items-center"><span className="isheet-title">Display &amp; text size</span><CloseButton onClick={close} className="isheet-x ml-auto" /></div>}>
          <DisplayControls />
        </Sheet>
      )}
      {open === "gt3-open-connect" && (
        // The links are drawn for the rail's dark card in either look, so this sheet keeps the dark ground in the
        // crew's Day look too: --bg unset falls back to the sheet's own charcoal, and the words take the brand's
        // cream — the values :root gives them, restated where Day mode would turn them dark.
        <Sheet open onClose={close} label="Connect with GT3" className="[--bg:initial] [--cream:var(--brand-cream)] [--cream-m:color-mix(in_srgb,var(--brand-cream)_72%,transparent)]"
          header={<div className="flex items-center"><span className="isheet-title">Connect with GT3</span><CloseButton onClick={close} className="isheet-x ml-auto" /></div>}>
          <ConnectBody onGo={close} />
        </Sheet>
      )}
    </>
  );
}
