"use client";

import { useEffect } from "react";
import { recoverFromCrash } from "@/components/ErrorReporter";

// Route error boundary — the last line of defense so a runtime error degrades to a calm, on-brand
// recovery screen instead of a white page. Shows the digest (Next's error id) so a failure is
// actually reportable — support can match it to the server log — and offers both a soft retry
// (reset the segment) and a hard reload for the cases reset() can't recover from.
//
// WHAT THE REPORT SAYS IS DECIDED BEFORE IT IS SENT. This used to report every boundary hit as
// FATAL and check for deploy skew afterwards, in that order. So a tab that healed itself perfectly
// — reloaded, showed the crew nothing, lost no work — still raised "Critical — App error — a
// screen crashed" in the owners' inbox, once per deploy, forever. Ryan got one at 8:30 PM on
// 2026-09-06 for a screen that had already fixed itself before he could open the link. A critical
// channel that cries wolf on a non-event is worse than no channel.
//
// Now the crash is classified first: skew about to heal is an FYI, skew that has run out of
// attempts is fatal (the reload did NOT fix it, so it was never skew), and everything else is fatal
// as before. The decision is a pure function in lib/deploySkew so it is unit-tested.
// TRY AGAIN READS AGAIN (R11, 2026-10-16). reset() re-drew the children the boundary already had, so a screen whose read
// had failed threw the same error straight back; retry() fetches the segment again first, which is what "Try again" says.
// reset() stays the fallback for a Next without it. R31: Next 16.2 called it `unstable_retry`; 16.3 made it `retry` and
// 16.4 gives only that — after R30's upgrade this screen fell back to reset() and drew the same error again.
export default function Error({ error, reset, retry }: { error: Error & { digest?: string }; reset: () => void; retry?: () => void }) {
  useEffect(() => {
    console.error(error);

    // Deploy-skew self-heal: a tab left open across a deploy holds chunk names from the previous
    // build, so the next lazy import 404s. One hard reload fetches a coherent build.
    //
    // The matching used to be an inline regex here and it missed the real message TWICE — most
    // recently "Failed to load chunk …js?dpl=… from module 74850" on /crew, which slipped past a
    // pattern list that already had "Loading chunk" in it. It lives in lib/deploySkew now, where
    // every phrasing ever seen live is a fixture in the smoke tests; the classify → report → heal
    // order is components/ErrorReporter's recoverFromCrash, shared with app/global-error.tsx.
    recoverFromCrash(error);
  }, [error]);
  const reload = () => { if (typeof window !== "undefined") window.location.reload(); };
  const again = () => (retry ?? reset)();
  return (
    <section className="screen" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, textAlign: "center", padding: 24 }}>
      <div className="h-title">Something went sideways</div>
      {/* It promised "your work is saved; nothing was lost" — not so for words typed and not sent — and pointed at "the
          code below" on a crash that had none (a crash in the browser carries no digest). It says what it knows (R11). */}
      <div className="h-sub" style={{ maxWidth: 340 }}>
        A hiccup on our end — not you. Try again, and if it keeps happening, {error.digest ? "send us the code below" : "let us know"}.
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        {/* the kit's (2026-10-09): .act-btn was styled nowhere, so the screen a crash lands on drew the browser's grey buttons */}
        <button type="button" className="btn-pri" onClick={again}>Try again</button>
        <button type="button" className="btn-sec" onClick={reload}>Reload</button>
      </div>
      {error.digest && (
        <code style={{ marginTop: 10, fontSize: 12, opacity: 0.55, letterSpacing: 0.4 }}>
          ref: {error.digest}
        </code>
      )}
    </section>
  );
}
