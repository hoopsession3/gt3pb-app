// IMS7 — A LINK SENDS NAMED FIELDS ONLY (0464, over 0463), IN POSTGRES. An investor link's data is built from named fields only — an allow-list,
// not a deny-list (Ryan's security review, 2026-10-31). Tested through the real door, vision_shared, as an anonymous
// investor: nothing unnamed reaches the payload at any depth (a new internal field, a nested object in a named field, a
// malformed line, a scenario by another name), every scenario and nested structure is filtered, links made today and
// links given before get the same, the investor case's figures and risk disclosures are exactly what they were, the
// approved versions are untouched, and expired, revoked, malformed, wrong and other-business links stay shut.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";
import { loadTs } from "./search.read.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M463 = readFileSync(join(ROOT, "supabase/migrations/0464_a_link_sends_named_fields_only.sql"), "utf8");   // the allow-list (0464), over 0463
const MONEY = loadTs("lib/visionMoney.ts"), CASE = loadTs("lib/visionCase.ts"), DATA = loadTs("lib/visionCaseData.ts");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001", T2 = "0c463000-0000-4000-8000-0000000000b2";
const LIB = "0c463000-0000-4000-8000-00000000f1b0";

const db = await fullSchema({ before: "0464" });   // 0463 (the deny-list) applied, as main has it
const q = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
const door = async (token) => { await db.exec(`set role anon;`); try { return (await db.query(`select public.vision_shared($1) v`, [token])).rows[0].v; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role;`); } };
const anon = async (sql, p) => { await db.exec(`set role anon;`); try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role;`); } };

// ── The world: a realistic approved case, with something internal at every depth ─────────────────────────────────────
const SECRET = (where) => `INTERNAL-${where}`;
const line = (cents, tag) => ({ id: `l-${tag}`, label: `Espresso bar ${tag}`, category: "equipment", qty: 2, unitCents: cents, confidence: "quoted", on: "2026-10-01",
  source: `SUPPLIER-${tag} quote #4471`, notes: SECRET(`line-note-${tag}`), libraryId: LIB, supplierQuote: SECRET("line-new-field"), vendor: { name: SECRET("line-nested") } });
const scenario = (tag, orders) => ({
  uses: [line(1200000, tag), { id: `r-${tag}`, label: "Reserve", category: "reserve", qty: 1, unitCents: 3000000 }],
  ordersPerDay: orders, avgOrderCents: 900, daysOpenPerMonth: 26, hoursOpenPerDay: 10, rampMonths: 4, rampStartPct: 60, growthPctPerYear: 5, cogsPct: 30, cardFeePct: 3,
  staffHoursPerDay: 20, wageCents: 1600, laborBurdenPct: 12, rentCents: 450000, rentPctOfSales: 0, otherOpexCents: 120000, marketingCents: 80000, ownerCashCents: 2000000,
  channels: [{ kind: "local", label: "Walk-ins", reach: 3000, convertPct: 4, costCents: 0, startMonth: 1, contact: SECRET("channel-contact") }],
  repeatPerMonth: 1.5, keptPct: 60, peakFactor: 1.8, slowFactor: 0.4, serveSec: 90, demandFrom: "typed", capToRoom: false, mixDrives: true, itemsPerOrder: 1.2,
  mix: [{ key: "cold-brew", label: "Cold brew", sharePct: 60, priceCents: 600, unitCostCents: 120, packagingCents: 30, recipe: SECRET("mix-recipe"), ratio: { water: SECRET("mix-ratio") } },
        { key: "tonic", label: "Tonic", sharePct: 40, priceCents: 700, unitCostCents: 150, packagingCents: 40 }],
  fixtures: { [LIB]: "incremental" }, internalNote: SECRET("scenario-new-field"), cogsDetail: { supplier: SECRET("scenario-nested") },
});
const baseline = (tag) => ({
  scenarios: { conservative: scenario(`${tag}c`, 80), base: scenario(tag, 110), upside: scenario(`${tag}u`, 140), internalCase: scenario(SECRET("scenario-name"), 999), weird: "x" },
  structure: { kind: "rev_share", amountCents: 4000000, sharePct: 6, capMultiple: 1.5, sideLetter: SECRET("structure-new-field"), terms: { secret: SECRET("structure-nested") } },
  acknowledged: [{ key: "no_downside", note: "Accepted: the downside is the gym's guarantee.", at: "2026-10-20", reviewBy: "2026-12-01", internalNote: SECRET("ack-new-field") }, "junk"],
  internal: SECRET("baseline-new-field"), workingNotes: [SECRET("baseline-array")],
});
const RESEARCH = (v) => JSON.stringify([{ topic: "demand", claim: `Accepted at ${v}.`, figure: "1,200 a day", source_url: `https://${v}.example`, source_title: "Count", published: "2026-09-01", bearing: "for", retrieved_at: "2026-10-01", draftNotes: SECRET("research-new-field") }]);
const RISKS = (v) => JSON.stringify([{ kind: "risk", words: `Footfall drops, ${v}`, likelihood: "medium", impact: "high", mitigation: "Events", evidence: "Last winter", status: "open", ownerOnly: SECRET("risk-new-field") }]);

