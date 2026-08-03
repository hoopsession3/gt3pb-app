// NO-DRIFT GATE (0269 — Ryan: "I don't want no drift anywhere again.")
//
// The failure mode this kills: the app shipped ~20 rounds while its own changelog — the
// institutional memory a cofounder reads — sat frozen at 2026-07-16. Nobody decided that;
// it drifted. Drift survives on being invisible, so this check makes it LOUD: every migration
// from 0269 forward must state its changelog position, in the file itself, or the release
// gate fails before the round can leave the shop.
//
// The contract (checked mechanically, satisfied one of two ways):
//   1. The migration carries its own entries:        insert into public.changelog ...
//   2. An explicit, greppable declaration:           -- changelog: <where the entry lives, or
//      why none is needed>  (e.g. "-- changelog: covered by 0271_big_round.sql" for split
//      rounds, or "-- changelog: none — data backfill, nothing user-visible")
//
// Opting out is allowed; drifting silently is not. The declaration is one comment line —
// friction stays near zero, which is what keeps a rule like this alive.

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "supabase", "migrations");
const FLOOR = 269;   // the rule starts where it was written — history isn't retro-judged

const offenders = [];
for (const f of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
  const n = parseInt(f.slice(0, 4), 10);
  if (!Number.isFinite(n) || n < FLOOR) continue;
  const sql = readFileSync(join(DIR, f), "utf8");
  const hasEntry = /insert\s+into\s+public\.changelog/i.test(sql);
  const hasDeclaration = /^\s*--\s*changelog:/im.test(sql);
  if (!hasEntry && !hasDeclaration) offenders.push(f);
}

if (offenders.length) {
  console.error(`NO-DRIFT GATE: ${offenders.length} migration(s) ship without a changelog position:`);
  for (const f of offenders) console.error(`  ✗ ${f}`);
  console.error(
    `\nEvery migration ≥ ${String(FLOOR).padStart(4, "0")} must either insert its own ` +
    `public.changelog entries or carry an explicit "-- changelog: ..." declaration ` +
    `(where the entry lives, or why none is needed). One comment line. No silent drift.`
  );
  process.exit(1);
}
console.log("NO-DRIFT GATE: every migration declares its changelog position — clean.");
