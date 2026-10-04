"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { useOperatorSection, type OpSection } from "@/components/OperatorNav";
import { goPlanTab, isPlanTab } from "@/lib/planNav";
import { scrollToAnchor } from "@/lib/anchors";
import { taskIsCurrent, targetIsCurrent } from "@/lib/readiness";
import { localToday } from "@/lib/dates";

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
export type KpiDest = { section?: OpSection; planTab?: "calendar" | "events" | "vendors"; anchor?: string };
export type KpiTile = { key: string; label: string; load: (db: Sb) => PromiseLike<{ count?: number | null }>; to?: KpiDest };

// A TILE LANDS WHERE IT SAYS (2026-10-03). This used to write `gt3-mpanel-<id>=1` to localStorage
// and scrollIntoView the anchor 120ms later. <Panel> reads that key once, on mount — so a board
// someone had collapsed stayed collapsed, and scrolling its closed header (near the end of the
// screen) to the top took the page as far as it would go. Ryan: "I clicked on each metric and it
// just scrolled to the bottom." lib/anchors' scrollToAnchor is the jump the alerts and the
// Settings deep links already use: it asks the panel to open, waits for the page to settle, then
// scrolls. One jump, three callers.
export function goToDest(d: KpiDest, setSection: (s: OpSection) => void) {
  if (d.planTab && isPlanTab(d.planTab)) { goPlanTab(d.planTab, { setSection, anchor: d.anchor }); return; }
  if (d.section) setSection(d.section);
  if (d.anchor) scrollToAnchor(d.anchor);
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
  { key: "staff", label: "Staff accounts", load: (db) => head(db, "profiles").neq("role", "member") },
  { key: "leaders", label: "Leadership", load: (db) => head(db, "profiles").in("role", ["owner", "admin", "event_manager"]) },
  { key: "crew", label: "Crew roles", load: (db) => head(db, "profiles").in("role", ["server", "contractor", "operator"]) },
  // Members are customers, not team — the tile's real home is the CRM, so it jumps there.
  { key: "members", label: "Customer members", load: (db) => head(db, "profiles").eq("role", "member"), to: { section: "customers" } },
];

// ── Prep ── what's open before the next event
// READINESS COUNTS WHAT IS AHEAD (2026-10-03). These counted every open task in the table and every
// event ever entered: "32 open · 15 critical · 10 on the books", with two-month-old events under
// them reading "Not started". lib/readiness is the one rule for what is current; the board below
// the strip reads the same rule, so the number on the tile is the number of rows it opens onto.
// What is left open from the past is still on the board — last, and named — just not called
// readiness.
const openTasks = (db: Sb) => db.from("event_tasks")
  .select("id, critical, event_id, stop_id, events(day, archived_at, stage), stops(starts_at, archived_at, status)")
  .eq("done", false).limit(1000);
type OpenTaskRow = { critical: boolean; event_id: string | null; stop_id: string | null; events: { day: string | null; archived_at: string | null; stage: string | null } | null; stops: { starts_at: string | null; archived_at: string | null; status: string | null } | null };
const currentTasks = async (db: Sb, critical = false) => {
  const { data, error } = await openTasks(db);
  if (error) throw error;
  const today = localToday();
  return { count: ((data as unknown as OpenTaskRow[]) ?? []).filter((t) => (!critical || t.critical) && taskIsCurrent(t, today)).length };
};
const PREP_TILES: KpiTile[] = [
  // Open/Critical both point at the exact board sitting right below this strip on the same screen.
  { key: "open", label: "Open prep tasks", load: (db) => currentTasks(db), to: { anchor: "prep-board" } },
  { key: "crit", label: "Critical open", load: (db) => currentTasks(db, true), to: { anchor: "prep-board" } },
  // Upcoming events isn't reachable from anywhere on THIS screen — it's a real cross-section jump
  // to Plan › Events (the only place events are actually managed), landing on the list itself.
  { key: "events", label: "Upcoming events", load: async (db) => {
      const { data, error } = await db.from("events").select("day, archived_at, stage").is("archived_at", null).limit(1000);
      if (error) throw error;
      const today = localToday();
      return { count: ((data as { day: string | null; archived_at: string | null; stage: string | null }[]) ?? []).filter((e) => targetIsCurrent(e, null, today)).length };
    }, to: { section: "plan", planTab: "events", anchor: "plan-events" } },
];