const plans = await q(`select id from public.vision_plans where tenant_id = $1 order by phase`, [T1]);
const gym = plans[0].id;
await q(`update public.vision_plans set shareable = true`);
await q(`insert into public.vision_plan_versions (plan_id, version, baseline, research, risks, approved_at) values
  ($1, 1, $2::jsonb, $3::jsonb, $4::jsonb, now() - interval '3 days'), ($1, 2, $5::jsonb, $6::jsonb, $7::jsonb, now() - interval '1 hour')`,
  [gym, JSON.stringify(baseline("v1")), RESEARCH("v1"), RISKS("v1"), JSON.stringify(baseline("v2")), RESEARCH("v2"), RISKS("v2")]);
await q(`insert into public.vision_research (plan_id, topic, claim, source_url, status) values ($1, 'demand', 'PROPOSED-ONLY claim.', 'https://p.example', 'proposed')`, [gym]);
const room = (await q1(`select id from public.store_layouts where tenant_id = $1 order by created_at limit 1`, [T1])).id;
await q(`update public.store_layouts set notes = $2 where id = $1`, [room, SECRET("room-note")]);
await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'other-business', 'Other business'); commit;`);
await q(`insert into public.vision_plans (tenant_id, program_id, name, format, phase, status, shareable) select $1, program_id, 'OTHER-TENANT plan', format, phase, status, true from public.vision_plans where id = $2`, [T2, gym]);
ok("the other business's plan is there (so its absence below means something)", (await q1(`select count(*)::int n from public.vision_plans where name = 'OTHER-TENANT plan'`)).n === 1);
const programs = (await q(`select array_agg(id) a from public.vision_programs where tenant_id = $1`, [T1]))[0].a ?? [];
const mk = async (label, pinnedAgo, tenant = T1) => q1(`insert into public.vision_shares (tenant_id, label, money_plans, research_plans, layout_ids, program_ids, pinned_at) values ($6, $1, array[$2::uuid], array[$2::uuid], array[$3::uuid], $4::uuid[], now() - $5::interval) returning id, token`,
  [label, gym, room, programs, pinnedAgo, tenant]);
const fresh = await mk("New link", "0 seconds"), older = await mk("Given two days ago", "2 days");

const before = await door(fresh.token), beforeOld = await door(older.token);
const txt = (v) => JSON.stringify(v);
ok("with 0463 alone (the deny-list): the known fields gone, but every unknown one still sent — the gap 0464 closes", !txt(before).includes("SUPPLIER-") && !txt(before).includes("INTERNAL-line-note") && !txt(before).includes("INTERNAL-room-note")
  && ["INTERNAL-mix-recipe", "INTERNAL-baseline-new-field", "INTERNAL-scenario-new-field", "INTERNAL-line-new-field", "INTERNAL-structure-nested", "INTERNAL-risk-new-field", "INTERNAL-research-new-field", "INTERNAL-scenario-name"].every((x) => txt(before).includes(x)),
  ["INTERNAL-mix-recipe", "INTERNAL-baseline-new-field"].map((x) => txt(before).includes(x)));
const versionsBefore = await q(`select id, md5(baseline::text) b, md5(research::text) r, md5(risks::text) k from public.vision_plan_versions order by id`);

await db.exec(M463);
await db.exec(M463);
ok("0464 twice: recorded (applied twice); 0463 stays recorded", (await q1(`select applied_count::int n from public.schema_migrations where version like '0464%'`)).n === 2 && (await q1(`select count(*)::int n from public.schema_migrations where version like '0463%'`)).n === 1);

// ── Nothing unnamed, at any depth, for a link made today and one given before ──────────────────────────────────────────
const fNow = await door(fresh.token), fOld = await door(older.token);
for (const [name, v] of [["a link made today", fNow], ["a link given two days ago", fOld]]) {
  ok(`${name}: no internal field anywhere — supplier, notes, library link, new fields, nested objects, other scenario names`, !/INTERNAL-|SUPPLIER-|libraryId|0c463000-0000-4000-8000-00000000f1b0/.test(txt(v)), txt(v).match(/INTERNAL-[a-z-]*|SUPPLIER-[a-z0-9-]*|libraryId/g));
  ok(`${name}: no room notes, no proposed research, no other business's plan`, v.layouts.every((l) => !("notes" in l)) && !/PROPOSED-ONLY|OTHER-TENANT/.test(txt(v)));
}
const g = (v) => v.plans.find((p) => p.id === gym);
const B = g(fNow).money.baseline;
ok("the baseline is exactly its three named parts", Object.keys(B).sort().join() === "acknowledged,scenarios,structure", Object.keys(B));
ok("…three scenarios by name, no other (\"internalCase\" isn't sent)", Object.keys(B.scenarios).sort().join() === "base,conservative,upside", Object.keys(B.scenarios));
const ALLOWED_INPUTS = Object.keys(MONEY.BLANK).filter((k) => k !== "fixtures");
ok("…a scenario is the money engine's inputs by name and nothing else (no fixtures map, no new field)", Object.keys(B.scenarios.base).every((k) => ALLOWED_INPUTS.includes(k)) && !("fixtures" in B.scenarios.base) && !("internalNote" in B.scenarios.base), Object.keys(B.scenarios.base));
ok("…a startup line keeps id, label, category, qty, unitCents, confidence, on — nothing else", B.scenarios.base.uses.every((u) => Object.keys(u).every((k) => ["id", "label", "category", "qty", "unitCents", "confidence", "on"].includes(k))) && B.scenarios.base.uses[0].unitCents === 1200000, B.scenarios.base.uses);
ok("…a malformed line (a string, a number, null, an array) is dropped — never passed through", await (async () => {
  const r = (await q1(`select public.vision_share_baseline($1::jsonb) v`, [JSON.stringify({ scenarios: { base: { uses: [line(1, "m"), "not-an-object", 42, null, [SECRET("line-array")], true] } } })])).v;
  return r.scenarios.base.uses.length === 1 && !/INTERNAL-|SUPPLIER-/.test(txt(r)); })());
