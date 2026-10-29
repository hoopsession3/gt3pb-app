# GT3 security findings: the register

Baseline taken 29 Oct 2026 on tree `540d8a4e`, in reporting mode. Nothing here is suppressed: a finding that is not
fixed stays open with an owner and a next step. `npm run security:report` reads this file. An advisory or finding at
high or critical that is not listed here is **new**, and the report names it.

How a finding moves: **open → fixed (patch, commit) → verified (re-scan shows it gone)**, or **open → not a
vulnerability (why, who checked)**. A row is never deleted.

## What was scanned

| Check | How | Result |
| --- | --- | --- |
| Shipped dependencies | `npm audit --omit=dev` | 0 advisories. Already a required gate in ci.yml and the Production workflow's morning run. |
| Test and build tools | `npm audit` | 2 high (S-002, S-003), both fixed in the security baseline patch. |
| Secrets in the tree | detect-secrets, every tracked file | 16 hits, all checked; none is a credential (S-005). |
| Secrets in history | credential patterns across all 144 local commits | none |
| Code (SAST) | semgrep p/default, p/nextjs, p/react, p/secrets | 44 results; 1 fixed (S-001), the rest triaged below |
| Snyk | app.snyk.io, org hoopsession3 | GT3 is **not imported** into Snyk (S-008) |
| Existing gates | the chain, 248 checks | green on `2f0c303`: RLS gate, service-role audit, secrets audit, security audit, tenant tests |

## Findings

| ID | Severity | Where | What | Status | Owner | Next |
| --- | --- | --- | --- | --- | --- | --- |
| S-001 | low | `.github/workflows/production.yml` "Decide the form" | Event values pasted into a shell script (semgrep run-shell-injection). None of the three can be set by an outsider today. | fixed: values now arrive as environment variables | Claude | verify on the first run after merge |
| S-002 | high (dev only) | `happy-dom` 20.14.5 | GHSA-834v-8h66-3h79, GHSA-c8p4-j97h-3vg8, GHSA-5fpq-26gf-qwcr. Used only by the behaviour tests and never shipped. | fixed: 21.0.4 (behaviour, r36, r38 pass) | Claude | chain green |
| S-003 | high (dev only) | `zod` 4.4.3, under eslint-plugin-react-hooks | Allocation without limits | fixed: lock moves to 4.6.7 | Claude | chain green |
| S-004 | low | `components/BrewPlanner.tsx:1082` | A regex is built from an inventory unit without escaping. Staff-entered, not public. A unit with `.` or `(` could misdisplay, and a crafted one could be slow. | fixed: the unit is escaped before it becomes a pattern | Claude | — |
| S-005 | none | `.github/workflows/ios.yml:444`, `lib/appleKey.ts:14`, `scripts/push.function.test.mjs:526`, 13 entropy hits in tests | detect-secrets hits: a CI step writing a GitHub secret at run time, a PEM formatter, a 25-character dummy key, and test fixtures | not a vulnerability (checked by structure, no values printed) | Claude | — |
| S-006 | low | `scratch/` | Leftover working files from a migration paste (SQL chunks). No credentials found. | fixed: removed | Claude | — |
| S-007 | low | `.github/dependabot.yml` | No cooldown, so a just-published release could be proposed the same day | fixed: 7-day cooldown | Claude | — |
| S-008 | process | Snyk | GT3 is not imported, so Snyk sees only caaptive-shield | open | Ryan | Snyk → Add projects → GitHub → gt3pb-app |
| S-009 | low | 28 non-literal regex sites, 25 of them in `scripts/` | Built from constants or test data; `lib/agentKnowledge.ts:48` and `lib/bottleShelf.ts:30` use product keys and numbers | not a vulnerability (no outside input reaches them) | Claude | re-check if any becomes user-fed |
| S-010 | none | `scripts/smoke.*.mjs` (7) | react-insecure-request: `http://localhost` in the local smoke tests | not a vulnerability | Claude | — |

## Promotion to required

1. The shipped-dependency audit is already required.
2. The full audit (test and build tools) is reported by `npm run security:report`. It becomes a required ci.yml gate
   once this list has no open high and has stayed so for two weeks. That is an owner decision, because a red push for
   a test-only advisory is a real cost.
3. Secrets: `scripts/secrets.audit.mjs` already runs in `npm run audit`, inside the gate.
4. Long scans (semgrep, the history scan) run on demand or weekly, never in the fast push gate.
