// IMS7 — WHAT A LINK SENDS (0463), IN POSTGRES. The investor link's data, not only its screens: every startup line
// arrives without its source, notes or library link, a room without its notes — for a link made today, one given before,
// at every approved version — while what it showed before is unchanged (totals, the case, research accepted as pinned,
// risks and an owner's risk acceptance). Expired, revoked, wrong and short tokens are refused; another business's plans
// never ride along; nobody can call the trimming function, or read the tables behind the link, directly.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M463 = readFileSync(join(ROOT, "supabase/migrations/0463_what_a_link_sends.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001", T2 = "0c463000-0000-4000-8000-0000000000b2";

const db = await fullSchema({ before: "0463" });
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
const door = async (token) => { await db.exec(`set role anon;`); try { return (await db.query(`select public.vision_shared($1) v`, [token])).rows[0].v; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role;`); } };
const anon = async (sql, p) => { await db.exec(`set role anon;`); try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role;`); } };

// The world: the seed's plans, shareable; the gym bar approved twice (v1 three days ago, v2 an hour ago), each startup
// line carrying a supplier's name, a note and a library link; an owner's risk acceptance; research accepted and proposed.
const plans = await q(`select id from public.vision_plans where tenant_id = $1 order by phase`, [T1]);
const gym = plans[0].id;
await q(`update public.vision_plans set shareable = true`);
const line = (cents, tag) => ({ id: `l-${tag}`, label: `Espresso bar ${tag}`, category: "equipment", qty: 1, unitCents: cents, confidence: "quoted",
  source: `SUPPLIER-SECRET-${tag} quote #4471`, notes: `INTERNAL-NOTE-${tag}: they'll drop 8% if we sign by Friday`, libraryId: "0c463000-0000-4000-8000-00000000f1b0", on: "2026-10-01" });
const baseline = (cents, tag) => ({ scenarios: { base: { ordersPerDay: 120, uses: [line(cents, tag), "not-an-object"], fixtures: { "0c463000-0000-4000-8000-00000000f1b0": "incremental" } }, conservative: { ordersPerDay: 90, uses: [line(cents, `${tag}c`)] }, upside: { ordersPerDay: 150, fixtures: { "0c463000-0000-4000-8000-00000000f1b0": "excluded" } } },
  structure: { kind: "none" }, acknowledged: [{ key: "no_downside", note: "Accepted: the downside is the gym's guarantee.", at: "2026-10-20", reviewBy: "2026-12-01" }] });
await q(`insert into public.vision_plan_versions (plan_id, version, baseline, research, risks, approved_at) values
  ($1, 1, $2::jsonb, '[{"topic":"demand","claim":"Accepted at v1.","source_url":"https://a.example"}]', '[{"words":"A risk"}]', now() - interval '3 days'),
  ($1, 2, $3::jsonb, '[{"topic":"demand","claim":"Accepted at v2.","source_url":"https://b.example"}]', '[{"words":"A risk, v2"}]', now() - interval '1 hour')`,
  [gym, JSON.stringify(baseline(1200000, "v1")), JSON.stringify(baseline(1500000, "v2"))]);