ok("…a channel and a mix line keep their named fields only", B.scenarios.base.channels.every((c) => Object.keys(c).sort().join() === "convertPct,costCents,kind,label,reach,startMonth") && B.scenarios.base.mix.every((m) => Object.keys(m).every((k) => ["key", "label", "sharePct", "priceCents", "unitCostCents", "packagingCents"].includes(k))));
ok("…structure keeps the investor terms only", Object.keys(B.structure).sort().join() === "amountCents,capMultiple,kind,sharePct", B.structure);
ok("…an owner's risk acceptance keeps key, note, at, reviewBy — junk dropped", B.acknowledged.length === 1 && Object.keys(B.acknowledged[0]).sort().join() === "at,key,note,reviewBy");
ok("research and risks by their named fields too", g(fNow).research.every((r) => !("draftNotes" in r)) && Object.keys(g(fNow).risks[0]).sort().join() === "evidence,impact,kind,likelihood,mitigation,status,words", g(fNow).risks);
ok("a named field holding an object or an array is not sent (a field can't smuggle a structure)", await (async () => {
  const r = (await q1(`select public.vision_share_baseline($1::jsonb) v`, [JSON.stringify({ scenarios: { base: { ordersPerDay: { hidden: 1 }, uses: [{ label: { hidden: 1 }, qty: [1] }] } }, structure: { kind: ["x"] }, acknowledged: [{ note: { hidden: 1 } }] })])).v;
  return !("ordersPerDay" in r.scenarios.base) && Object.keys(r.scenarios.base.uses[0]).length === 0 && r.structure.kind === undefined && Object.keys(r.acknowledged[0]).length === 0; })());
