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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { heldMigrations, ledgerDiff, pendingFrom, pasteHeader, migrationFiles } from "./migrations.pending.mjs";

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

// ── HELD ON PURPOSE (2026-10-11): 0376 waits for an iPhone build; 0377–0380 go ahead ─────────────────────────────
{
  // production as it stands: 0372–0375 and 0377–0379 applied, 0376 held, 0380 written.
  const files = f(371, 372, 373, 374, 375, 376, 377, 378, 379, 380);
  ok("without --held, the hole is a gap the generator refuses to guess at", pendingFrom(files, 8, 379).status === "gap");
  const v = pendingFrom(files, 8, 379, [376]);
  ok("with 0376 held, the count adds up", v.status === "pending", v.status);
  ok("…and the paste holds 0380 only — never the held one", v.pending.map((m) => m.seq).join() === "380", v.pending.map((m) => m.seq).join());
  ok("a held number that IS in the ledger's count still reads as a mismatch", pendingFrom(files, 9, 379, [376]).status === "gap");
  ok("holding nothing changes nothing", pendingFrom(f(1, 2, 3), 3, 3, []).status === "clean");
  const header = pasteHeader(380, "2026-10-11", 1, "test", ["0376_held_on_purpose.sql"]);
  ok("the header names the held file, and says it is not inside", /^-- held: 0376_held_on_purpose\.sql — NOT in this file/m.test(header), header);
  ok("…and still carries pending-from for the drift gate", /^-- pending-from: 0380$/m.test(header));
}

// ── THE NUMBERS (2026-10-11): /api/migrations sends `seqs`, so the gap is named and a hold is checked by number ──────
{
  const files = f(371, 372, 373, 374, 375, 376, 377, 378, 379, 380);
  const prod = [371, 372, 373, 374, 375, 377, 378, 379, 380]; // production after 0380: 0376 held
  {
    const v = pendingFrom(files, prod.length, 380, [], prod);
    ok("by number, the hole is named — not just counted", v.status === "gap" && /0376_x\.sql/.test(v.reason), v.reason);
    ok("…and carried as a list, never as something to paste", v.missing?.map((m) => m.seq).join() === "376" && v.pending === undefined);
  }
  {
    const v = pendingFrom(files, prod.length, 380, [376], prod);
    ok("by number, the held one IS the missing one: clean", v.status === "clean" && v.exact === true, JSON.stringify(v));
  }
  {
    // Held 0376, but it is 0374 the ledger lacks — same count, so two integers would call this clean.
    const wrong = [371, 372, 373, 375, 376, 377, 378, 379, 380];
    ok("two integers cannot tell which one is missing (the blind spot the numbers close)", pendingFrom(files, wrong.length, 380, [376]).status !== "gap");
    const v = pendingFrom(files, wrong.length, 380, [376], wrong);
    ok("by number, a different migration missing is a gap that names it", v.status === "gap" && /0374_x\.sql/.test(v.reason) && !/0376/.test(v.reason), v.reason);
    ok("…and the held one, which the ledger records, is said to be applied", v.heldApplied?.join() === "376", JSON.stringify(v.heldApplied));
  }
  {
    const all = [371, 372, 373, 374, 375, 376, 377, 378, 379, 380];
    const v = pendingFrom(files, all.length, 380, [376], all);
    ok("a held migration the ledger records is applied — clean, and said so", v.status === "clean" && v.heldApplied?.join() === "376", JSON.stringify(v));
  }
  {
    const v = pendingFrom(f(1, 2, 3, 4), 3, 3, [], [1, 2, 3]);
    ok("by number, files after the mark are pending as before", v.status === "pending" && v.pending.map((m) => m.seq).join() === "4");
    const h = pendingFrom(f(1, 2, 3, 4), 3, 3, [4], [1, 2, 3]);
    ok("…and a held one after the mark is never in the paste", h.status === "clean" && h.pending.length === 0, JSON.stringify(h));
  }
  {
    const v = pendingFrom(f(1, 2), 3, 9, [], [1, 2, 9]);
    ok("a number the directory has no file for is the database ahead of this checkout", v.status === "gap" && /number 0009/.test(v.reason), v.reason);
  }
  {
    const pair = [{ file: "0007_a.sql", seq: 7 }, { file: "0007_b.sql", seq: 7 }, { file: "0008_c.sql", seq: 8 }];
    ok("duplicate numbers: both recorded is clean", pendingFrom(pair, 3, 8, [], [7, 7, 8]).status === "clean");
    const v = pendingFrom(pair, 2, 8, [], [7, 8]);
    ok("duplicate numbers: one of the pair missing says it cannot tell which", v.status === "gap" && /one of 0007_a\.sql \/ 0007_b\.sql/.test(v.reason), v.reason);
  }
  {
    // A capped read (fewer numbers than the count) is not trusted: the two integers decide alone.
    const v = pendingFrom(files, 9, 380, [376], [371, 372]);
    ok("numbers short of the count fall back to the two integers", v.exact === undefined && v.missing === undefined && v.status === "clean", JSON.stringify(v));
    ok("an empty ledger with files is still the wrong database, numbers or not", pendingFrom(f(1, 2), 0, null, [], []).status === "gap");
  }
  {
    const d = ledgerDiff(f(1, 2, 3, 5), [1, 3, 4]);
    ok("ledgerDiff: missing below the mark, above it, and extra", d.missing.map((m) => m.seq).join() === "2" && d.above.map((m) => m.seq).join() === "5" && d.extra.join() === "4" && d.maxSeq === 4, JSON.stringify(d));
  }
}

