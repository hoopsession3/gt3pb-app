"use client";

import { useEffect } from "react";
import { reportClientError } from "@/components/ErrorReporter";

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
    // Deploy-skew self-heal: a tab left open across a deploy can hold a page chunk whose shared
    // module was rebuilt — surfacing as "x is not a function" / chunk-load failures (seen live:
    // mixTotal on /reserve; module factory is not available on /menu). One automatic hard reload
    // fetches a coherent build; the session guard stops loops when the error is real.
    // "module factory is not available" is Turbopack's own wording for the same stale-module-graph
    // problem webpack calls ChunkLoadError — this build runs on Turbopack (next.config.ts), so this
    // is the phrasing that actually shows up in production, not the webpack-era patterns above it.
    const skew = /is not a function|ChunkLoadError|Loading chunk|Importing a module script failed|undefined is not an object \(evaluating|module factory is not available/i.test(error.message ?? "");
    if (skew && typeof window !== "undefined" && !sessionStorage.getItem("gt3-skew-reload")) {
      try { sessionStorage.setItem("gt3-skew-reload", "1"); } catch { /* ignore */ }
      window.location.reload();
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