ok("not objects at all: scenarios as a list, uses as an object, a baseline as a string — nothing unnamed comes out", await (async () => {
  const r = (await q1(`select public.vision_share_baseline('{"scenarios":["x"],"structure":"y","acknowledged":{"a":1}}'::jsonb) v`)).v;
  const s = (await q1(`select public.vision_share_baseline('{"scenarios":{"base":{"uses":{"a":1},"mix":"m","channels":7}}}'::jsonb) v`)).v;
  const t = (await q1(`select public.vision_share_baseline('"a string"'::jsonb) v`)).v;
  return Object.keys(r.scenarios).length === 0 && r.structure.kind === "none" && r.acknowledged.length === 0 && s.scenarios.base.uses.length === 0 && s.scenarios.base.mix.length === 0 && s.scenarios.base.channels.length === 0 && t === null; })());

// ── The investor case is exactly what it was ───────────────────────────────────────────────────────────────────────
const figs = (v) => { const p = g(v); const c = DATA.toCase(p.money, p.research ?? [], p.risks ?? []); const f = CASE.figuresOf(c); return { models: f.models, scores: f.scores, irrPct: f.irrPct, base: f.base, risks: c.risks, ack: c.acknowledged, research: c.research }; };
ok("the investor case's figures — every month of every scenario, the score, the IRR, the trace — are unchanged", txt(figs(fNow)) === txt(figs(before)), [figs(fNow).irrPct, figs(before).irrPct]);
ok("…for the link given before as well (its own pinned version)", txt(figs(fOld)) === txt(figs(beforeOld)) && g(fOld).money.version === 1 && g(fNow).money.version === 2);
ok("…and the risk disclosures and the owner's risk acceptance read the same", txt(figs(fNow).risks) === txt(figs(before).risks) && txt(figs(fNow).ack) === txt(figs(before).ack) && figs(fNow).risks.length === 1 && figs(fNow).ack.length === 1);
ok("…the room still draws: its size and its things", fNow.layouts[0].width_in > 0 && fNow.layouts[0].items.length > 0);
ok("the approved versions themselves are untouched — filtered on the way out, never rewritten", txt(await q(`select id, md5(baseline::text) b, md5(research::text) r, md5(risks::text) k from public.vision_plan_versions order by id`)) === txt(versionsBefore));

// ── Every field the money engine has is decided: sent by name, or deliberately not ─────────────────────────────────
const fn = M463.slice(M463.indexOf("create or replace function public.vision_share_scenario(v jsonb)"));
const named = [...(fn.match(/vision_share_keep\(v, array\[([^\]]*)\]/) ?? [])[1]?.matchAll(/'([A-Za-z]+)'/g) ?? []].map((m) => m[1]);
const NOT_SENT = ["fixtures"];   // IMS7-D's reconciliation: the crew's
const lists = ["uses", "channels", "mix"];
const engine = Object.keys(MONEY.BLANK);
ok("every money input is either named for investors or named as not sent — a new engine field fails here until it's decided", engine.every((k) => named.includes(k) || lists.includes(k) || NOT_SENT.includes(k)) && named.every((k) => engine.includes(k)), engine.filter((k) => !named.includes(k) && !lists.includes(k) && !NOT_SENT.includes(k)));
ok("…a startup line's fields: everything the money engine reads is named; source, notes and the library link are not", ["id", "label", "category", "qty", "unitCents", "confidence", "on"].every((k) => fn.includes(`'${k}'`)) && !/'source'|'notes'|'libraryId'/.test(fn.slice(0, fn.indexOf("create or replace function public.vision_share_baseline"))));

