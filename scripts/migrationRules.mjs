// RULES A MIGRATION IS READ AGAINST — the pure halves of scripts/drift.check.mjs's newer rules, so they can be run on
// made-up SQL (scripts/r15.test.mjs) as well as on supabase/migrations/.

/** Split SQL into top-level statements, respecting '' literals and $tag$ bodies (moved here from drift.check, unchanged). */
export function topLevelStatements(sql) {
  const t = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  const out = []; let cur = "", inStr = false, dq = null;
  for (let i = 0; i < t.length; i++) {
    if (dq) {
      if (t.startsWith(dq, i)) { cur += dq; i += dq.length - 1; dq = null; continue; }
      cur += t[i]; continue;
    }
    if (!inStr) {
      const m = /^\$[a-zA-Z_]*\$/.exec(t.slice(i));
      if (m) { dq = m[0]; cur += m[0]; i += m[0].length - 1; continue; }
    }
    const c = t[i];
    if (c === "'") {
      if (inStr && t[i + 1] === "'") { cur += "''"; i++; continue; }   // an escaped quote, not the end
      inStr = !inStr; cur += c; continue;
    }
    if (c === ";" && !inStr) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

// ── TENTH RULE (0422): a migration says how long it will wait for a lock ─────────────────────────────────────────────
// A file pasted into the SQL editor runs as one transaction, and an ALTER on a busy table waits for its lock with every
// later read and insert queued behind it — checkout and the Pass stalled until the paste finished (the 10/10 audit,
// database F16). From 0422 a migration's first statement is `set lock_timeout = '<n>s'` (or `set local …`): if a long
// query holds the table, the paste stops after a few seconds and nothing waits behind it — run it again a moment later.
// A file that takes no lock on an existing table says so: `-- lock-timeout: none — <why>`.
export const LOCK_FLOOR = 422;

/** Why a migration breaks the lock rule, or null when it keeps it. */
export function lockGap(sql) {
  if (/^\s*--\s*lock-timeout:\s*none\b/im.test(sql)) return null;
  const first = topLevelStatements(sql)[0] ?? "";
  if (/^set\s+(local\s+)?lock_timeout\s*(=|to)\s*'?\d+\s*(ms|s)?'?$/i.test(first.trim())) return null;
  return "its first statement is not `set lock_timeout = '<n>s'` (and it does not say `-- lock-timeout: none — <why>`)";
}

// ── ELEVENTH RULE (0422): a policy asks who is calling once a query, not once a row ─────────────────────────────────
// auth.uid(), is_staff(), is_admin(), is_owner(), effective_tenant() and current_tenant() take no row, so their answer is
// the same for every row a query looks at — but called bare in a policy, Postgres calls them (definer functions, never
// inlined) for each one. Wrapped in a sub-select, (select auth.uid()), the planner asks once (an InitPlan): Supabase's
// auth_rls_initplan, and 0422's change to every "tenant isolation" policy. From 0422 a policy written in a migration
// calls them wrapped.
export const WRAP_FLOOR = 422;
const BARE_HELPER = /(?<!select\s+)(?<!select\s+public\.)\b(?:(?:public\.)?(?:is_staff|is_admin|is_owner|effective_tenant|current_tenant)|auth\.uid)\(\)/gi;

/** The bare calls in each policy a migration writes (create policy / alter policy, top level or built in a DO block). */
export function bareHelpers(sql) {
  const text = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  const found = [];
  for (const m of text.matchAll(/\b(?:create|alter)\s+policy\b/gi)) {
    // The policy's text: to the end of its statement — a semicolon, or the close of the string a DO block builds it in.
    const rest = text.slice(m.index);
    const end = rest.search(/;|'\s*,|'\s*\)\s*;?/);
    const body = end > 0 ? rest.slice(0, end) : rest.slice(0, 800);
    for (const b of body.matchAll(BARE_HELPER)) found.push(`${body.replace(/\s+/g, " ").slice(0, 70)}… calls ${b[0]} bare`);
  }
  return found;
}
