"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useOperatorSection, type OpSection } from "@/components/OperatorNav";

// Shared KPI strip — the cohesion audit's "generalize MoneyKpis into one KpiRow" recommendation. One
// engine renders the .mkpi glance grid that opens Money/Customers/Team/Prep/Garage; each tab just
// hands it a static list of tiles. Every tile's query is isolated and defensive (fails to "—") so a
// schema gap can never break the section — the number just goes quiet.
//
// 2026-07-29 UI audit: every tile here used to be a plain, unclickable div — it's shaped exactly
// like a tappable card (rounded, bordered, a number + a label) but nothing happened when you tapped
// one. Ryan: "Nothing happens when clicking on these, this not next level stuff." `to` is optional
// per tile — set it and the tile becomes a real button; leave it off and it renders exactly as
// before. Reuses the same {section, planTab, anchor} shape AlertsInbox's alertDest already uses to
// jump across sections (down to the same "gt3-plan-tab" localStorage bridge), so this is one more
// caller of an existing, proven mechanism — not a new one.
type Sb = NonNullable<typeof supabase>;
export type KpiDest = { section?: OpSection; planTab?: "calendar" | "events" | "vendors"; anchor?: string; openPanel?: string };
export type KpiTile = { key: string; label: string; load: (db: Sb) => PromiseLike<{ count?: number | null }>; to?: KpiDest };

function goToDest(d: KpiDest, setSection: (s: OpSection) => void) {
  // Order matters: stash the sub-tab and force-open the target panel BEFORE switching section, so
  // whatever mounts as a result of setSection already sees them (same order the alert-click handler
  // in app/crew/page.tsx uses for the identical bridge).
  if (d.planTab) { try { localStorage.setItem("gt3-plan-tab", d.planTab); } catch { /* ignore */ } }
  if (d.openPanel) { try { localStorage.setItem(`gt3-mpanel-${d.openPanel}`, "1"); } catch { /* ignore */ } }
  if (d.section) setSection(d.section);
  if (d.anchor) setTimeout(() => document.getElementById(d.anchor!)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
}

function KpiStrip({ tiles, label }: { tiles: KpiTile[]; label: string }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const { setSection } = useOperatorSection();
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    (async () => {
      const out = await Promise.all(
        tiles.map(async (t) => {
          try { const r = await t.load(supabase!); return [t.key, r.count != null ? String(r.count) : "—"] as const; }
          catch { return [t.key, "—"] as const; }
        }),
      );
      if (live) setVals(Object.fromEntries(out));
    })();
    return () => { live = false; };
  }, [tiles]);
  return (
    <div className="mkpi" role="group" aria-label={label}>
      {tiles.map((t) => {
        const v = vals[t.key] ?? "—";
        return t.to ? (
          <button key={t.key} type="button" className="mkpi-tile mkpi-go" onClick={() => goToDest(t.to!, setSection)}>
            <div className="mkpi-v">{v}</div>
            <div className="mkpi-k">{t.label}</div>
          </button>
        ) : (
          <div className="mkpi-tile" key={t.key}>
            <div className="mkpi-v">{v}</div>
            <div className="mkpi-k">{t.label}</div>
          </div>
        );
      })}
    </div>
  );
}

const head = (db: Sb, table: string) => db.from(table).select("id", { count: "exact", head: true });

// ── Team ── who's on the roster, at a glance
const TEAM_TILES: KpiTile[] = [
  { key: "staff", label: "Team members", load: (db) => head(db, "profiles").neq("role", "member") },
  { key: "leaders", label: "Leadership", load: (db) => head(db, "profiles").in("role", ["owner", "admin", "event_manager"]) },
  { key: "crew", label: "Crew", load: (db) => head(db, "profiles").in("role", ["server", "contractor", "operator"]) },
  // Members are customers, not team — the tile's real home is the CRM, so it jumps there.
  { key: "members", label: "Members", load: (db) => head(db, "profiles").eq("role", "member"), to: { section: "customers" } },
];

// ── Prep ── what's open before the next event
const PREP_TILES: KpiTile[] = [
  // Open/Critical both point at the exact board sitting right below this strip on the same
  // screen — force it open (it defaults open, but don't trust that if someone previously
  // collapsed it — same belt-and-suspenders the Settings deep-links already use) and scroll to it.
  { key: "open", label: "Open prep tasks", load: (db) => head(db, "event_tasks").eq("done", false), to: { anchor: "prep-board", openPanel: "prep-board" } },
  { key: "crit", label: "Critical open", load: (db) => head(db, "event_tasks").eq("done", false).eq("critical", true), to: { anchor: "prep-board", openPanel: "prep-board" } },
  // Events on the books isn't reachable from anywhere on THIS screen — it's a real cross-section
  // jump to Plan → Events (the only place events are actually managed).
  { key: "events", label: "Events on the books", load: (db) => head(db, "events"), to: { section: "plan", planTab: "events" } },
];

// ── Assets ── assets + stock health (internal "garage" naming kept for the section key/tiles below,
// matching OpSection's own "garage" key — only the label shown to users changed)
const GARAGE_TILES: KpiTile[] = [
  { key: "inv", label: "Inventory items", load: (db) => head(db, "inventory_items") },
  { key: "crit", label: "Critical items", load: (db) => head(db, "inventory_items").eq("critical", true) },
  { key: "low", label: "Low / out", load: (db) => head(db, "inventory_items").in("status", ["low", "out"]) },
];

export const TeamKpis = () => <KpiStrip tiles={TEAM_TILES} label="Team at a glance" />;
export const PrepKpis = () => <KpiStrip tiles={PREP_TILES} label="Readiness at a glance" />;
export const GarageKpis = () => <KpiStrip tiles={GARAGE_TILES} label="Assets at a glance" />;
