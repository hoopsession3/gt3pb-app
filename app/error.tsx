"use client";

import { useEffect } from "react";

// Route error boundary — the last line of defense so a runtime error degrades to a calm, on-brand
// recovery screen instead of a white page. Shows the digest (Next's error id) so a failure is
// actually reportable — support can match it to the server log — and offers both a soft retry
// (reset the segment) and a hard reload for the cases reset() can't recover from.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
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
