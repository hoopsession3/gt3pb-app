"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { downloadCsv } from "@/lib/csv";
import { ageLabel } from "@/lib/dates";
import { ACTION_LABEL, TABLE_LABEL, labelOf, lineMatches, mergeTrails, type AdminAuditRow, type AuditLogRow, type Line } from "@/lib/activity";

// CHANGE LOG — who changed what, when, with the before → after. Read-only by design: the triggers write it, nobody
// edits history. Two trails, one list (R49, lib/activity): 0260's admin_audit (prices, copy, deals, budgets, roles,
// tiers, the catalog) and 0042's audit_log (orders, drops, deliveries, inventory, gear, offer letters, agreements, and
// 0446's invoices, broadcasts, prep, events, stops, shoots, office orders, to-dos) — which no screen showed before.
// Searchable, and narrowed by what and by who; Export takes what's shown.
// Tier changes join it in 0392 (A1 of the account audit): a "customers" line keeps only the tier, so the member it is
// about is named here, at read time, from their profile.
type Board = { lines: Line[]; names: Record<string, string>; logRead: boolean };
const PAGE = 150;

export default function AuditTrail() {
  const [q, setQ] = useState("");
  const [what, setWhat] = useState("");
  const [who, setWho] = useState("");
  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { lines: [], names: {}, logRead: false };
    const [adm, log] = await Promise.all([
      supabase.from("admin_audit").select("id, actor, action, table_name, row_pk, summary, created_at").order("created_at", { ascending: false }).limit(PAGE),
      supabase.from("audit_log").select("id, actor, op, table_name, row_id, old_data, new_data, at").order("at", { ascending: false }).limit(PAGE),
    ]);
    if (adm.error) throw new Error(adm.error.message);
    const admin = (adm.data as AdminAuditRow[]) ?? [];
    // The second trail is the staff's to read (0042); a refusal there leaves the first standing, said under the list.
    const rows = log.error ? [] : ((log.data as unknown as AuditLogRow[]) ?? []);
    const lines = mergeTrails(admin, rows);
    const tierRows = lines.filter((r) => r.table === "customers" && r.rowPk).map((r) => r.rowPk);
    const ids = [...new Set([...lines.map((r) => r.actor), ...tierRows].filter(Boolean))] as string[];
    const names: Record<string, string> = {};
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, display_name").in("id", ids);
      for (const p of (profs ?? []) as { id: string; display_name: string | null }[]) names[p.id] = (p.display_name || "").trim().split(/\s+/)[0] || "";
    }
    return { lines, names, logRead: !log.error };
  }, []);
  const board = useAsyncData(loader, []);
  const lines = useMemo(() => board.data?.lines ?? [], [board.data]);
  const names = useMemo(() => board.data?.names ?? {}, [board.data]);
  const whoOf = useCallback((l: Line) => (l.actor ? (names[l.actor] || "Staff") : "System"), [names]);
  const aboutOf = (l: Line) => (l.table === "customers" ? ((l.rowPk && names[l.rowPk]) || "a member") : l.title ?? (l.table === "site_copy" && l.rowPk ? l.rowPk : ""));
  const whats = useMemo(() => [...new Set(lines.map((l) => l.table))].sort((a, b) => labelOf(a).localeCompare(labelOf(b))), [lines]);
  const whos = useMemo(() => [...new Set(lines.map(whoOf))].sort(), [lines, whoOf]);
  const shown = lines.filter((l) => (!what || l.table === what) && (!who || whoOf(l) === who) && lineMatches(l, whoOf(l), q));

  return (
    <AsyncSection state={board} isEmpty={(d) => d.lines.length === 0} emptyTitle="No changes logged yet" emptySub="Edits to the menu, the shop, codes, plans, lessons, orders, prep, events and the team land here automatically." errorTitle="Couldn't load the change log">
      {() => (
        <div className="audit-trail">
          <input type="search" className="w-full mb-2" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the log" aria-label="Search the activity log" enterKeyHint="search" autoComplete="off" />
          <div className="flex flex-wrap gap-2 items-center mb-1.5">
            <select className="grow basis-[140px] min-w-0" aria-label="What changed" value={what} onChange={(e) => setWhat(e.target.value)}>
              <option value="">Everything</option>
              {whats.map((t) => <option key={t} value={t}>{TABLE_LABEL[t] ?? labelOf(t)}</option>)}
            </select>
            <select className="grow basis-[140px] min-w-0" aria-label="Who changed it" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Everyone</option>
              {whos.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
            <button type="button" className="btn-sec btn-sm shrink-0" onClick={() => downloadCsv("gt3-change-log.csv", shown.map((r) => ({
              when: r.at, who: whoOf(r), what: labelOf(r.table), action: ACTION_LABEL[r.action] ?? r.action, row: aboutOf(r) || r.rowPk || "", change: r.summary ?? "",
            })))}>Export CSV</button>
          </div>
          <p className="mt-0.5 mb-2 font-sans text-caption text-cream-muted" role="status">{shown.length === lines.length ? `The last ${lines.length} changes` : `${shown.length} of the last ${lines.length} changes`}</p>
          {shown.map((r) => (
            <div key={r.key} className="audit-row">
              <div className="audit-top">
                <b>{whoOf(r)}</b>
                <span className="audit-what">{ACTION_LABEL[r.action] ?? r.action} · {labelOf(r.table)}{aboutOf(r) ? ` · ${aboutOf(r)}` : ""}</span>
                <span className="audit-when">{ageLabel(r.at)}</span>
              </div>
              {r.summary && <div className="audit-diff">{r.summary}</div>}
            </div>
          ))}
          {shown.length === 0 && <p className="mt-0.5 mb-2 font-sans text-caption text-cream-muted">Nothing in the last {lines.length} changes matches — clear the search or the filters.</p>}
          {board.data && !board.data.logRead && <p className="mt-0.5 mb-2 font-sans text-caption text-cream-muted">Orders, prep and gear history couldn&apos;t be read — only the catalog, roles and copy are shown.</p>}
        </div>
      )}
    </AsyncSection>
  );
}
