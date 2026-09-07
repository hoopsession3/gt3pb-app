"use client";

import { useEffect } from "react";
import { reportClientError } from "@/components/ErrorReporter";
import { isDeploySkew, nextSkewAction, readSkewMemory } from "@/lib/deploySkew";

// Route error boundary — the last line of defense so a runtime error degrades to a calm, on-brand
// recovery screen instead of a white page. Shows the digest (Next's error id) so a failure is
// actually reportable — support can match it to the server log — and offers both a soft retry
// (reset the segment) and a hard reload for the cases reset() can't recover from.
// Every boundary hit is also shipped to /api/errors/report as FATAL — a crashed screen in the
// field raises a critical alert in the crew inbox instead of waiting for a complaint.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    reportClientError({ message: `${error.message}${error.digest ? ` [${error.digest}]` : ""}`, stack: error.stack, fatal: true });
    // Deploy-skew self-heal: a tab left open across a deploy holds chunk names from the previous
    // build, so the next lazy import 404s. One hard reload fetches a coherent build.
    //
    // The matching used to be an inline regex here and it missed the real message TWICE — most
    // recently "Failed to load chunk …js?dpl=… from module 74850" on /crew, which slipped past a
    // pattern list that already had "Loading chunk" in it. It lives in lib/deploySkew now, where
    // every phrasing ever seen live is a fixture in the smoke tests.
    if (typeof window !== "undefined" && isDeploySkew(error.message)) {
      let raw: string | null = null;
      try { raw = sessionStorage.getItem("gt3-skew"); } catch { /* private mode */ }
      const { reload, mem } = nextSkewAction(readSkewMemory(raw), Date.now());
      if (reload) {
        try { sessionStorage.setItem("gt3-skew", JSON.stringify(mem)); } catch { /* ignore */ }
        window.location.reload();
      }
    }
  }, [error]);
  const reload = () => { if (typeof window !== "undefined") window.location.reload(); };
  return (
    <section className="screen" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, textAlign: "center", padding: 24 }}>
      <div className="h-title">Something went sideways</div>
      <div className="h-sub" style={{ maxWidth: 340 }}>
        A hiccup on our end — not you. Your work is saved; nothing was lost. Try again, and if it
        keeps happening, send us the code below.
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <button className="act-btn" onClick={reset}>Try again</button>
        <button className="act-btn ghost" onClick={reload}>Reload</button>
      </div>
      {error.digest && (
        <code style={{ marginTop: 10, fontSize: 12, opacity: 0.55, letterSpacing: 0.4 }}>
          ref: {error.digest}
        </code>
      )}
    </section>
  );
}