// ── Assets ── assets + stock health (internal "garage" naming kept for the section key/tiles below,
// matching OpSection's own "garage" key — only the label shown to users changed)
const GARAGE_TILES: KpiTile[] = [
  { key: "inv", label: "Inventory items", load: (db) => head(db, "inventory_items") },
  { key: "crit", label: "Critical items", load: (db) => head(db, "inventory_items").eq("critical", true) },
  { key: "low", label: "Low / out", load: (db) => head(db, "inventory_items").in("status", ["low", "out"]) },
];

export const TeamKpis = () => <KpiStrip tiles={TEAM_TILES} label="Team at a glance" />;
export const GarageKpis = () => <KpiStrip tiles={GARAGE_TILES} label="Assets at a glance" />;

// ── Prep, aware of the drill-in ── (2026-07-30, Ryan's screenshot of Readiness › WineXpress with
// the strip still reading the global 21/13/6: "When a event or truck stop is clicked into the
// above dashboard should [be] dynamic.") With no target this is the same global strip as ever;
// hand it the selected event/stop and Open/Critical narrow to that target's own tasks, while
// "Events on the books" — meaningless inside one event — gives its slot to "Days to go". Scoped
// tiles still drill, each to its own spot on the detail below (Ryan: "It should still drill to
// that when warranted … put it where it makes sense"): Open → the checklist, Critical → the
// first open critical line, Days to go → the identity/date card. All same-screen anchors — no
// section hop — and a missing anchor (0 criticals) is a quiet no-op: nothing to drill to.
// One realtime ear on event_tasks keeps both flavors honest as tasks get checked off — the bump
// mints a fresh tiles identity, and KpiStrip's [tiles] effect refetches.
export function PrepKpis({ target }: { target?: { kind: "event" | "stop"; id: string } | null }) {
  const [bump, setBump] = useState(0);
  useRealtimeTable("event_tasks", () => setBump((b) => b + 1));
  const tiles = useMemo<KpiTile[]>(() => {
    void bump; // dependency only — each change re-mints the array so the strip re-queries
    if (!target) return [...PREP_TILES];
    const col = target.kind === "event" ? "event_id" : "stop_id";
    return [
      { key: "open", label: `Open tasks · this ${target.kind === "event" ? "event" : "stop"}`, load: (db) => head(db, "event_tasks").eq("done", false).eq(col, target.id), to: { anchor: "prep-target-tasks" } },
      { key: "crit", label: "Critical open", load: (db) => head(db, "event_tasks").eq("done", false).eq("critical", true).eq(col, target.id), to: { anchor: "prep-first-crit" } },
      {
        key: "days", label: "Days to go", load: async (db) => {
          const iso = target.kind === "event"
            ? ((await db.from("events").select("day").eq("id", target.id).maybeSingle()).data as { day: string | null } | null)?.day
            : (((await db.from("stops").select("starts_at").eq("id", target.id).maybeSingle()).data as { starts_at: string | null } | null)?.starts_at ?? null)?.slice(0, 10);
          if (!iso) return { count: null };
          const today = new Date(); today.setHours(0, 0, 0, 0);
          return { count: Math.max(0, Math.round((new Date(`${iso}T00:00:00`).getTime() - today.getTime()) / 86400000)) };
        },
        to: { anchor: "prep-target-details" },
      },
    ];
  }, [target, bump]);
  return <KpiStrip tiles={tiles} label={target ? "This target's readiness" : "Readiness at a glance"} />;
}
