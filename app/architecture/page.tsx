"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth, roleOf } from "@/components/AuthProvider";
import { Masthead, SectionHeader, ClosingBeat } from "@/components/kit";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/authedFetch";
import { ARCHITECTURE, ARCH_OVERVIEW, DATABASES, BUSINESS, BUSINESS_OVERVIEW, BUILD_STATS, MANAGE_LABEL, STATUS_LABEL, sotUrl, type ArchLayer, type ArchComponent, type ArchStatus } from "@/lib/architecture";

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
  const [view, setView] = useState<"progress" | "business" | "layers" | "databases">("progress");
  const [live, setLive] = useState<Record<string, ArchStatus> | null>(null);
  const [kpis, setKpis] = useState<Record<string, number> | null>(null);

  const isOwner = roleOf(profile) === "owner";
  useEffect(() => {
    if (!isOwner || !supabase) return;
    (async () => {
      const [s, k] = await Promise.all([
        authedFetch("/api/architecture/status").then((r) => r.json()).catch(() => null),
        authedFetch("/api/architecture/stats").then((r) => r.json()).catch(() => null),
      ]);
      if (s?.ok) setLive(s.status);
      if (k?.ok) setKpis(k.kpis);
    })().catch(() => {});
  }, [isOwner]);

  const statusOf = (c: ArchComponent): ArchStatus => (live && LIVE_KEY[c.name] && live[LIVE_KEY[c.name]]) || c.status;
  const money = (c: number) => "$" + Math.round((c || 0) / 100).toLocaleString();

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return ARCHITECTURE.flatMap((l) => l.components.map((c) => ({ c, l })))
      .filter(({ c }) => c.name.toLowerCase().includes(s) || c.desc.toLowerCase().includes(s) || (c.detail || "").toLowerCase().includes(s) || (c.config || "").toLowerCase().includes(s));
  }, [q]);

  if (!isOwner) {
    return (
      <section className="screen">
        <Masthead eyebrow="System map" right={<Link className="pf" href="/3mpire" aria-label="Back">‹</Link>} />
        <div className="h-title">Owners only</div>
        <div className="h-sub">The system architecture map is restricted to owners.</div>
        <ClosingBeat />
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
      <Masthead eyebrow="System map" live={!!live} right={<Link className="pf" href="/3mpire" aria-label="Exit">‹</Link>} />

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
          <div className="studio-views" style={{ marginTop: 12 }}>
            <button type="button" className={`studio-view${view === "progress" ? " on" : ""}`} onClick={() => setView("progress")}>Progress</button>
            <button type="button" className={`studio-view${view === "business" ? " on" : ""}`} onClick={() => setView("business")}>Business</button>
            <button type="button" className={`studio-view${view === "layers" ? " on" : ""}`} onClick={() => setView("layers")}>Layers</button>
            <button type="button" className={`studio-view${view === "databases" ? " on" : ""}`} onClick={() => setView("databases")}>Databases</button>
          </div>
          {view === "progress" ? (
            <div className="arch-prog">
              <div className="arch-overview">
                <div className="arch-ov-t">What we&apos;ve built <span className="arch-ov-when">· snapshot {BUILD_STATS.asOf}</span></div>
                <p className="arch-ov-b">The platform itself, by the numbers — everything shipped to run GT3PB.</p>
              </div>
              <div className="prog-grid">
                {BUILD_STATS.items.map((s) => (
                  <div key={s.l} className="prog-card"><span className="prog-l">{s.l}</span><span className="prog-n">{s.n}</span></div>
                ))}
              </div>
              {!kpis ? (
                <div className="h-sub" style={{ marginTop: 14 }}>Loading live numbers…</div>
              ) : (
                <div className="prog-build">
                  <SectionHeader label="By the numbers" annotation="live from the running platform" />
                  <div className="prog-build-grid">
                    <div className="prog-build-card"><span className="prog-build-n">{money(kpis.revenue_cents)}</span><span className="prog-build-l">Revenue</span></div>
                    <div className="prog-build-card"><span className="prog-build-n">{kpis.orders}</span><span className="prog-build-l">Orders</span></div>
                    <div className="prog-build-card"><span className="prog-build-n">{kpis.members}</span><span className="prog-build-l">Members</span></div>
                    <div className="prog-build-card"><span className="prog-build-n">{kpis.subscribers}</span><span className="prog-build-l">Subscribers</span></div>
                    <div className="prog-build-card"><span className="prog-build-n">{kpis.events}</span><span className="prog-build-l">Events · {kpis.events_upcoming} upcoming</span></div>
                    <div className="prog-build-card"><span className="prog-build-n">{money(kpis.inventory_value_cents)}</span><span className="prog-build-l">Inventory · {kpis.inventory_items} items</span></div>
                    <div className="prog-build-card"><span className="prog-build-n">{kpis.products_live}</span><span className="prog-build-l">Menu products</span></div>
                    <div className="prog-build-card"><span className="prog-build-n">{kpis.open_tasks}</span><span className="prog-build-l">Open tasks</span></div>
                  </div>
                  <div className="prog-foot">{BUSINESS.length} capabilities live · {kpis.tables} tables · {kpis.content_pieces} content pieces · {kpis.notes} meeting notes</div>
                </div>
              )}
            </div>
          ) : view === "business" ? (
            <div className="arch-biz">
              <div className="arch-overview">
                <div className="arch-ov-t">What we&apos;ve built — for the business</div>
                <p className="arch-ov-b">{BUSINESS_OVERVIEW}</p>
              </div>
              {BUSINESS.map((b) => (
                <div key={b.id} className="biz-card">
                  <div className="biz-head">
                    <span className="biz-icon" aria-hidden>{b.icon}</span>
                    <span className="biz-name">{b.name}</span>
                    <span className={`arch-st st-${b.status}`}>{STATUS_LABEL[b.status]}</span>
                  </div>
                  <p className="biz-outcome">{b.outcome}</p>
                  <ul className="biz-built">{b.built.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  <div className="biz-foot">
                    <span className="biz-where">{b.where}</span>
                    {b.next && <span className="biz-next">Next · {b.next}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : view === "databases" ? (
            <div className="arch-db">
              <div className="arch-overview">
                <div className="arch-ov-t">Database review</div>
                <p className="arch-ov-b"><b>{DATABASES.filter((d) => d.manage === "full").length} of {DATABASES.length}</b> tables are fully manageable in the app. The rest are partial, read-only, or system-managed by design.</p>
              </div>
              {DATABASES.map((d) => (
                <div key={d.table} className="arch-db-row">
                  <div className="arch-db-h"><span className="arch-db-t">{d.table}</span><span className={`arch-mg mg-${d.manage}`}>{MANAGE_LABEL[d.manage]}</span></div>
                  <div className="arch-db-note"><b>{d.surface}</b> · {d.note}</div>
                </div>
              ))}
            </div>
          ) : (<>
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
          </>)}
        </>
      )}
      <ClosingBeat />
    </section>
  );
}
