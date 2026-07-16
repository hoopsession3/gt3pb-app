"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Shared KPI strip — the cohesion audit's "generalize MoneyKpis into one KpiRow" recommendation. One
// engine renders the .mkpi glance grid that opens Money/Customers/Team/Prep/Garage; each tab just
// hands it a static list of tiles. Every tile's query is isolated and defensive (fails to "—") so a
// schema gap can never break the section — the number just goes quiet.
type Sb = NonNullable<typeof supabase>;
export type KpiTile = { key: string; label: string; load: (db: Sb) => PromiseLike<{ count?: number | null }> };

function KpiStrip({ tiles, label }: { tiles: KpiTile[]; label: string }) {
  const [vals, setVals] = useState<Record<string, string>>({});
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
      {tiles.map((t) => (
        <div className="mkpi-tile" key={t.key}>
          <div className="mkpi-v">{vals[t.key] ?? "—"}</div>
          <div className="mkpi-k">{t.label}</div>
        </div>
      ))}
    </div>
  );
}

const head = (db: Sb, table: string) => db.from(table).select("id", { count: "exact", head: true });

// ── Team ── who's on the roster, at a glance
const TEAM_TILES: KpiTile[] = [
  { key: "staff", label: "Team members", load: (db) => head(db, "profiles").neq("role", "member") },
  { key: "leaders", label: "Leadership", load: (db) => head(db, "profiles").in("role", ["owner", "admin", "event_manager"]) },
  { key: "crew", label: "Crew", load: (db) => head(db, "profiles").in("role", ["server", "contractor", "operator"]) },
  { key: "members", label: "Members", load: (db) => head(db, "profiles").eq("role", "member") },
];

// ── Prep ── what's open before the next event
const PREP_TILES: KpiTile[] = [
  { key: "open", label: "Open prep tasks", load: (db) => head(db, "event_tasks").eq("done", false) },
  { key: "crit", label: "Critical open", load: (db) => head(db, "event_tasks").eq("done", false).eq("critical", true) },
  { key: "events", label: "Events on the books", load: (db) => head(db, "events") },
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
