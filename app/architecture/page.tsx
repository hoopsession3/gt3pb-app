"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth, roleOf } from "@/components/AuthProvider";
import { ARCHITECTURE, ARCH_OVERVIEW, STATUS_LABEL, sotUrl, type ArchLayer } from "@/lib/architecture";

// System architecture map — owner-only. Manifest-backed (lib/architecture): a high-level overview,
// then tap a layer to drill into its components, then a component to its detail + config + the real
// source-of-truth path in the repo.
export default function ArchitecturePage() {
  const { profile } = useAuth();
  const [open, setOpen] = useState<ArchLayer | null>(null);
  const [comp, setComp] = useState<string | null>(null);

  if (roleOf(profile) !== "owner") {
    return (
      <section className="screen">
        <div className="toprow"><div className="eyb">GT3PB · System</div><Link className="pf" href="/3mpire" aria-label="Back">‹</Link></div>
        <div className="h-title">Owners only</div>
        <div className="h-sub">The system architecture map is restricted to owners.</div>
      </section>
    );
  }

  return (
    <section className="screen arch">
      <div className="toprow"><div className="eyb">GT3PB · System</div><Link className="pf" href="/3mpire" aria-label="Exit">‹</Link></div>

      {!open ? (
        <>
          <div className="h-title">System architecture</div>
          <div className="h-sub">Tap any layer to drill into its components, then a component for its detail, config &amp; source of truth.</div>
          <div className="arch-overview">
            <div className="arch-ov-t">The platform in one breath</div>
            <p className="arch-ov-b">{ARCH_OVERVIEW.summary}</p>
            <div className="arch-flow">{ARCH_OVERVIEW.flow.map((f, i) => <span key={f} className="arch-flow-i">{f}{i < ARCH_OVERVIEW.flow.length - 1 ? <span className="arch-flow-a">→</span> : null}</span>)}</div>
          </div>
          <div className="arch-layers">
            {ARCHITECTURE.map((l) => (
              <button key={l.id} type="button" className="arch-tile" onClick={() => { setOpen(l); setComp(null); }} style={{ ["--c" as string]: l.color }}>
                <div className="arch-tile-h">
                  <span className="arch-tag">{l.tag}</span>
                  <span className="arch-count">{l.components.length}</span>
                </div>
                <div className="arch-tile-l">{l.label}</div>
                <div className="arch-tile-b">{l.blurb}</div>
                <div className="arch-tile-prev">{l.components.slice(0, 4).map((c) => c.name).join(" · ")}{l.components.length > 4 ? " · …" : ""}</div>
                <div className="arch-view">View {l.components.length} components ›</div>
              </button>
            ))}
          </div>
          <a className="arch-sot-all" href={`https://github.com/${"hoopsession3/gt3pb-app"}`} target="_blank" rel="noreferrer">Live source ↗ hoopsession3/gt3pb-app</a>
        </>
      ) : (
        <>
          <button type="button" className="arch-back" onClick={() => setOpen(null)}>‹ All layers</button>
          <div className="arch-layer-head" style={{ ["--c" as string]: open.color }}>
            <span className="arch-tag">{open.tag}</span>
            <div className="h-title" style={{ marginTop: 6 }}>{open.label}</div>
            <div className="h-sub">{open.blurb}</div>
          </div>
          <div className="arch-comps">
            {open.components.map((c) => {
              const x = comp === c.name;
              return (
                <div key={c.name} className={`arch-comp${x ? " open" : ""}`} style={{ ["--c" as string]: open.color }}>
                  <button type="button" className="arch-comp-head" onClick={() => setComp(x ? null : c.name)}>
                    <span className="arch-comp-n">{c.name}</span>
                    <span className={`arch-st st-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                  </button>
                  <div className="arch-comp-d">{c.desc}</div>
                  {x && (
                    <div className="arch-comp-deep">
                      {c.detail && <p className="arch-comp-detail">{c.detail}</p>}
                      {c.config && <div className="arch-comp-cfg"><span className="arch-cfg-l">Config</span> {c.config}</div>}
                      {c.sot && <a className="arch-comp-sot" href={sotUrl(c.sot)} target="_blank" rel="noreferrer">Source of truth ↗ {c.sot}</a>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
