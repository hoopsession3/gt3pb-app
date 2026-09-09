// A VIEW YOU CANNOT READ IS A BROKEN SCREEN — 0321/0322/0323, executed from their files.
//
// ── WHY THIS TEST EXISTS ───────────────────────────────────────────────────────────────────────
// 0320 shipped two screens that were broken the instant they loaded in production, through a suite
// of 745 assertions, a production build, 71 UI smoke checks and five release gates. Nothing caught
// it, and nothing could have: the failure was a missing GRANT, and every other db test in this repo
// runs as the PGlite superuser, who has SELECT on everything by construction.
//
// So this one creates a real `authenticated` role and asks the question the app asks: can THAT role
// read what the screen reads? That is the only version of the question that matters, and it is the
// one no fixture here had ever posed.
//
// The chain that actually broke, four levels deep, is reproduced below in miniature — because the
// transitive case is the one a grep over app/ cannot see, and the one it took three migrations to
// finish chasing.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q = async (s) => (await db.query(s)).rows;

await db.exec(`
  create role anon;
  create role authenticated;

  -- the shape that broke: a chain of views, the top one granted, something underneath not.
  create table public.base_rows (id int primary key, secret text);
  create view public.v_level3 as select id, secret from public.base_rows;      -- deepest
  create view public.v_level2 as select id from public.v_level3;
  create view public.v_level1 as select id from public.v_level2;               -- what a screen reads

  -- Exactly the production state: the top view is invoker and granted, the ones underneath are not.
  alter view public.v_level1 set (security_invoker = on);
  grant select on public.v_level1 to authenticated;

  -- and a definer view, granted, whose dependency is also ungranted — this must NOT be reported,
  -- because a definer view runs as its OWNER and the caller never needs the underlying privilege.
  create view public.v_definer_top as select id from public.v_level3;
  grant select on public.v_definer_top to authenticated;
`);

// The gap view itself, lifted from 0321 rather than retyped — a check that differs from the one in
// production is not a check.
{
  const m = readFileSync(join(ROOT, "supabase/migrations/0321_a_view_you_cannot_read_is_a_broken_screen.sql"), "utf8");
  const a = m.indexOf("create or replace view public.v_invoker_view_gaps");
  const b = m.indexOf("alter view public.v_invoker_view_gaps", a);
  await db.exec(m.slice(a, b));
}
console.log("v_invoker_view_gaps created from 0321's own text.\n");

// ── the direct case ────────────────────────────────────────────────────────────────────────────
{
  const rows = await q(`select * from public.v_invoker_view_gaps where view_name='v_level1'`);
  ok("an invoker view the app can read, whose immediate dependency it cannot, is reported",
    rows.length === 1 && rows[0].unreadable_dependency === "v_level2",
    rows.map((r) => `${r.view_name} -> ${r.unreadable_dependency}`));
}

// ── the definer case, which must be silent ─────────────────────────────────────────────────────
ok("a DEFINER view is not reported — it runs as its owner, so the caller never needs the privilege",
  (await q(`select * from public.v_invoker_view_gaps where view_name='v_definer_top'`)).length === 0,
  await q(`select view_name, unreadable_dependency from public.v_invoker_view_gaps`));

// ── the transitive case: fixing one layer reveals the next, exactly as production did ──────────
// This is the part worth having. In production the chain was MarketsPanel → v_market_readiness →
// v_unaccounted_batches → v_batch_traceability, and it took 0321, 0322 and 0323 to walk it, because
// each fix exposed the layer below. A test that only covered the direct case would have passed
// after 0321 and been wrong.
await db.exec(`alter view public.v_level2 set (security_invoker = on);
               grant select on public.v_level2 to authenticated;`);
{
  const rows = await q(`select * from public.v_invoker_view_gaps order by view_name`);
  ok("granting the first layer does not clear it — the next one down is now the gap",
    rows.length === 1 && rows[0].view_name === "v_level2" && rows[0].unreadable_dependency === "v_level3",
    rows.map((r) => `${r.view_name} -> ${r.unreadable_dependency}`));
}

await db.exec(`alter view public.v_level3 set (security_invoker = on);
               grant select on public.v_level3 to authenticated;`);
{
  const rows = await q(`select * from public.v_invoker_view_gaps order by view_name`);
  ok("and the base TABLE is the last gap — a view chain bottoms out in a real table",
    rows.length === 1 && rows[0].unreadable_dependency === "base_rows" && rows[0].dependency_kind === "r",
    rows.map((r) => `${r.view_name} -> ${r.unreadable_dependency} (${r.dependency_kind})`));
}

await db.exec(`grant select on public.base_rows to authenticated;`);
ok("with every level granted, the check is empty — which is the only acceptable answer",
  (await q(`select * from public.v_invoker_view_gaps`)).length === 0,
  await q(`select view_name, unreadable_dependency from public.v_invoker_view_gaps`));

// ── the thing the whole episode was about ──────────────────────────────────────────────────────
// A revoke anywhere in the chain must resurface, not stay quietly broken.
await db.exec(`revoke all on public.v_level3 from authenticated;`);
ok("revoking a middle layer months later is caught, not discovered by a person opening the app",
  (await q(`select * from public.v_invoker_view_gaps`)).length === 1,
  await q(`select view_name, unreadable_dependency from public.v_invoker_view_gaps`));
await db.exec(`grant select on public.v_level3 to authenticated;`);

// ── the migrations record themselves ───────────────────────────────────────────────────────────
for (const [file, version] of [
  ["0321_a_view_you_cannot_read_is_a_broken_screen", "0321_a_view_you_cannot_read_is_a_broken_screen"],
  ["0322_the_gate_found_four_more", "0322_the_gate_found_four_more"],
  ["0323_the_last_link_in_the_chain", "0323_the_last_link_in_the_chain"],
]) {
  const src = readFileSync(join(ROOT, `supabase/migrations/${file}.sql`), "utf8");
  ok(`${version} records itself by its own filename`,
    src.includes(`record_migration('${version}'`), version);
}

console.log(`\nVIEW GRANTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
