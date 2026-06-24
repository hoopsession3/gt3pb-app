"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth, roleOf } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabase";
import { ARCHITECTURE, ARCH_OVERVIEW, STATUS_LABEL, sotUrl, type ArchLayer, type ArchComponent, type ArchStatus } from "@/lib/architecture";

// Owner-only system architecture map. High level → layer → component. Manifest-backed, with LIVE
// status pulled from /api/architecture/status (env presence + table existence), and search across
// every layer.

// component name → live-status key (matches the status route)
const LIVE_KEY: Record<string, string> = {
  "Anthropic client": "anthropic", "ANTHROPIC_API_KEY": "anthropic", "Canva Connect": "canva",
  "Webflow Data API": "webflow", "Square": "square", "Supabase Postgres": "supabase",
  "Studio": "studio", "Brand Kit": "brandkit", "Brand assets": "brandassets",
  "Compliance rules": "compliance", "Meeting Notes": "notes", "Alerts spine": "alerts",
  "Audit log": "audit", "Inventory & Assets": "inventory", "Events & Prep": "events",
};

export default function ArchitecturePage() {
  const { profile } = useAuth();
  const [open, setOpen] = useState<ArchLayer | null>(null);
  const [comp, setComp] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [live, setLive] = useState<Record<string, ArchStatus> | null>(null);

  const isOwner = roleOf(profile) === "owner";
  useEffect(() => {
    if (!isOwner || !supabase) return;
    (async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/architecture/status", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const j = await r.json();
      if (j.ok) setLive(j.status);
    })().catch(() => {});
  }, [isOwner]);

  const statusOf = (c: ArchComponent): ArchStatus => (live && LIVE_KEY[c.name] && live[LIVE_KEY[c.name]]) || c.status;

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return ARCHITECTURE.flatMap((l) => l.components.map((c) => ({ c, l })))
      .filter(({ c }) => c.name.toLowerCase().includes(s) || c.desc.toLowerCase().includes(s) || (c.detail || "").toLowerCase().includes(s) || (c.config || "").toLowerCase().includes(s));
  }, [q]);

  if (!isOwner) {
    return (
      <section className="screen">
        <div className="toprow"><div className="eyb">GT3PB · System</div><Link className="pf" href="/3mpire" aria-label="Back">‹</Link></div>
        <div className="h-title">Owners only</div>
        <div className="h-sub">The system architecture map is restricted to owners.</div>
      </section>
    );
  }

  const Comp = ({ c, color, layerTag }: { c: ArchComponent; color: string; layerTag?: string }) => {
    const x = comp === c.name;
    const st = statusOf(c);
    return (
      <div className={`arch-comp${x ? " open" : ""}`} style={{ ["--c" as string]: color }}>
        <button type="button" className="arch-comp-head" onClick={() => setComp(x ? null : c.name)}>
          <span className="arch-comp-n">{layerTag && <span className="arch-comp-layer">{layerTag}</span>}{c.name}</span>
          <span className={`arch-st st-${st}`}>{STATUS_LABEL[st]}{live && LIVE_KEY[c.name] ? " ·" : ""}</span>
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
  };

  return (
    <section className="screen arch">
      <div className="toprow"><div className="eyb">GT3PB · System{live && <span className="arch-livedot" title="Live status loaded" />}</div><Link className="pf" href="/3mpire" aria-label="Exit">‹</Link></div>

      {open ? (
        <>
          <button type="button" className="arch-back" onClick={() => { setOpen(null); setComp(null); }}>‹ All layers</button>
          <div className="arch-layer-head" style={{ ["--c" as string]: open.color }}>
            <span className="arch-tag">{open.tag}</span>
            <div className="h-title" style={{ marginTop: 6 }}>{open.label}</div>
            <div className="h-sub">{open.blurb}</div>
          </div>
          <div className="arch-comps">{open.components.map((c) => <Comp key={c.name} c={c} color={open.color} />)}</div>
        </>
      ) : (
        <>
          <div className="h-title">System architecture</div>
          <div className="h-sub">High level first, then tap in. {live ? "Status is live — read from the running platform." : "Loading live status…"}</div>
          <input className="arch-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every layer & component…" />
          {q.trim() ? (
            <div className="arch-comps" style={{ marginTop: 6 }}>
              {results.length === 0 ? <div className="h-sub">No components match.</div> : results.map(({ c, l }) => <Comp key={`${l.id}-${c.name}`} c={c} color={l.color} layerTag={l.tag} />)}
            </div>
          ) : (
            <>
              <div className="arch-overview">
                <div className="arch-ov-t">The platform in one breath</div>
                <p className="arch-ov-b">{ARCH_OVERVIEW.summary}</p>
                <div className="arch-flow">{ARCH_OVERVIEW.flow.map((f, i) => <span key={f} className="arch-flow-i">{f}{i < ARCH_OVERVIEW.flow.length - 1 ? <span className="arch-flow-a">→</span> : null}</span>)}</div>
              </div>
              <div className="arch-layers">
                {ARCHITECTURE.map((l) => {
                  const live2 = l.components.filter((c) => statusOf(c) === "live").length;
                  return (
                    <button key={l.id} type="button" className="arch-tile" onClick={() => { setOpen(l); setComp(null); }} style={{ ["--c" as string]: l.color }}>
                      <div className="arch-tile-h">
                        <span className="arch-tag">{l.tag}</span>
                        <span className="arch-count">{live ? `${live2}/${l.components.length} live` : l.components.length}</span>
                      </div>
                      <div className="arch-tile-l">{l.label}</div>
                      <div className="arch-tile-b">{l.blurb}</div>
                      <div className="arch-tile-prev">{l.components.slice(0, 4).map((c) => c.name).join(" · ")}{l.components.length > 4 ? " · …" : ""}</div>
                      <div className="arch-view">View {l.components.length} components ›</div>
                    </button>
                  );
                })}
              </div>
              <a className="arch-sot-all" href="https://github.com/hoopsession3/gt3pb-app" target="_blank" rel="noreferrer">Live source ↗ hoopsession3/gt3pb-app</a>
            </>
          )}
        </>
      )}
    </section>
  );
}
