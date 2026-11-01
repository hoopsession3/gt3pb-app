// THE PRIVILEGED INVENTORY, PROVED BY THE MIGRATIONS (IMS7-0467). Every SECURITY DEFINER function the API roles may call
// that a migration above the security snapshot's mark added must be named in scripts/security.audit.mjs
// PRIVILEGED_SINCE_SNAPSHOT — with exactly the roles that may call it — and pin its search_path. Replays the migrations
// twice (to the snapshot's mark, and all of them) and compares; a new privileged function can't arrive unnamed.
import { fullSchema } from "./fixtures/schema.full.mjs";
import { PRIVILEGED_SINCE_SNAPSHOT, SNAPSHOT_MARK } from "./security.audit.mjs";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };
const Q = `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' f,
  has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u,
  coalesce(array_to_string(p.proconfig, ','), '') cfg
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prokind = 'f'
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')) order by 1`;
const at = async (before) => { const db = await fullSchema(before ? { before } : {}); try { return (await db.query(Q)).rows; } finally { await db.close(); } };
const mark = await at(String(Number(SNAPSHOT_MARK) + 1).padStart(4, "0")), now = await at(null);
const was = new Set(mark.map((r) => r.f));
const added = now.filter((r) => !was.has(r.f));
const named = new Map(PRIVILEGED_SINCE_SNAPSHOT.map((x) => [x.fn, x]));
ok(`the snapshot's mark (${SNAPSHOT_MARK}) replays to the snapshot's own ceiling: 127 definers the API may call`, mark.length === 127, mark.length);
ok("every API-callable definer added since is named in the inventory", added.every((r) => named.has(r.f)), added.filter((r) => !named.has(r.f)).map((r) => r.f));
ok("…and every name in the inventory is one (none stale, none removed)", PRIVILEGED_SINCE_SNAPSHOT.every((x) => added.some((r) => r.f === x.fn)), PRIVILEGED_SINCE_SNAPSHOT.filter((x) => !added.some((r) => r.f === x.fn)).map((x) => x.fn));
ok("…each callable by exactly the roles it says", added.every((r) => { const x = named.get(r.f); return x && JSON.stringify([r.a && "anon", r.u && "authenticated"].filter(Boolean)) === JSON.stringify(x.roles); }),
  added.filter((r) => { const x = named.get(r.f); return !x || JSON.stringify([r.a && "anon", r.u && "authenticated"].filter(Boolean)) !== JSON.stringify(x.roles); }).map((r) => [r.f, r.a, r.u]));
ok("…each with a reason and the migration it came in", PRIVILEGED_SINCE_SNAPSHOT.every((x) => x.why.length > 30 && /^\d{4}$/.test(x.in)));
ok("every API-callable definer pins its search_path", now.every((r) => /search_path/.test(r.cfg)), now.filter((r) => !/search_path/.test(r.cfg)).map((r) => r.f));
ok("no definer the API could call at the mark has been opened further since (no role added)", mark.every((r) => { const n = now.find((x) => x.f === r.f); return !n || ((!n.a || r.a) && (!n.u || r.u)); }));
console.log(`  · at the mark ${mark.length}, now ${now.length} (+${added.length}): ${added.map((r) => r.f.split("(")[0]).join(", ")}`);
console.log(`THE PRIVILEGED INVENTORY (definer functions the API may call, since the snapshot): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
