"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { downloadCsv } from "@/lib/csv";
import { ageLabel } from "@/lib/dates";

// ERRORS — what broke, how often, where. The reading end of lib/errorIntake.ts (2026-10-02).
//
// 0133 built the intake ("Can you tell when it breaks?" — audit finding #6): one row per unique
// error, a counter for repeats, one alert in the crew inbox the first time. Since then every
// browser white-screen has filed here, and since lib/apiRoute.ts every server route that throws
// files here too — and nothing in the app read the table. The alert said "App error (new)" and
// the row it pointed at could only be seen in the SQL editor. This is the screen. Read-only by
// design: the intake writes it, nobody edits history. The policy is "client errors staff read".
type Row = { id: string; message: string; stack: string | null; url: string | null; ua: string | null; fatal: boolean; skew: boolean; count: number; first_seen: string; last_seen: string };

const kindOf = (r: Row) => (r.skew && !r.fatal ? "Healed itself" : r.fatal ? "Screen crashed" : r.ua === "server" ? "Server" : "Error");
const whereOf = (r: Row) => { if (!r.url) return ""; try { return new URL(r.url).pathname; } catch { return r.url; } };
const frameOf = (r: Row) => (r.stack || "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 2).join(" · ");

export default function ErrorLog() {
  const loader = useCallback(async (): Promise<Row[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("client_errors")
      .select("id, message, stack, url, ua, fatal, skew, count, first_seen, last_seen")
      .order("last_seen", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    return (data as Row[]) ?? [];
  }, []);
  const board = useAsyncData(loader, []);
  const rows = board.data ?? [];

  return (
    <AsyncSection state={board} isEmpty={(d) => d.length === 0} emptyTitle="Nothing has broken" emptySub="A new error lands here the first time it happens — a screen that crashed, a route that threw — and the crew inbox gets one alert. Repeats only bump the count." errorTitle="Couldn't read the error log">
      {() => (
        <div className="audit-trail">
          <div className="audit-actions">
            <button type="button" className="dops-mini" onClick={() => downloadCsv("gt3-errors.csv", rows.map((r) => ({
              kind: kindOf(r), message: r.message, where: whereOf(r), count: r.count, first_seen: r.first_seen, last_seen: r.last_seen, frame: frameOf(r), ua: r.ua ?? "",
            })))}>Export CSV</button>
          </div>
          {rows.map((r) => (
            <div key={r.id} className="audit-row">
              <div className="audit-top">
                <b>{kindOf(r)}</b>
                <span className="audit-what">{r.message.length > 160 ? r.message.slice(0, 160) + "…" : r.message}</span>
                <span className="audit-when">{r.count > 1 ? `×${r.count} · ` : ""}{ageLabel(r.last_seen)}</span>
              </div>
              {(whereOf(r) || frameOf(r)) && <div className="audit-diff">{[whereOf(r), frameOf(r)].filter(Boolean).join("  ·  ")}</div>}
            </div>
          ))}
        </div>
      )}
    </AsyncSection>
  );
}
