// REBUILD supabase/schema.security.json FROM THE ROWS THE SQL EDITOR RETURNED.
//
//   node scripts/security.snapshot.mjs --from rows.json     # rows as [{row, chunk}, …] or [[row, chunk], …]
//   node scripts/security.snapshot.mjs --from rows.json --dry
//
// scripts/security.snapshot.sql is run in the Supabase SQL editor (pg_policy, pg_class and
// has_table_privilege are not reachable through PostgREST, and this repo holds no Postgres
// connection — see scripts/schema.snapshot.mjs for the same reasoning about the column snapshot).
// It returns one JSON document cut into 2000-character rows, plus a last row with the document's
// row count, length and sha256. This file puts the rows back together and REFUSES to write unless
// all three agree: a read-back that lost a row, doubled one, or trimmed a cell would otherwise
// become a snapshot that says a table has no policies — and scripts/security.audit.mjs would read
// that as a finding or, worse, as a clean bill for a table it never saw.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SNAPSHOT = join(ROOT, "supabase/schema.security.json");

/** rows → { doc, meta } or { error }. Pure; the digest check is the whole point. */
export function reassemble(rows) {
  const norm = rows.map((r) => (Array.isArray(r) ? { row: Number(r[0]), chunk: String(r[1]) } : { row: Number(r.row), chunk: String(r.chunk) }));
  norm.sort((a, b) => a.row - b.row);
  if (!norm.length) return { error: "no rows" };
  const last = norm[norm.length - 1];
  let meta; try { meta = JSON.parse(last.chunk); } catch { return { error: "the last row is not the digest row — was the result read to the end?" }; }
  if (!Number.isFinite(meta.rows) || !Number.isFinite(meta.length) || typeof meta.sha256 !== "string") return { error: "the last row does not carry rows/length/sha256" };
  const chunks = norm.slice(0, -1);
  if (chunks.length !== meta.rows) return { error: `${chunks.length} chunk row(s) read back, the database says ${meta.rows}` };
  for (let i = 0; i < chunks.length; i++) if (chunks[i].row !== i) return { error: `chunk rows are not 0…${meta.rows - 1} in order — row ${chunks[i].row} where ${i} was expected` };
  const doc = chunks.map((c) => c.chunk).join("");
  if (doc.length !== meta.length) return { error: `reassembled ${doc.length} characters, the database says ${meta.length} — a cell was trimmed or padded` };
  const sha = createHash("sha256").update(doc, "utf8").digest("hex");
  if (sha !== meta.sha256) return { error: "sha256 does not match — the text was altered on the way through the grid" };
  let json; try { json = JSON.parse(doc); } catch { return { error: "the document is not JSON" }; }
  if (!json.t || !json.f || !json.x) return { error: "the document has no t/f/x — wrong query? (see the shape in scripts/security.snapshot.sql)" };
  return { doc, meta, json };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const from = process.argv.find((a) => a.startsWith("--from="))?.slice(7) || process.argv[process.argv.indexOf("--from") + 1];
  const dry = process.argv.includes("--dry");
  if (!from) { console.log("usage: node scripts/security.snapshot.mjs --from rows.json [--dry]"); process.exit(2); }
  const rows = JSON.parse(readFileSync(from, "utf8"));
  const r = reassemble(rows);
  if (r.error) { console.log(`SECURITY SNAPSHOT: REFUSED — ${r.error}. Nothing written.`); process.exit(1); }
  const n = Object.keys(r.json.t).length;
  console.log(`SECURITY SNAPSHOT: ${n} relation(s), ${r.json.f.length} definer function(s), ${r.json.x.length} distinct expression(s), pulled ${r.json.pulled_at} from ${r.json.project}, ledger ${r.json.ledger?.count}/${String(r.json.ledger?.max_seq).padStart(4, "0")} — digest verified.`);
  if (dry) { console.log("  --dry: nothing written."); process.exit(0); }
  writeFileSync(SNAPSHOT, r.doc + "\n");   // byte-for-byte what the database printed, so the digest stays checkable
  console.log(`  wrote ${SNAPSHOT.slice(ROOT.length + 1)}`);
}
