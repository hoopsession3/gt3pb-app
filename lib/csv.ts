import { saveFile, type Outcome } from "./deviceActions";

// One CSV writer for every export button (2026-08-01, enterprise round P2: "it's my data").
// Client-side on the rows a panel already loaded — no new endpoints, no schema, and the file
// matches exactly what the screen shows. Excel-safe: quotes doubled, CRLF rows, UTF-8 BOM so
// accents survive a double-click open. Saved by lib/deviceActions: a download on the web, the share
// sheet in the iPhone app (Save to Files, Mail, AirDrop…), where a download goes nowhere.
export function downloadCsv(filename: string, rows: Record<string, unknown>[]): Promise<Outcome> {
  if (typeof window === "undefined" || rows.length === 0) return Promise.resolve("unsupported");
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  return saveFile(filename, blob);
}
