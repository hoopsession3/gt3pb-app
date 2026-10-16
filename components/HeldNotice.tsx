"use client";

import { useState } from "react";

// A PAYMENT WHOSE ANSWER NEVER CAME, SAID (R8, 2026-10-16). Every page that takes a card holds its order still while the
// answer to a send is unknown — the shop (components/ShopCheckout), a reserve (ReservePay), a pack or a delivery
// (OrderFunnel) and a pack's change (PackChangePay) — and says so here: what is held, what the button does about it, and
// the one way to let it go, Start over, behind a second tap that says what letting go means. One copy, loaded only when
// something is held: the four pages carried the words for a moment few customers ever see.

export default function HeldNotice({ what, line, warning, onStartOver, buttonClass = "oa-paylater" }: {
  /** The bold first words: "Your last payment hasn't been confirmed yet." */
  what: string;
  /** What happens next — tap the button to check on it, or why the button waits. */
  line: string;
  /** Said before Start over is taken: when it is safe, and what it would be if it is not. */
  warning: string;
  /** Let the held key go (useIdemKey forget), by the customer's own choice. */
  onStartOver: () => void;
  /** The page's own quiet button: "oa-paylater" (the funnel, a change) or "co-paylater" (the shop, a reserve). */
  buttonClass?: string;
}) {
  const [letGo, setLetGo] = useState(false);
  return (
    <div className="honest" role="status">
      <b>{what}</b>{" "}{line}
      {letGo ? (
        <>
          <span className="block mt-2">{warning}</span>
          <button type="button" className={buttonClass} onClick={() => { setLetGo(false); onStartOver(); }}><b>Start over</b></button>
          <button type="button" className={buttonClass} onClick={() => setLetGo(false)}>Keep waiting</button>
        </>
      ) : (
        <button type="button" className={buttonClass} onClick={() => setLetGo(true)}>We said it didn&apos;t go through? <b>Start over</b></button>
      )}
    </div>
  );
}
