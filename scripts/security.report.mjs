// SECURITY REPORT (29 Oct 2026 baseline): reporting mode.
//
// Asks npm's advisory database about everything installed (test and build tools included) and compares each high
// or critical advisory with docs/security/FINDINGS.md. An advisory the register doesn't name is NEW, and the report
// says so. It exits 0 unless run with --strict, the form it takes once the owner promotes it to a required gate
// (FINDINGS.md, "Promotion to required").
//
// What ships is already gated: ci.yml runs `npm audit --omit=dev --audit-level=high` on every push.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const strict = process.argv.includes("--strict");
const register = readFileSync(new URL("../docs/security/FINDINGS.md", import.meta.url), "utf8");

let raw;
try {
  raw = execFileSync("npm", ["audit", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch (e) {
  raw = e.stdout; // npm audit exits non-zero when it finds anything
}
let audit;
try {
  audit = JSON.parse(raw);
} catch {
  console.log("SECURITY REPORT: npm's advisory database did not answer (offline?) — nothing judged.");
  process.exit(strict ? 1 : 0);
}

const serious = [];
for (const [name, v] of Object.entries(audit.vulnerabilities ?? {})) {
  if (v.severity !== "high" && v.severity !== "critical") continue;
  const ids = (v.via ?? []).filter((x) => typeof x === "object").map((x) => (x.url ?? "").split("/").pop()).filter(Boolean);
  const known = register.includes(name) || ids.some((id) => register.includes(id));
  serious.push({ name, severity: v.severity, ids, known });
}

const fresh = serious.filter((s) => !known(s));
function known(s) { return s.known; }

const m = audit.metadata?.vulnerabilities ?? {};
console.log(`SECURITY REPORT: critical ${m.critical ?? 0} · high ${m.high ?? 0} · moderate ${m.moderate ?? 0} · low ${m.low ?? 0}`);
for (const s of serious) console.log(`  ${s.known ? "listed" : "NEW   "} ${s.severity} ${s.name} ${s.ids.join(" ")}`);
if (!fresh.length) console.log("  every high and critical is in docs/security/FINDINGS.md with an owner");
else console.log(`  ${fresh.length} not in docs/security/FINDINGS.md — add each with an owner and a next step`);
process.exit(strict && fresh.length ? 1 : 0);
