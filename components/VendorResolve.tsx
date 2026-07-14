"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Sheet from "@/components/Sheet";
import type { VendorMatch } from "@/lib/vendorLink";

// THE look-alike confirm sheet (0226) — one component, every create path. When a typed vendor name
// is ≥40% similar to one already in the book, the DB refuses to mint it silently; this sheet is
// where the human decides. Three honest answers:
//   · "Use this vendor"        → same partner, link it (the Wine Xpress case)
//   · "Add as a location"      → same partner, different site (Wine Express gains "Downtown")
//   · "Create as new vendor"   → genuinely distinct; re-submits with the explicit confirm flag
// Canonical <Sheet> per the popout contract — PORTALED to <body>: two mounts (EventCopilot, the
// calendar quick-add) live inside another Sheet, whose `will-change:transform` panel would clip a
// nested fixed overlay (panel finding). Escape is handled here in the CAPTURE phase so it closes
// ONLY this sheet — the parent Sheet's window listener (bubble) never sees it, and a typed draft
// underneath survives.
export default function VendorResolve({
  name, candidates, busy, onUse, onAddLocation, onCreateDistinct, onSkip, onClose,
}: {
  name: string;
  candidates: VendorMatch[];
  busy?: boolean;
  onUse: (c: VendorMatch) => void;
  onAddLocation?: (c: VendorMatch) => void;   // omit where a location makes no sense (e.g. pipeline accounts)
  onCreateDistinct: () => void;
  onSkip?: () => void;                        // quick-add paths: proceed with no vendor at all
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  if (!mounted) return null;
  const pct = (s: number) => `${Math.round(s * 100)}%`;
  return createPortal(
    <Sheet open onClose={onClose} label="Possible duplicate vendor"
      header={<div style={{ display: "flex", alignItems: "center" }}>Already in the book?<span style={{ marginLeft: "auto" }} /><button type="button" className="qd-x" onClick={onClose} aria-label="Cancel">✕</button></div>}>
      <div className="pnl-note" style={{ marginBottom: 10 }}>
        “<b>{name}</b>” looks like {candidates.length === 1 ? "a vendor that already exists" : "vendors that already exist"}. One partner, one record — link it, or add a new location under it.
      </div>
      <div className="vres-list">
        {candidates.map((c) => (
          <div className="vres-row" key={c.id}>
            <div className="vres-main">
              <b>{c.name}</b>
              <span>{pct(c.sim)} match{c.status === "pending" ? " · pending approval" : ""}</span>
            </div>
            <div className="vres-acts">
              <button type="button" className="adm-btn primary" disabled={busy} onClick={() => onUse(c)}>Use this vendor</button>
              {onAddLocation && (
                <button type="button" className="adm-btn" disabled={busy} onClick={() => onAddLocation(c)}>+ Add “{name}” as its location</button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="vres-foot">
        <button type="button" className="adm-btn ghost" disabled={busy} onClick={onCreateDistinct}>
          No — create “{name}” as a new vendor
        </button>
        {onSkip && <button type="button" className="ev-arch-btn" disabled={busy} onClick={onSkip}>Skip — no vendor</button>}
      </div>
    </Sheet>,
    document.body,
  );
}