await q(`insert into public.vision_research (plan_id, topic, claim, source_url, status) values ($1, 'demand', 'PROPOSED-ONLY claim.', 'https://p.example', 'proposed')`, [gym]);
const room = (await q1(`select id from public.store_layouts where tenant_id = $1 order by created_at limit 1`, [T1])).id;
await q(`update public.store_layouts set notes = 'ROOM-NOTE: landlord wants it out by June' where id = $1`, [room]);
// Another business, with its own shareable plan and a room.
await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'other-business', 'Other business'); commit;`);
await q(`insert into public.vision_plans (tenant_id, program_id, name, format, phase, status, shareable) select $1, program_id, 'OTHER-TENANT plan', format, phase, status, true from public.vision_plans where id = $2`, [T2, gym]);
ok("the other business's plan is there (so its absence below means something)", (await q1(`select count(*)::int n from public.vision_plans where name = 'OTHER-TENANT plan'`)).n === 1);

const programs = (await q(`select array_agg(id) a from public.vision_programs where tenant_id = $1`, [T1]))[0].a ?? [];
const mk = async (label, pinnedAgo) => q1(`insert into public.vision_shares (label, money_plans, research_plans, layout_ids, program_ids, pinned_at) values ($1, array[$2::uuid], array[$2::uuid], array[$3::uuid], $4::uuid[], now() - $5::interval) returning id, token`,
  [label, gym, room, programs, pinnedAgo]);
const fresh = await mk("New link", "0 seconds"), older = await mk("Given two days ago", "2 days");
// Each read before 0463: the leak this migration closes.
const before = await door(fresh.token);
ok("before 0463: a link's data carried the supplier, the note and the library link — the gap", JSON.stringify(before).includes("SUPPLIER-SECRET") && JSON.stringify(before).includes("INTERNAL-NOTE") && JSON.stringify(before).includes("ROOM-NOTE"));

await db.exec(M463);
await db.exec(M463);
ok("0463 twice: recorded (applied twice), nothing else changed", (await q1(`select applied_count::int n from public.schema_migrations where version like '0463%'`)).n === 2);

const fNow = await door(fresh.token), fOld = await door(older.token);
const txt = (v) => JSON.stringify(v);
for (const [name, v] of [["a link made today", fNow], ["a link given before", fOld]]) {
  ok(`${name}: no supplier source, internal note or library link anywhere in what it sends`, !/SUPPLIER-SECRET|INTERNAL-NOTE|libraryId|0c463000-0000-4000-8000-00000000f1b0/.test(txt(v)), txt(v).match(/SUPPLIER-SECRET[^"]*|INTERNAL-NOTE[^"]*|libraryId/g));
  ok(`${name}: no room notes`, !/ROOM-NOTE/.test(txt(v)) && v.layouts.every((l) => !("notes" in l)), v.layouts.map((l) => Object.keys(l)));
  ok(`${name}: no proposed research, no other business's plan`, !/PROPOSED-ONLY|OTHER-TENANT/.test(txt(v)));
}
const g = (v) => v.plans.find((p) => p.id === gym);
ok("a link made today shows the version approved by now (v2); one given two days ago keeps v1 — pins unchanged", g(fNow).money.version === 2 && g(fOld).money.version === 1, [g(fNow).money?.version, g(fOld).money?.version]);
const u2 = g(fNow).money.baseline.scenarios.base.uses[0];
ok("…each line keeps what the case is worked out from: label, category, quantity, unit cost, confidence, date", u2.label === "Espresso bar v2" && u2.category === "equipment" && u2.qty === 1 && u2.unitCents === 1500000 && u2.confidence === "quoted" && u2.on === "2026-10-01" && u2.id === "l-v2", u2);
ok("…no scenario carries the crew's fixture reconciliation (keyed by library id), with lines or without", !("fixtures" in g(fNow).money.baseline.scenarios.base) && !("fixtures" in g(fNow).money.baseline.scenarios.upside));
ok("…in every scenario, and a malformed line passes through untouched", g(fNow).money.baseline.scenarios.conservative.uses[0].source === undefined && g(fNow).money.baseline.scenarios.base.uses[1] === "not-an-object");
ok("…a scenario with no lines, the structure and the numbers: as approved", g(fNow).money.baseline.scenarios.upside.ordersPerDay === 150 && g(fNow).money.baseline.structure.kind === "none" && g(fNow).money.baseline.scenarios.base.ordersPerDay === 120);
ok("…an owner's risk acceptance and its reason still reach investors (authorized, IP1.4)", g(fNow).money.baseline.acknowledged?.[0]?.note === "Accepted: the downside is the gym's guarantee.");
ok("…research as accepted at the pinned version, and its risks", g(fNow).research?.[0]?.claim === "Accepted at v2." && g(fOld).research?.[0]?.claim === "Accepted at v1." && g(fNow).risks?.[0]?.words === "A risk, v2");
ok("…the room still draws: its size and its things", g(fNow) && fNow.layouts[0].width_in > 0 && fNow.layouts[0].items.length > 0);
const stored = await q1(`select baseline from public.vision_plan_versions where plan_id = $1 and version = 2`, [gym]);
ok("the approved version itself is untouched — trimmed at the door, never rewritten", JSON.stringify(stored.baseline).includes("SUPPLIER-SECRET-v2"));

// Links that aren't live, and doors that aren't the link.
await q(`update public.vision_shares set expires_at = now() - interval '1 minute' where id = $1`, [older.id]);
ok("an expired link is refused (PT404), sending nothing", (await door(older.token)).code === "PT404");
await q(`update public.vision_shares set revoked_at = now() where id = $1`, [fresh.id]);
ok("a revoked link is refused (PT404)", (await door(fresh.token)).code === "PT404");
ok("a wrong token and a short one are refused (PT404)", (await door("f".repeat(64))).code === "PT404" && (await door("short")).code === "PT404" && (await door(null)).code === "PT404");
ok("nobody calls the trimming function directly", !!(await anon(`select public.vision_share_baseline('{}'::jsonb) v`)).error);
const direct = await anon(`select baseline from public.vision_plan_versions`);
ok("…or reads the approved versions, the money or the research behind the link", (direct.error || direct.length === 0)
  && (((r) => r.error || r.length === 0)(await anon(`select * from public.vision_plan_money`))) && (((r) => r.error || r.length === 0)(await anon(`select * from public.vision_research`))));
ok("the trimming is pure: the same in, the same out; null and non-objects pass through", JSON.stringify((await q1(`select public.vision_share_baseline($1::jsonb) v`, [JSON.stringify(baseline(1, "x"))])).v) === JSON.stringify((await q1(`select public.vision_share_baseline($1::jsonb) v`, [JSON.stringify(baseline(1, "x"))])).v)
  && (await q1(`select public.vision_share_baseline(null) v`)).v === null && (await q1(`select public.vision_share_baseline('[1]'::jsonb) v`)).v[0] === 1);

console.log(`IMS7 — WHAT A LINK SENDS (0463, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
