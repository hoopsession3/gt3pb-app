// WHAT IS PENDING — the arithmetic, and the seam between the generator and the gate.
//
// scripts/migrations.pending.mjs decides what production has not applied from two integers. Two
// integers are a narrow instrument and the interesting cases are the ones where they are NOT
// enough, so most of this file is about the refusals.
//
// The last group is the one that matters most, and it is not about arithmetic at all. The generator
// WRITES a "-- pending-from:" line and drift.check.mjs READS one. That is one fact living in two
// files, which is the exact shape of the defect 0328 was written for — so it is checked here rather
// than assumed. If the header format and the gate's regex ever drift apart, the gate stops seeing
// the mark, reports "no pending-from line" forever, and the repo learns to ignore it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pendingFrom, pasteHeader, migrationFiles } from "./migrations.pending.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; return; }
  fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
};

const f = (...seqs) => seqs.map((s) => ({ file: `${String(s).padStart(4, "0")}_x.sql`, seq: s }));

// ── the ordinary answers ───────────────────────────────────────────────────────────────────────
{
  const v = pendingFrom(f(1, 2, 3), 3, 3);
  ok("all applied reports clean", v.status === "clean", v.status);
  ok("clean carries an empty list", Array.isArray(v.pending) && v.pending.length === 0);
}
{
  // 2026-09-29 exactly: three files written, ledger stops below them.
  const v = pendingFrom(f(324, 325, 326, 327, 328), 2, 325);
  ok("files above the mark are pending", v.status === "pending", v.status);
  ok("names all three", v.pending.map((m) => m.seq).join(",") === "326,327,328",
    v.pending.map((m) => m.seq).join(","));
}
{
  // Apply order is not lexical luck — a 9 must not sort after a 10.
  const v = pendingFrom(f(8, 9, 10, 11), 2, 9);
  ok("pending stays in apply order", v.pending.map((m) => m.seq).join(",") === "10,11",
    v.pending.map((m) => m.seq).join(","));
}

// ── the duplicate-numbered pairs that actually exist (0007 and 0040) ───────────────────────────
{
  // Two files share seq 7. The ledger keys on the full version name, so it holds TWO rows for them.
  // Counting distinct numbers instead of files is how one of each pair silently goes missing.
  const files = [
    { file: "0007_a.sql", seq: 7 }, { file: "0007_b.sql", seq: 7 }, { file: "0008_c.sql", seq: 8 },
  ];
  ok("duplicate seqs count as two files", pendingFrom(files, 3, 8).status === "clean",
    pendingFrom(files, 3, 8).status);
  ok("a ledger that counted them once is a gap", pendingFrom(files, 2, 8).status === "gap");
}

// ── the refusals ───────────────────────────────────────────────────────────────────────────────
{
  // A migration below the high-water mark never ran. The files ABOVE the mark are not the whole
  // answer, so emitting them would quietly skip the one in the middle.
  const v = pendingFrom(f(1, 2, 3, 4), 3, 4);
  ok("a gap below the mark refuses", v.status === "gap", v.status);
  ok("gap says how many", /1 migration\(s\) below the high-water mark/.test(v.reason), v.reason);
  ok("gap carries no list to paste", v.pending === undefined);
}
{
  // The database knows migrations this checkout does not — a branch behind main, or another db.
  const v = pendingFrom(f(1, 2), 5, 2);
  ok("ledger ahead of the directory refuses", v.status === "gap", v.status);
  ok("names the direction", /the database has 3 migration\(s\) this directory does not/.test(v.reason), v.reason);
}
{
  // An empty ledger against 326 files is not "everything is pending" — it is the wrong database.
  const v = pendingFrom(f(1, 2, 3), 0, null);
  ok("empty ledger + files refuses", v.status === "gap", v.status);
  ok("empty ledger blames the database, not the files", /different database|never run/.test(v.reason), v.reason);
  ok("empty ledger + empty directory is clean", pendingFrom([], 0, null).status === "clean");
}

// ── the seam: what the generator writes, the gate must read ────────────────────────────────────
{
  const header = pasteHeader(328, "2026-09-29", 0);
  // This regex is COPIED from scripts/drift.check.mjs. If they disagree the gate goes blind, so the
  // copy is checked against the real file below rather than trusted.
  const GATE_RE = /^\s*--\s*pending-from:\s*(\d{4})\b/im;
  const m = header.match(GATE_RE);
  ok("generated header carries a pending-from line", !!m);
  ok("and the gate reads the right number", m && m[1] === "0328", m && m[1]);

  const gate = readFileSync(join(ROOT, "scripts/drift.check.mjs"), "utf8");
  ok("the gate still uses this exact pattern", gate.includes("--\\s*pending-from:\\s*(\\d{4})"),
    "drift.check.mjs's pending-from regex changed — update this test AND pasteHeader together");
  ok("the gate excludes supabase/pending/ by only reading loose files",
    /isFile\(\)\s*\|\|\s*!e\.name\.endsWith\(["']\.sql["']\)/.test(gate) || gate.includes("withFileTypes: true"),
    "drift.check.mjs must not walk into supabase/pending/ — those are soak-gated");

  ok("header warns about the soak-gated directory", header.includes("NEVER include files from supabase/pending/"));
  ok("header says it is generated", /GENERATED FILE — DO NOT EDIT BY HAND/.test(header));
  ok("header names the command that regenerates it", header.includes("npm run migrations:pending -- --write"));
}

// ── the real directory, so this is not only a test about fixtures ──────────────────────────────
{
  const files = migrationFiles();
  ok("this repo has migrations to reason about", files.length > 300, String(files.length));
  ok("every file yields a finite seq", files.every((m) => Number.isFinite(m.seq)));
  const sorted = files.map((m) => m.seq);
  ok("files come back in non-decreasing seq order",
    sorted.every((n, i) => i === 0 || n >= sorted[i - 1]));
}

console.log(fail
  ? `MIGRATIONS PENDING: ${pass} passed, ${fail} FAILED`
  : `MIGRATIONS PENDING: ${pass} assertions pass — arithmetic, refusals, and the generator↔gate seam.`);
process.exit(fail ? 1 : 0);