// ── Links that aren't live, and doors that aren't the link ──────────────────────────────────────────────────────────
const other = await mk("Another business's link", "0 seconds", T2);
const otherView = await door(other.token);
ok("another business's link shows only that business — never this one's plans, money or rooms", !otherView.error && !otherView.plans.some((p) => p.id === gym) && !/INTERNAL-|Espresso bar/.test(txt(otherView)) && otherView.layouts.length === 0);
await q(`update public.vision_shares set expires_at = now() - interval '1 minute' where id = $1`, [older.id]);
ok("an expired link is refused (PT404), sending nothing", (await door(older.token)).code === "PT404");
await q(`update public.vision_shares set revoked_at = now() where id = $1`, [fresh.id]);
ok("a revoked link is refused (PT404)", (await door(fresh.token)).code === "PT404");
ok("malformed, wrong, short and null tokens are refused (PT404)", (await door("f".repeat(64))).code === "PT404" && (await door("short")).code === "PT404" && (await door(null)).code === "PT404" && (await door(`${fresh.token}' or '1'='1`)).code === "PT404");
for (const f of ["vision_share_baseline('{}'::jsonb)", "vision_share_scenario('{}'::jsonb)", "vision_share_keep('{}'::jsonb, array['a'])", "vision_share_list('[]'::jsonb, array['a'])"])
  ok(`nobody calls ${f.split("(")[0]} directly`, !!(await anon(`select public.${f} v`)).error);
ok("…or reads the approved versions, the money or the research behind the link", ((r) => r.error || r.length === 0)(await anon(`select baseline from public.vision_plan_versions`))
  && ((r) => r.error || r.length === 0)(await anon(`select * from public.vision_plan_money`)) && ((r) => r.error || r.length === 0)(await anon(`select * from public.vision_research`)));
// The live check in the manifest, as the investor reads it: anon, through vision_shared, inside a transaction undone.
const liveCheck = await (async () => { const t = (await mk("Verification link", "0 seconds")).token;
  await db.exec(`begin; set local role anon;`);
  try { return (await db.query(`select jsonb_path_exists(public.vision_shared($1), 'strict $.**.source') s, jsonb_path_exists(public.vision_shared($1), 'strict $.**.notes') n, jsonb_path_exists(public.vision_shared($1), 'strict $.**.libraryId') l`, [t])).rows[0]; }
  finally { await db.exec(`rollback;`); } })();
ok("the manifest's live check (anon, through the link, rolled back) says false, false, false", liveCheck.s === false && liveCheck.n === false && liveCheck.l === false, liveCheck);

// Without 0463 at all (pasted on its own): the same door, the same allow-list.
{
  const d2 = await fullSchema({ before: "0463" });
  await d2.exec(`grant usage on schema public to anon, authenticated, service_role;`);
  await d2.exec(M463);
  const p2 = (await d2.query(`select id from public.vision_plans order by phase limit 1`)).rows[0].id;
  await d2.query(`update public.vision_plans set shareable = true`);
  await d2.query(`insert into public.vision_plan_versions (plan_id, version, baseline, approved_at) values ($1, 1, $2::jsonb, now() - interval '1 hour')`, [p2, JSON.stringify(baseline("solo"))]);
  const t2 = (await d2.query(`insert into public.vision_shares (label, money_plans) values ('Solo', array[$1::uuid]) returning token`, [p2])).rows[0].token;
  await d2.exec(`set role anon;`);
  const v2 = (await d2.query(`select public.vision_shared($1) v`, [t2])).rows[0].v;
  await d2.exec(`reset role;`);
  ok("applied without 0463 (on 0462): the same allow-list through the same door", !/INTERNAL-|SUPPLIER-|libraryId/.test(txt(v2)) && v2.plans.find((p) => p.id === p2).money.baseline.scenarios.base.uses.length === 2);
  await d2.close();
}

console.log(`IMS7 — A LINK SENDS NAMED FIELDS ONLY (0464, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
