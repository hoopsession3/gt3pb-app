// IMS7 — A SIZE AS IT WAS SAID (0469), IN POSTGRES. A research size fact is a positive number of inches up to 2400, its
// original kept beside it; a correction to one too; every other field and every null untouched; the library's and the
// Studio's own size rules as they were; and an existing bad row stops the migration, counted, changing nothing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M464 = readFileSync(join(ROOT, "supabase/migrations/0469_a_size_as_it_was_said.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const tryq = async (db, s, p) => { try { return { rows: (await db.query(s, p)).rows }; } catch (e) { return { error: e.message, code: e.code }; } };

// ── 1 · an existing bad row: the migration stops, says how many, and changes nothing ──
{
  const db = await fullSchema({ before: "0469" });
  const m = (await db.query(`insert into public.std_materials (tenant_id, name, category) values ($1, 'Old bench', 'seating') returning id`, [T1])).rows[0].id;
  await db.query(`insert into public.std_asset_facts (tenant_id, material_id, field, value, unit, source_class, source_kind, source_ref, method) values ($1, $2, 'w_in', '6', 'ft', 'manufacturer', 'url', 'https://m.test', 'quoted')`, [T1, m]);
  const r = await (async () => { try { await db.exec(M464); return {}; } catch (e) { return { error: e.message, code: e.code }; } })();
  ok("a size fact in feet (the old intake's) stops 0469 — counted, PT409", r.code === "PT409" && /1 size fact/.test(r.error), r);
  const cols = (await db.query(`select count(*)::int n from information_schema.columns where table_name = 'std_asset_facts' and column_name in ('original_value','original_unit')`)).rows[0].n;
  ok("…and nothing was changed: no column added, no row touched", cols === 0 && (await db.query(`select value #>> '{}' v, unit from public.std_asset_facts`)).rows[0].unit === "ft");
  await db.close();
}

// ── 2 · a clean database: applied twice, the rules ──
const db = await fullSchema({ before: "0469" });
const q = async (s, p) => (await db.query(s, p)).rows;
await db.exec(M464);
await db.exec(M464);
ok("0469 twice: recorded (applied twice)", (await q(`select applied_count::int n from public.schema_migrations where version like '0469%'`))[0].n === 2);
const m = (await q(`insert into public.std_materials (tenant_id, name, category) values ($1, 'Fixture bench', 'seating') returning id`, [T1]))[0].id;
const fact = (field, value, unit = null, o = {}) => tryq(db, `insert into public.std_asset_facts (tenant_id, material_id, field, value, unit, source_class, source_kind, source_ref, method, original_value, original_unit)
  values ($1, $2, $3, $4::jsonb, $5, 'manufacturer', 'url', 'https://m.test', 'quoted', $6, $7) returning id`, [T1, m, field, JSON.stringify(value), unit, o.ov ?? null, o.ou ?? null]);
ok("a size in inches with what was said kept: accepted", Array.isArray((await fact("w_in", 72.05, "in", { ov: "1,830 mm", ou: "mm" })).rows));
ok("…with no unit (the field's own): accepted", Array.isArray((await fact("d_in", 18)).rows));
for (const [what, v, u] of [["zero", 0, "in"], ["negative", -5, "in"], ["over 2400", 2500, "in"], ["a string", "72", "in"], ["feet", 6, "ft"], ["mm", 1830, "mm"], ["null as a value", null, null]])
  ok(`…refused: ${what}`, !!(await fact("h_in", v, u)).error);
ok("other fields untouched: a supplier with any unit, a claim in words", Array.isArray((await fact("supplier", "Shop")).rows) && Array.isArray((await fact("cost_cents", 189000, "each")).rows) && Array.isArray((await fact("claim", "Non-toxic")).rows));
ok("what was said is bounded (120 / 40)", !!(await fact("w_in", 10, "in", { ov: "x".repeat(121) })).error && !!(await fact("w_in", 10, "in", { ou: "u".repeat(41) })).error);
const id = (await q(`select id from public.std_asset_facts where field = 'w_in' limit 1`))[0].id;
ok("a correction to a size must be a positive number of inches too", !!(await tryq(db, `update public.std_asset_facts set corrected_value = '-3' where id = $1`, [id])).error && !!(await tryq(db, `update public.std_asset_facts set corrected_value = '"6 ft"' where id = $1`, [id])).error
  && Array.isArray((await tryq(db, `update public.std_asset_facts set corrected_value = '74' where id = $1 returning id`, [id])).rows));
ok("the library's own sizes: still null or positive and finite (0461)", !!(await tryq(db, `update public.std_materials set w_in = 0 where id = $1`, [m])).error && !!(await tryq(db, `update public.std_materials set w_in = 'NaN' where id = $1`, [m])).error
  && Array.isArray((await tryq(db, `update public.std_materials set w_in = null, d_in = 18 where id = $1 returning id`, [m])).rows));
console.log(`IMS7 — A SIZE AS IT WAS SAID (0469, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
