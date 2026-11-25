// 0474's PRE-PASTE CHECK against production's ledger as it stands (2026-11-24): 0473 and 0475 in, 0476 and 0477 applied
// and verified, 0474 held. Replayed (PGlite): every row t on that ledger; f on each kind of drift — an unexpected
// migration above 0475, a 0476/0477 under another name, and 0474 already in.
//   node scripts/db.ims8_0474_prepaste.test.mjs
import { readFileSync } from "node:fs";
import { fullSchema } from "./fixtures/schema.full.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}${got !== undefined ? ` → ${JSON.stringify(got).slice(0, 500)}` : ""}`); } };
const R = (f) => readFileSync(f, "utf8");
const PRE4 = R("supabase/checks/ims8_0474_prepaste.sql");
const LEDGER_ROW = "ledger: 0473 in, 0474 not";
const rows = async (db) => (await db.query(PRE4)).rows;
const allT = (r) => r.length > 0 && r.every((x) => x.as_expected === true);
const onlyLedgerF = (r) => r.filter((x) => x.as_expected !== true).map((x) => x.what).every((w) => w.startsWith(LEDGER_ROW))
  && r.some((x) => x.what.startsWith(LEDGER_ROW) && x.as_expected === false);
const ledger = async (db) => (await db.query(`select version from public.schema_migrations where version >= '0473' order by version`)).rows.map((r) => r.version);

// Production's order: everything before 0474, then 0475, 0476, 0477 — 0474 held.
const db = await fullSchema({ before: "0474" });
for (const f of ["0475_a_course_line_is_the_owners_and_admins.sql", "0476_recipes_are_kept_in_the_app.sql", "0477_recipe_versions_api_writes_only.sql"])
  await db.exec(R(`supabase/migrations/${f}`));
const L = await ledger(db);
ok("the replay's ledger is production's: 0473, 0475, 0476, 0477 — no 0474",
  L.join(",") === "0473_ims8_link_doors_customer_aggregates_and_settle_server,0475_a_course_line_is_the_owners_and_admins,0476_recipes_are_kept_in_the_app,0477_recipe_versions_api_writes_only"
  || (L.length === 4 && L[0].startsWith("0473") && L[1].startsWith("0475") && L[2] === "0476_recipes_are_kept_in_the_app" && L[3] === "0477_recipe_versions_api_writes_only"), L);
const expected = await rows(db);
ok("on the expected ledger: every row t", allT(expected), expected.filter((x) => x.as_expected !== true).map((x) => x.what));

// Drift, each undone before the next (a transaction rolled back).
async function drift(name, sql) {
  await db.exec("begin");
  try { await db.exec(sql); const r = await rows(db); ok(`${name}: the ledger row says f (and nothing else does)`, onlyLedgerF(r), r.filter((x) => x.as_expected !== true).map((x) => x.what)); }
  finally { await db.exec("rollback"); }
}
await drift("an unexpected migration above 0477 (0478)", `select public.record_migration('0478_something_unexpected')`);
await drift("a 0476 under another name", `select public.record_migration('0476_not_the_verified_one')`);
await drift("0477 renamed", `update public.schema_migrations set version = '0477_other' where version = '0477_recipe_versions_api_writes_only'`);
await drift("0474 already in the ledger", `select public.record_migration('0474_a_customer_book_is_the_owners_and_a_wrong_link_is_counted')`);
await drift("0473 missing", `delete from public.schema_migrations where version like '0473%'`);
ok("…and after the drift cases, the expected ledger is all t again", allT(await rows(db)));
await db.close();

console.log(`IMS8 0474 PRE-PASTE CHECK, ON PRODUCTION'S LEDGER (replayed): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
