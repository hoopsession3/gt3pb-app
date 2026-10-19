// THE RELEASE, PLANNED FROM WHAT THE TREE SAYS (R40 — the fresh audit's OPS11-06).
//
//   npm run release:plan
//
// The ship sequence and its order lived in commit messages and file headers: "deploy it BEFORE pasting 0373", "paste it
// when service is quiet", "0432 right after the deploy", the snapshot's re-pull steps in a script's header, what is held
// in held.json. A second person — or a fresh session — shipping a round could push, paste mid-service, never deploy the
// push function, never re-pull the snapshot, and read a red Production run they couldn't tell apart from an outage.
// RELEASE.md is the sequence; this is the sequence for THIS tree: what is pending to paste and what each one's header
// says about when, what is held and until what, which push function this tree carries, whether the security snapshot
// covers it — then the steps in order. It reads files only: no network, no database, no key.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

/** The paste file's header and the migrations it holds. Pure. `from` is its `pending-from` line, which — the name is older than
 * its meaning — is the highest migration in supabase/migrations/ when the file was written, not the first one pending. */
export function pasteFile(text) {
  const from = (text.match(/^-- pending-from: (\d{4})$/m) || [])[1] ?? null;
  const count = Number((text.match(/^-- pending-count: (\d+)$/m) || [])[1] ?? NaN);
  const files = [...text.matchAll(/^-- (\d{4}_[a-z0-9_]+\.sql)$/gm)].map((m) => m[1]);
  return { from, count: Number.isFinite(count) ? count : null, files: [...new Set(files)] };
}

/** What a migration's header says about WHEN to paste it — the lines that name a moment or an order. Pure. */
export function whenLines(sql) {
  const head = sql.split("\n").filter((l) => l.startsWith("--")).slice(0, 40).map((l) => l.replace(/^--\s?/, "").trim());
  return head.filter((l) => /\b(paste|apply|deploy)\b[^.]*\b(before|after|when|once|quiet|first|by itself|alone|with its own yes)\b/i.test(l)
    && !/^(?:changelog|existing rows|set lock_timeout|verify)/i.test(l)).slice(0, 3);
}

/** The steps, in order, for what the tree holds. Pure. */
export function releaseSteps({ pending, held, pushVersion, snapshot }) {
  const steps = [
    "On the patch's tree: npm ci && npm run release   (verify, then npm's advisories — the same two CI runs)",
    "Push main. Vercel deploys it; the Production workflow waits for it (up to 15 minutes) and checks it.",
  ];
  if (pending.length) steps.push(`Paste supabase/APPLY_ALL_PENDING.sql (${pending.length}: ${pending.map((m) => m.file.slice(0, 4)).join(", ")}) in the SQL editor when service is quiet — each migration is its own transaction, and pasting it again changes nothing. Where a header names its own moment, it is listed above under its file — read it first.`);
  if (pending.length) steps.push("Re-pull the security snapshot after the paste (scripts/security.audit.mjs — four steps, a minute), commit it, and ship it with the next round.");
  else if (snapshot.notChecked) steps.push("Re-pull the security snapshot (scripts/security.audit.mjs) — it doesn't cover what is applied.");
  steps.push(`The push function: verify:prod's "push" line says whether the deployed one is this tree's (${pushVersion ?? "?"}). If it lags, deploy supabase/functions/push (index.ts and policy.ts).`);
  for (const h of held) steps.push(`Held, not in the paste file: ${h.file} — until ${h.until}.`);
  steps.push("Watch the Production workflow go green on the push. Red: RELEASE.md says what each line means, and CONTINUITY_RUNBOOK.md §8 how to roll back.");
  return steps;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const paste = existsSync(join(ROOT, "supabase/APPLY_ALL_PENDING.sql")) ? pasteFile(read("supabase/APPLY_ALL_PENDING.sql")) : { from: null, count: null, files: [] };
  const pending = paste.files.map((file) => {
    const p = join("supabase/migrations", file);
    return { file, when: existsSync(join(ROOT, p)) ? whenLines(read(p)) : [] };
  });
  const held = existsSync(join(ROOT, "supabase/held.json")) ? (JSON.parse(read("supabase/held.json")).held ?? []) : [];
  const pushVersion = (read("supabase/functions/push/index.ts").match(/const PUSH_VERSION = "([^"]+)";/) || [])[1] ?? null;
  const audit = spawnSync(process.execPath, [join(ROOT, "scripts/security.audit.mjs")], { encoding: "utf8" });
  const headline = ((audit.stdout || "") + (audit.stderr || "")).split("\n").find((l) => l.startsWith("SECURITY AUDIT")) ?? "SECURITY AUDIT: (no output)";
  let pulled = null;
  try { pulled = JSON.parse(read("supabase/schema.security.json")).pulled_at ?? null; } catch { /* none */ }
  const snapshot = { notChecked: /NOT CHECKED/.test(headline), headline, pulled };

  console.log("RELEASE PLAN — from this tree (files only; production's own state is verify:prod's to say)\n");
  console.log(`Pending to paste (supabase/APPLY_ALL_PENDING.sql, written as of ${paste.from ?? "?"}): ${pending.length || "none"}`);
  for (const m of pending) {
    console.log(`  · ${m.file}`);
    for (const w of m.when) console.log(`      when: ${w}`);
  }
  console.log(`Held on purpose (supabase/held.json): ${held.length || "none"}`);
  for (const h of held) console.log(`  · ${h.file} — until ${h.until}${h.since ? ` (since ${h.since})` : ""}`);
  console.log(`The push function this tree carries: ${pushVersion ?? "? (no PUSH_VERSION)"}`);
  console.log(`The security snapshot: pulled ${pulled ?? "never"} — ${headline.replace(/^SECURITY AUDIT: /, "")}`);
  console.log("\nThe steps, in order:");
  releaseSteps({ pending, held, pushVersion, snapshot }).forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
}