// ── supabase/held.json: the list both the generator and the production gate read ─────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), "held-"));
  const at = (o) => { const p = join(dir, `h${Math.random().toString(36).slice(2)}.json`); writeFileSync(p, JSON.stringify(o)); return p; };
  const files = f(375, 376, 377);
  ok("no held file is nothing held", heldMigrations(files, join(dir, "none.json")).length === 0);
  const one = heldMigrations(files, at({ held: [{ file: "0376_x.sql", until: "build 83 on the phones", since: "2026-10-11" }] }));
  ok("an entry reads as its file, number and condition", one.length === 1 && one[0].seq === 376 && one[0].until === "build 83 on the phones", JSON.stringify(one));
  let threw = "";
  try { heldMigrations(files, at({ held: [{ file: "0399_typo.sql", until: "x" }] })); } catch (e) { threw = e.message; }
  ok("an entry naming a file that is not here throws — a typo must not hide a real gap", /0399_typo\.sql.*not in supabase\/migrations/.test(threw), threw);
  threw = "";
  try { heldMigrations(files, at({ held: [{ file: "0376_x.sql" }] })); } catch (e) { threw = e.message; }
  ok("an entry that does not say what it waits for throws", /what it waits for/.test(threw), threw);
  threw = "";
  const bad = join(dir, "bad.json"); writeFileSync(bad, "{ not json");
  try { heldMigrations(files, bad); } catch (e) { threw = e.message; }
  ok("a held file that does not parse throws, never reads as empty", /does not read/.test(threw), threw);
  rmSync(dir, { recursive: true, force: true });

  // The real list: every entry names a real file and its condition (heldMigrations throws otherwise).
  const real = heldMigrations();
  ok("this repo's supabase/held.json reads, every entry a real file with its condition", Array.isArray(real) && real.every((h) => h.file && h.until), JSON.stringify(real));
}

console.log(fail
  ? `MIGRATIONS PENDING: ${pass} passed, ${fail} FAILED`
  : `MIGRATIONS PENDING: ${pass} assertions pass — arithmetic, refusals, and the generator↔gate seam.`);
process.exit(fail ? 1 : 0);
