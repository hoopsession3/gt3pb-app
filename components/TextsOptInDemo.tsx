"use client";

import { useState } from "react";
import { TextYesBox } from "./TextYes";

// THE BOX, AS CHECKOUT DRAWS IT (2026-10-14, R6) — on the public texts page (app/texts), for the carriers' reviewers and
// anyone curious: the phone field and the yes under it, the same component checkout uses, live (ticking it records
// nothing — there is no order here). Drawn whether or not texts are switched on yet: the review comes first.
export default function TextsOptInDemo() {
  const [yes, setYes] = useState(false);
  return (
    <div className="mb-4.5 mt-1 grid gap-2.5 rounded-xl border border-line bg-card px-3.5 pb-4 pt-3.5" role="group" aria-label="The yes to texts, as it appears at checkout">
      <span className="font-mono text-caption2 uppercase tracking-[.08em] text-cream-dim">At checkout</span>
      <label className="auth-label">Phone<input className="auth-input" value="(864) 555-0100" readOnly aria-readonly="true" /></label>
      <TextYesBox checked={yes} onChange={setYes} />
    </div>
  );
}
