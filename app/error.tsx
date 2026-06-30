"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <section className="screen" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
      <div className="h-title">Something went wrong</div>
      <div className="h-sub">An unexpected error occurred. Try refreshing or tap below to retry.</div>
      <button className="act-btn" onClick={reset} style={{ marginTop: 8 }}>Try again</button>
    </section>
  );
}
