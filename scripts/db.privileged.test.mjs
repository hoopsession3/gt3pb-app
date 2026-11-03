// THE PRIVILEGED INVENTORY, PROVED BY THE MIGRATIONS (IMS7-0467; by name since the IMS8 baseline, 2026-11-03). Every
// SECURITY DEFINER function the API roles may call is named in scripts/security.definers.mjs with exactly the roles that
// may call it, from the ledger it arrives at (and until the one that takes it away). Replays the migrations to the
// snapshot's mark and to the latest migration and compares BY NAME AND ROLE — then shows why a count isn't enough: one
// safe function revoked and one unsafe granted keeps the count and is caught by name.
import { readdirSync } from "node:fs";
import { fullSchema } from "./fixtures/schema.full.mjs";
import { CEILING, PRIVILEGED_SINCE_SNAPSHOT, SNAPSHOT_MARK } from "./security.audit.mjs";
import { DEFINERS, definersAt } from "./security.definers.mjs";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };
const Q = `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' f,
  has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u,
  coalesce(array_to_string(p.proconfig, ','), '') cfg
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prokind = 'f'
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')) order by 1`;
const latest = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((f) => /^\d{4}_/.test(f)).sort().at(-1).slice(0, 4);
const next = (l) => String(Number(l) + 1).padStart(4, "0");
const diff = (rows, want) => {
  const got = rows.map((r) => r.f), extra = got.filter((x) => !want.all.includes(x)), missing = want.all.filter((x) => !got.includes(x));
  const anonGot = rows.filter((r) => r.a).map((r) => r.f), anonExtra = anonGot.filter((x) => !want.anon.includes(x)), anonMissing = want.anon.filter((x) => !anonGot.includes(x));
  return { extra, missing, anonExtra, anonMissing, clean: !extra.length && !missing.length && !anonExtra.length && !anonMissing.length };
};
const at = async (before, mutate) => { const db = await fullSchema(before ? { before } : {}); try { for (const m of mutate ?? []) await db.query(m); return (await db.query(Q)).rows; } finally { await db.close(); } };
const mark = await at(next(SNAPSHOT_MARK)), now = await at(null);
const dm = diff(mark, definersAt(SNAPSHOT_MARK)), dn = diff(now, definersAt(latest));
ok(`at the snapshot's mark (${SNAPSHOT_MARK}) the replay is the inventory by name and role (${mark.length})`, dm.clean, dm);
ok(`…and CEILING holds the inventory's count at the mark (${CEILING.definerExec}, signed out ${CEILING.anonExec})`, CEILING.definerExec === definersAt(SNAPSHOT_MARK).all.length && CEILING.anonExec === definersAt(SNAPSHOT_MARK).anon.length && mark.length === CEILING.definerExec);
ok(`at the latest migration (${latest}) the replay is the inventory by name and role (${now.length})`, dn.clean, dn);
ok("every API-callable definer the API may call is callable by signed-in callers (none anon-only)", now.every((r) => r.u), now.filter((r) => !r.u).map((r) => r.f));
ok("every API-callable definer pins its search_path", now.every((r) => /search_path/.test(r.cfg)), now.filter((r) => !/search_path/.test(r.cfg)).map((r) => r.f));
// The inventory's own record: 127 at 0440; since then 15 changes (14 in, 1 out), net +13; each change says how it's
// authorized and why. 139 at 0472, 140 at 0473 and 0474; signed out 16.
const changes = DEFINERS.filter((d) => d.since || d.until);
ok("the inventory: 127 at 0440, 139 at 0472, 140 at 0473 and at 0474; signed out 15, 16, 16, 16",
  [["0440", 127, 15], ["0472", 139, 16], ["0473", 140, 16], ["0474", 140, 16]].every(([l, n, a]) => definersAt(l).all.length === n && definersAt(l).anon.length === a));
ok("…15 changes since 0440 — 14 made callable, 1 taken away — net +13", DEFINERS.filter((d) => d.since).length === 14 && DEFINERS.filter((d) => d.until).length === 1 && changes.length === 14);
ok("…each change names its authorization path and its reason", changes.every((d) => (d.path ?? "").length > 40 && (d.why ?? "").length > 20), changes.filter((d) => !(d.path && d.why)).map((d) => d.fn));
ok("…no name listed twice", new Set(DEFINERS.map((d) => d.fn)).size === DEFINERS.length);
ok("PRIVILEGED_SINCE_SNAPSHOT is the inventory's own entries above the mark", PRIVILEGED_SINCE_SNAPSHOT.every((x) => DEFINERS.some((d) => d.fn === x.fn && d.since === x.in)));
// 0473: the research bill is the server's. The browser roles can't call the server's settle, nor write the accounting.
{
  const db = await fullSchema({});
  try {
    const f = (await db.query(`select has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u, has_function_privilege('service_role', p.oid, 'execute') s
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'std_research_settle_server'`)).rows;
    ok("std_research_settle_server: service_role only (not anon, not authenticated)", f.length === 1 && !f[0].a && !f[0].u && f[0].s, f);
    const old = (await db.query(`select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'std_research_settle'`)).rows[0].n;
    ok("std_research_settle (the caller's word for the cost) is gone", old === 0, old);
    const w = (await db.query(`select t, has_table_privilege('authenticated', 'public.'||t, 'INSERT') i, has_table_privilege('authenticated', 'public.'||t, 'UPDATE') u, has_table_privilege('authenticated', 'public.'||t, 'DELETE') d
      from unnest(array['std_research_runs']) t`)).rows;
    ok("std_research_runs: no insert, update or delete for authenticated (written only by reserve and the server's settle)", w.every((r) => !r.i && !r.u && !r.d), w);
  } finally { await db.close(); }
}
// Why a count isn't enough: revoke a safe one, grant an unsafe one — same count, caught by name.
{
  const swapped = await at(null, ["revoke execute on function public.course_give(uuid, text) from authenticated",
    "grant execute on function public.std_research_settle_server(uuid, uuid, jsonb, numeric, text, text, uuid) to authenticated"]);
  const d = diff(swapped, definersAt(latest));
  ok("an unsafe function replacing a safe one keeps the count …", swapped.length === now.length, [swapped.length, now.length]);
  ok("…and is caught by name (+ std_research_settle_server, − course_give)", !d.clean && d.extra.some((x) => x.startsWith("std_research_settle_server(")) && d.missing.some((x) => x.startsWith("course_give(")), d);
}
console.log(`  · at the mark ${SNAPSHOT_MARK}: ${mark.length}; at ${latest}: ${now.length}`);
console.log(`THE PRIVILEGED INVENTORY (definer functions the API may call, by name): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
