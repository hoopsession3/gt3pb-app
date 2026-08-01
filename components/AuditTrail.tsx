"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { downloadCsv } from "@/lib/csv";
import { ageLabel } from "@/lib/dates";

// CHANGE LOG — the admin audit trail (0260, enterprise round P1): who changed which price, copy
// line, deal, budget, or role — when, with the before → after diff. Read-only by design: the
// trigger writes it, nobody edits history. The friendly table names keep it owner-readable.
type Row = { id: number; actor: string | null; action: string; table_name: string; row_pk: string | null; summary: string | null; created_at: string };
type Board = { rows: Row[]; names: Record<string, string> };

const TABLE_LABEL: Record<string, string> = {
  products: "Menu product", deals: "Deal", budgets: "Budget", site_copy: "Copy line", profiles: "Role",
};
const ACTION_LABEL: Record<string, string> = { INSERT: "added", UPDATE: "changed", DELETE: "removed" };

export default function AuditTrail() {
  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase) return { rows: [], names: {} };
    const { data, error } = await supabase.from("admin_audit")
      .select("id, actor, action, table_name, row_pk, summary, created_at")
      .order("created_at", { ascending: false }).limit(120);
    if (error) throw new Error(error.message);
    const rows = (data as Row[]) ?? [];
    const ids = [...new Set(rows.map((r) => r.actor).filter(Boolean))] as string[];
    const names: Record<string, string> = {};
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, display_name").in("id", ids);
      for (const p of (profs ?? []) as { id: string; display_name: string | null }[]) names[p.id] = (p.display_name || "").trim().split(/\s+/)[0] || "Staff";
    }
    return { rows, names };
  }, []);
  const board = useAsyncData(loader, []);
  const rows = board.data?.rows ?? [];
  const names = board.data?.names ?? {};

  return (
    <AsyncSection state={board} isEmpty={(d) => d.rows.length === 0} emptyTitle="No changes logged yet" emptySub="Edits to menu products, deals, budgets, copy, and roles land here automatically." errorTitle="Couldn't load the change log">
      {() => (
        <div className="audit-trail">
          <div className="audit-actions">
            <button type="button" className="dops-mini" onClick={() => downloadCsv("gt3-change-log.csv", rows.map((r) => ({
              when: r.created_at, who: r.actor ? (names[r.actor] ?? r.actor) : "system", what: TABLE_LABEL[r.table_name] ?? r.table_name,
              action: ACTION_LABEL[r.action] ?? r.action, row: r.row_pk ?? "", change: r.summary ?? "",
            })))}>Export CSV</button>
          </div>
          {rows.map((r) => (
            <div key={r.id} className="audit-row">
              <div className="audit-top">
                <b>{r.actor ? (names[r.actor] ?? "Staff") : "System"}</b>
                <span className="audit-what">{ACTION_LABEL[r.action] ?? r.action} · {TABLE_LABEL[r.table_name] ?? r.table_name}{r.row_pk && r.table_name !== "site_copy" ? "" : r.row_pk ? ` · ${r.row_pk}` : ""}</span>
                <span className="audit-when">{ageLabel(r.created_at)}</span>
              </div>
              {r.summary && <div className="audit-diff">{r.summary}</div>}
            </div>
          ))}
        </div>
      )}
    </AsyncSection>
  );
}
