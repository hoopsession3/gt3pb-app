// IMS7 — A LINK SENDS WHAT IT WAS GIVEN (0467, over 0464), IN POSTGRES. Through the real door (vision_shared, as an
// anonymous investor): a link returns only the programs, plans, needs, asks and rooms explicitly given to THAT link —
// not every plan the business marked to show, not every plan of a program it was given. Existing links keep exactly the
// plans an owner chose for them by name; pins and approved versions are untouched; the investor case's figures are what
// they were. Fields no investor screen reads are gone. Unexpected and malformed data can't ride along. Revoked, expired,
// malformed and other-business links stay shut. The pre-share preview IS the response (one function), for owners and
// admins only. Logs carry counts and key names — never a value typed into the plan.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";
import { loadTs } from "./search.read.mjs";
// 0474: a dead link ANSWERS { live: false } (so the database can count the miss) where 0447–0473 raised PT404 "isn't live".
// Both mean the same to a reader; the door helper reads them the same, and db.ims8sec / ims8app pin the new shape.
const dead = (v) => (v && v.live === false ? { code: "PT404", error: "This link isn't live. (0474: answered, not raised)" } : v);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M = readFileSync(join(ROOT, "supabase/migrations/0467_a_link_sends_what_it_was_given.sql"), "utf8");
const CASE = loadTs("lib/visionCase.ts"), DATA = loadTs("lib/visionCaseData.ts");
let pass = 0, fail = 0;
// A failure prints key names and counts only — never a value from the plan (Ryan: "without exposing confidential values in test logs").
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001", T2 = "0c467000-0000-4000-8000-0000000000b2";
const OWNER = "0c467000-0000-4000-8000-0000000000a1", ADMIN = "0c467000-0000-4000-8000-0000000000a2", CREW = "0c467000-0000-4000-8000-0000000000a3", OTHER_OWNER = "0c467000-0000-4000-8000-0000000000a4";

const db = await fullSchema({ before: "0467" });   // 0463 and 0464 applied, as they'll be in production
const q = async (s, p) => (await db.query(s, p)).rows, q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
const door = async (t) => { await db.exec(`set role anon;`); try { return dead((await db.query(`select public.vision_shared($1) v`, [t])).rows[0].v); } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role;`); } };
const as = async (uid, sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const anonSql = async (sql, p) => { await db.exec(`set role anon;`); try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role;`); } };

// ── People ──────────────────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'other-business', 'Other business'); commit;`);
for (const [id, role, t] of [[OWNER, "owner", T1], [ADMIN, "admin", T1], [CREW, "server", T1], [OTHER_OWNER, "owner", T2]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, t]);
}

// ── The world: two programs, plans in and out of each, needs, asks, deps, rooms; markers in every free-text field ─────
const X = (w) => `MARK-${w}`;   // a marker: its presence or absence is tested; its value is never printed
const prog = async (title, t = T1) => (await q1(`insert into public.vision_programs (tenant_id, title, summary, why) values ($1, $2, $3, $4) returning id`, [t, X(title), X(`${title}-summary`), X(`${title}-why`)])).id;
const roomOf = async (name, t = T1) => (await q1(`insert into public.store_layouts (tenant_id, name) values ($1, $2) returning id`, [t, X(name)])).id;
const tmpl = (await q1(`select format, phase, status from public.vision_plans limit 1`));
const plan = async (name, program, shareable, layout = null, t = T1) => (await q1(`insert into public.vision_plans (tenant_id, program_id, name, format, phase, status, shareable, layout_id, summary, why, gate, place, customer, market, positioning)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
  [t, program, X(name), tmpl.format, tmpl.phase, tmpl.status, shareable, layout, X(`${name}-summary`), X(`${name}-why`), X(`${name}-gate`), X(`${name}-place`), X(`${name}-customer`), X(`${name}-market`), X(`${name}-positioning`)])).id;
const R1 = await roomOf("room-on-link"), R2 = await roomOf("room-not-on-link");
const P1 = await prog("program-on-link"), P2 = await prog("program-not-on-link");
await q(`update public.vision_programs set layout_id = $2 where id = $1`, [P1, R2]);   // P1 points at a room the link isn't given
const A = await plan("plan-A-given", P1, true, R1), B = await plan("plan-B-same-program-not-given", P1, true, R2), C = await plan("plan-C-other-program", P2, true),
  D = await plan("plan-D-given-not-shareable", P1, false), E = await plan("plan-E-given-program-not-given", P2, true);
const PT2 = await prog("other-business-program", T2), F2 = await plan("plan-other-business", PT2, true, null, T2);
for (const [p, w] of [[A, "A"], [B, "B"], [C, "C"]]) await q(`insert into public.vision_plan_needs (tenant_id, plan_id, label) values ($1, $2, $3)`, [T1, p, X(`need-${w}`)]);
await q(`insert into public.vision_plan_deps (tenant_id, plan_id, needs_plan_id) values ($1, $2, $3), ($1, $2, $4)`, [T1, A, B, C]);
const ask = async (program, planId, w, t = T1) => q(`insert into public.vision_asks (tenant_id, program_id, plan_id, label, note, amount_cents) values ($1, $2, $3, $4, $5, 100000)`, [t, program, planId, X(`ask-${w}`), X(`ask-note-${w}`)]);
await ask(P1, null, "P1"); await ask(P2, null, "P2"); await ask(P1, A, "A"); await ask(P1, B, "B"); await ask(P2, C, "C");

// Approved money, research, risks for A and B — unknown fields at every depth, a malformed line, a malformed channel.
const LIB = "0c467000-0000-4000-8000-00000000f1b0";
const line = (c, t) => ({ id: `l-${t}`, label: X(`line-${t}`), category: "equipment", qty: 2, unitCents: c, confidence: "quoted", on: "2026-10-01", source: X("line-source"), notes: X("line-notes"), libraryId: LIB, extra: X("line-extra"), nest: { a: X("line-nest") } });
const sc = (t, o) => ({ uses: [line(1200000, t), { id: `r-${t}`, label: "Reserve", category: "reserve", qty: 1, unitCents: 3000000 }],
  ordersPerDay: o, avgOrderCents: 900, daysOpenPerMonth: 26, hoursOpenPerDay: 10, rampMonths: 4, rampStartPct: 60, growthPctPerYear: 5, cogsPct: 30, cardFeePct: 3, staffHoursPerDay: 20, wageCents: 1600,
  laborBurdenPct: 12, rentCents: 450000, rentPctOfSales: 0, otherOpexCents: 120000, marketingCents: 80000, ownerCashCents: 2000000, repeatPerMonth: 1.5, keptPct: 60, peakFactor: 1.8, slowFactor: 0.4, serveSec: 90,
  demandFrom: "channels", capToRoom: false, mixDrives: true, itemsPerOrder: 1.2,
  channels: [{ kind: "local", label: X("channel-label"), reach: 3000, convertPct: 4, costCents: 0, startMonth: 1, contact: X("channel-contact") }, "junk-channel"],
  mix: [{ key: "cold-brew", label: X("mix-label"), sharePct: 60, priceCents: 600, unitCostCents: 120, packagingCents: 30, recipe: X("recipe") }, { key: "tonic", label: "Tonic", sharePct: 40, priceCents: 700, unitCostCents: 150, packagingCents: 40 }],
  fixtures: { [LIB]: "incremental" }, extra: X("scenario-extra"), nest: { a: X("scenario-nest") } });
const bl = (t) => ({ scenarios: { conservative: sc(`${t}c`, 80), base: sc(t, 110), upside: sc(`${t}u`, 140), internalCase: sc(X("case-name"), 999) },
  structure: { kind: "rev_share", amountCents: 4000000, sharePct: 6, capMultiple: 1.5, side: X("structure-extra"), terms: { a: X("structure-nest") } },
  acknowledged: [{ key: "no_downside", note: X("ack-note"), at: "2026-10-20", reviewBy: "2026-12-01", extra: X("ack-extra") }], extra: X("baseline-extra") });
const RES = (v) => JSON.stringify([{ topic: "demand", claim: X(`claim-${v}`), figure: "1,200 a day", source_url: "https://x.example", source_title: X("source-title"), published: X("published"), bearing: "for", retrieved_at: "2026-10-01", extra: X("research-extra"), nest: { a: 1 } }, "junk-finding"]);
const RSK = (v) => JSON.stringify([{ kind: "risk", words: X(`risk-${v}`), likelihood: "medium", impact: "high", mitigation: X("mitigation"), evidence: X("evidence"), status: "open", extra: X("risk-extra") }]);
for (const p of [A, B]) await q(`insert into public.vision_plan_versions (plan_id, version, baseline, research, risks, approved_at) values ($1, 1, $2::jsonb, $3::jsonb, $4::jsonb, now() - interval '3 days'), ($1, 2, $5::jsonb, $6::jsonb, $7::jsonb, now() - interval '1 hour')`,
  [p, JSON.stringify(bl("v1")), RES("v1"), RSK("v1"), JSON.stringify(bl("v2")), RES("v2"), RSK("v2")]);
const versionsBefore = await q(`select id, md5(baseline::text) b, md5(research::text) r, md5(risks::text) k from public.vision_plan_versions order by id`);

// Links made before 0467: one given A's money and B's research (P1, R1, asks on); one given two days ago, money of A, pinned at v1.
const mk = async (o) => q1(`insert into public.vision_shares (tenant_id, label, program_ids, layout_ids, money_plans, research_plans, show_asks, pinned_at${o.plan_ids ? ", plan_ids, need_plans" : ""})
  values ($1, $2, $3::uuid[], $4::uuid[], $5::uuid[], $6::uuid[], $7, now() - $8::interval${o.plan_ids ? ", $9::uuid[], $10::uuid[]" : ""}) returning id, token, pinned_at`,
  [o.tenant ?? T1, o.label ?? "A link", o.programs ?? [], o.rooms ?? [], o.money ?? [], o.research ?? [], o.asks ?? true, o.ago ?? "0 seconds", ...(o.plan_ids ? [o.plan_ids, o.needs ?? []] : [])]);
const old1 = await mk({ label: "old-1", programs: [P1], rooms: [R1], money: [A], research: [B] });
const old2 = await mk({ label: "old-2", programs: [P1, P2], rooms: [R1, R2], money: [A], ago: "2 days" });
const before1 = await door(old1.token), before2 = await door(old2.token);
const has = (v, m) => JSON.stringify(v).includes(X(m));
ok("before 0467 (the gap, measured): a link given program P1 carried plans it was never given — B (same program), C (another program) — and their needs and asks",
  has(before1, "plan-B-same-program-not-given") && has(before1, "plan-C-other-program") && has(before1, "need-B") && has(before1, "ask-C"),
  ["plan-B-same-program-not-given", "plan-C-other-program", "need-B", "ask-C"].map((m) => has(before1, m)));

// ── Apply 0467, twice ───────────────────────────────────────────────────────────────────────────────────────────────
await db.exec(M); await db.exec(M);
ok("0467 twice: recorded (applied twice), no error", (await q1(`select applied_count::int n from public.schema_migrations where version like '0467%'`)).n === 2);
const row = (id) => q1(`select plan_ids, need_plans, money_plans, research_plans, program_ids, layout_ids, pinned_at from public.vision_shares where id = $1`, [id]);
const r1 = await row(old1.id), r2 = await row(old2.id);
const same = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());
ok("existing link: keeps the plans an owner chose for it by name (A's money, B's research) — nothing else; no needs", same(r1.plan_ids, [A, B]) && r1.need_plans.length === 0 && same(r2.plan_ids, [A]) && r2.need_plans.length === 0, { r1: r1.plan_ids.length, r2: r2.plan_ids.length });
ok("…its pin, money, research, programs and rooms untouched", +r1.pinned_at === +old1.pinned_at && +r2.pinned_at === +old2.pinned_at && same(r1.money_plans, [A]) && same(r1.research_plans, [B]) && same(r2.program_ids, [P1, P2]));
ok("a second run doesn't redo the backfill (a link changed since keeps its change)", await (async () => { await q(`update public.vision_shares set plan_ids = '{}' where id = $1`, [old2.id]); await db.exec(M); const k = (await row(old2.id)).plan_ids.length === 0; await q(`update public.vision_shares set plan_ids = $2 where id = $1`, [old2.id, [A]]); return k; })());
ok("approved versions untouched", JSON.stringify(versionsBefore) === JSON.stringify(await q(`select id, md5(baseline::text) b, md5(research::text) r, md5(risks::text) k from public.vision_plan_versions order by id`)));

// ── The boundary ─────────────────────────────────────────────────────────────────────────────────────────────────────
const fresh = await mk({ label: "new", programs: [P1], rooms: [R1], money: [A, B], research: [A, B], plan_ids: [A, D, E, F2], needs: [A, B] });
const v = await door(fresh.token);
const ids = (xs) => (xs ?? []).map((x) => x.id);
ok("a new link given plan A (of program P1): exactly A — not B (same program), not C (another program)", same(ids(v.plans), [A]), { plans: v.plans?.length });
ok("…not D (given, but not marked to show), not E (given, but its program isn't), not another business's plan named on it", !has(v, "plan-D-given-not-shareable") && !has(v, "plan-E-given-program-not-given") && !has(v, "plan-other-business"));
ok("…money and research only for the plan it shows: B's, though on the link's money list, isn't sent", v.plans.length === 1 && v.plans[0].money?.version === 2 && v.plans[0].research?.length === 1 && !has(v, "plan-B-same-program-not-given"));
ok("needs: A's (ticked); B's ticked but B isn't shown — not sent; C's never", has(v, "need-A") && !has(v, "need-B") && !has(v, "need-C"));
ok("asks: P1's own and A's — not B's, not C's, not P2's", has(v, "ask-P1") && has(v, "ask-A") && !has(v, "ask-B") && !has(v, "ask-C") && !has(v, "ask-P2") && v.asks.length === 2, v.asks.length);
ok("waits_on: only plans the link shows (A waits on B and C — neither shown)", v.plans[0].waits_on.length === 0);
ok("programs: P1 only; rooms: R1 only, with its things; a room id it wasn't given is blanked (P1 points at R2)", same(ids(v.programs), [P1]) && same(ids(v.layouts), [R1]) && v.programs[0].layout_id === null && !has(v, "room-not-on-link") && v.plans[0].layout_id === R1);
const noAsks = await door((await mk({ programs: [P1], plan_ids: [A], asks: false })).token);
ok("asks off: none at all", noAsks.asks.length === 0);
const noNeeds = await door((await mk({ programs: [P1], plan_ids: [A] })).token);
ok("a plan without its needs ticked: its needs aren't sent", noNeeds.plans.length === 1 && noNeeds.plans[0].needs.length === 0 && !has(noNeeds, "need-A"));
const bare = await door((await mk({})).token);
ok("a link given nothing sends nothing of the plan (its own label and dates only)", bare.programs.length === 0 && bare.plans.length === 0 && bare.asks.length === 0 && bare.layouts.length === 0);

// Existing links, after.
const after1 = await door(old1.token), after2 = await door(old2.token);
ok("existing link (old-1): A and B (both chosen by name, both in P1); not C; no needs; B's research, A's money", same(ids(after1.plans), [A, B]) && !has(after1, "plan-C-other-program") && after1.plans.every((p) => p.needs.length === 0)
  && after1.plans.find((p) => p.id === A).money && !after1.plans.find((p) => p.id === B).money && after1.plans.find((p) => p.id === B).research?.length === 1);
ok("existing link (old-2, pinned two days ago): still v1", after2.plans.length === 1 && after2.plans[0].money.version === 1);

// ── Removed fields; unexpected and malformed data ───────────────────────────────────────────────────────────────────
for (const [n, x] of [["new link", v], ["existing link", after1], ["pinned link", after2]]) {
  ok(`${n}: no channel label, no publication date, no risk evidence — anywhere`, !has(x, "channel-label") && !has(x, "published") && !has(x, "evidence") && !JSON.stringify(x).includes('"evidence"') && !JSON.stringify(x).includes('"published"'));
  ok(`${n}: no unexpected field, nested structure, malformed element or other scenario name`, !/MARK-(line-source|line-notes|line-extra|line-nest|channel-contact|recipe|scenario-extra|scenario-nest|case-name|structure-extra|structure-nest|ack-extra|baseline-extra|research-extra|risk-extra)/.test(JSON.stringify(x))
    && !JSON.stringify(x).includes("junk-") && !JSON.stringify(x).includes(LIB));
}
const sv = v.plans[0].money.baseline.scenarios.base;
ok("…a channel keeps what the case is worked from (kind, reach, conversion, cost, start month); the malformed one is dropped", sv.channels.length === 1 && JSON.stringify(Object.keys(sv.channels[0]).sort()) === JSON.stringify(["convertPct", "costCents", "kind", "reach", "startMonth"]), Object.keys(sv.channels[0] ?? {}));

// The complete approved schema: every key at every depth, typed; nothing extra.
const P = "plain", SCEN = { ...Object.fromEntries(["ordersPerDay","avgOrderCents","daysOpenPerMonth","hoursOpenPerDay","rampMonths","rampStartPct","growthPctPerYear","cogsPct","cardFeePct","staffHoursPerDay","wageCents","laborBurdenPct","rentCents","rentPctOfSales","otherOpexCents","marketingCents","ownerCashCents","repeatPerMonth","keptPct","peakFactor","slowFactor","serveSec","demandFrom","capToRoom","mixDrives","itemsPerOrder"].map((k) => [k, P])),
  uses: [{ id: P, label: P, category: P, qty: P, unitCents: P, confidence: P, on: P }], channels: [{ kind: P, reach: P, convertPct: P, costCents: P, startMonth: P }], mix: [{ key: P, label: P, sharePct: P, priceCents: P, unitCostCents: P, packagingCents: P }] };
export const SCHEMA_0467 = { label: "s|z", show_asks: "b", expires_at: "s|z", pinned_at: "s",
  programs: [{ id: "s", lane: "s|z", title: "s|z", summary: "s|z", why: "s|z", pillars: "strings|z", horizon: "s|z", status: "s|z", start_on: "s|z", target_on: "s|z", emoji: "s|z", layout_id: "s|z", sort: "n|z" }],
  asks: [{ program_id: "s|z", plan_id: "s|z", label: "s|z", amount_cents: "n|z", state: "s|z", note: "s|z", sort: "n|z" }],
  plans: [{ id: "s", program_id: "s|z", name: "s|z", format: "s|z", phase: "n|z", status: "s|z", sqft: "n|z", deal: "s|z", place: "s|z", summary: "s|z", why: "s|z", gate: "s|z", layout_id: "s|z", sort: "n|z", customer: "s|z", market: "s|z", positioning: "s|z",
    needs: [{ label: "s|z", kind: "s|z", due_on: "s|z", done_on: "s|z", sort: "n|z" }], waits_on: "strings",
    money: { "?null": true, baseline: { scenarios: { "?map": ["conservative", "base", "upside"], value: SCEN }, structure: Object.fromEntries(["kind","amountCents","aprPct","termMonths","sharePct","capMultiple","ownershipPct","payoutPct","capCents","discountPct"].map((k) => [k, P])), acknowledged: [{ key: P, note: P, at: P, reviewBy: P }] }, approved_at: "s|z", version: "n|z" },
    research: { "?nullarr": [{ topic: P, claim: P, figure: P, source_url: P, source_title: P, bearing: P, retrieved_at: P }] },
    risks: { "?nullarr": [{ kind: P, words: P, likelihood: P, impact: P, mitigation: P, status: P }] } }],
  layouts: [{ id: "s", name: "s|z", width_in: "n|z", depth_in: "n|z", ceiling_in: "n|z", items: [{ id: "s", kind: "s|z", label: "s|z", x_in: "n|z", y_in: "n|z", rot: "n|z", w_in: "n|z", d_in: "n|z", h_in: "n|z", why: "s|z", pillars: "strings|z", sort: "n|z" }] }] };
const jt = (x) => x === null ? "z" : Array.isArray(x) ? "a" : typeof x === "string" ? "s" : typeof x === "number" ? "n" : typeof x === "boolean" ? "b" : "o";
const schemaFaults = (val) => { const bad = [];
  const check = (x, s, path) => {
    if (typeof s === "string") { const fine = s === P ? ["s", "n", "b", "z"].includes(jt(x)) : s.split("|").some((t) => t === "strings" ? Array.isArray(x) && x.every((y) => typeof y === "string") : jt(x) === t); if (!fine) bad.push(`${path}: ${jt(x)}`); return; }
    if (Array.isArray(s)) { if (!Array.isArray(x)) { bad.push(`${path}: not an array`); return; } x.forEach((y) => check(y, s[0], `${path}[]`)); return; }
    if (s["?nullarr"]) { if (x === null) return; return check(x, s["?nullarr"], path); }
    if (s["?map"]) { if (jt(x) !== "o") { bad.push(`${path}: not an object`); return; } for (const k of Object.keys(x)) { if (!s["?map"].includes(k)) bad.push(`${path}.<unexpected scenario>`); else check(x[k], s.value, `${path}.${k}`); } return; }
    if (x === null && s["?null"]) return;
    if (jt(x) !== "o") { bad.push(`${path}: ${jt(x)} not an object`); return; }
    for (const k of Object.keys(x)) if (!(k in s)) bad.push(`${path}.${k}: not approved`);
    for (const k of Object.keys(s)) if (!k.startsWith("?") && s[k] !== P && !(k in x)) bad.push(`${path}.${k}: missing`);
    for (const k of Object.keys(x)) if (k in s) check(x[k], s[k], `${path}.${k}`);
  };
  check(val, SCHEMA_0467, "$"); return [...new Set(bad)]; };
for (const [n, x] of [["new link", v], ["existing link", after1], ["pinned link", after2], ["asks off", noAsks], ["a link given nothing", bare]]) ok(`${n}: the response matches the complete approved schema — every key, every type, nothing more`, schemaFaults(x).length === 0, schemaFaults(x).slice(0, 8));
ok("control: the schema check fails on 0464's response (it carried published and evidence)", schemaFaults(before1).length > 0);

// ── The investor case's figures, unchanged ──────────────────────────────────────────────────────────────────────────
const figs = (val, id) => { const p = val.plans.find((x) => x.id === id); const c = DATA.toCase(p.money, p.research ?? [], p.risks ?? []); const f = CASE.figuresOf(c);
  return JSON.stringify({ m: f.models, s: f.scores, i: f.irrPct, b: f.base, r: c.risks.map((x) => ({ ...x, evidence: undefined })), a: c.acknowledged }); };
ok("A's case on an existing link: every month of every scenario, the score, IRR, risks and acknowledgement — identical to 0464's", figs(before1, A) === figs(after1, A));
ok("…on the link pinned two days ago (v1): identical", figs(before2, A) === figs(after2, A));
const likeOld = await door((await mk({ programs: [P1], plan_ids: [A], money: [A] })).token);
ok("…and on a new link given the same (A, its money): identical", figs(after1, A) === figs(likeOld, A));

// ── Shut doors ──────────────────────────────────────────────────────────────────────────────────────────────────────
const other = await mk({ tenant: T2, label: "other", programs: [PT2, P1], rooms: [R1], plan_ids: [F2, A], needs: [F2, A], money: [A], research: [A] });
const ov = await door(other.token);
ok("another business's link naming this business's program, plan and room: only its own plan; nothing of this one", same(ids(ov.plans), [F2]) && same(ids(ov.programs), [PT2]) && ov.layouts.length === 0 && !/MARK-(plan-A|program-on-link|room-on-link|ask-|need-A|claim|risk-)/.test(JSON.stringify(ov)));
await q(`update public.vision_shares set expires_at = now() - interval '1 minute' where id = $1`, [old2.id]);
ok("expired: PT404", (await door(old2.token)).code === "PT404");
await q(`update public.vision_shares set revoked_at = now() where id = $1`, [old1.id]);
ok("revoked: PT404", (await door(old1.token)).code === "PT404");
const codes = []; for (const t of ["f".repeat(64), "short", null, "", `${fresh.token}' or '1'='1`, fresh.token.toUpperCase() === fresh.token ? `${fresh.token}x` : fresh.token.toUpperCase(), " ".repeat(40)]) codes.push((await door(t)).code);
ok("malformed, wrong, short, null, empty, injection-shaped, wrong-case, whitespace tokens: PT404", codes.every((c) => c === "PT404"), codes);
ok("nobody calls the payload or the helpers directly (anon, signed-in)", !!(await anonSql(`select public.vision_share_payload(s) from public.vision_shares s limit 1`)).error && !!(await as(OWNER, `select public.vision_share_payload(s) from public.vision_shares s limit 1`)).error
  && !!(await anonSql(`select public.vision_share_scenario('{}'::jsonb)`)).error && !!(await as(OWNER, `select public.vision_share_scenario('{}'::jsonb)`)).error);
ok("anon can't read the links, the versions, the money or the research directly", (await Promise.all([`vision_shares`, `vision_plan_versions`, `vision_plan_money`, `vision_research`].map((t) => anonSql(`select * from public.${t}`)))).every((r) => r.error || r.length === 0));

// ── The preview IS the response ─────────────────────────────────────────────────────────────────────────────────────
const fresh2 = await mk({ label: "for preview", programs: [P1], rooms: [R1], money: [A], research: [A], plan_ids: [A], needs: [A] });
const pv = await as(OWNER, `select public.vision_share_preview($1, null) v`, [fresh2.id]);
const opensBefore = (await q1(`select opens from public.vision_shares where id = $1`, [fresh2.id])).opens;
const real = await door(fresh2.token);
ok("an owner's preview of a link equals what the link sends, key for key and value for value", !pv.error && JSON.stringify(pv[0].v) === JSON.stringify(real), pv.error);
ok("…and a preview counts no open", opensBefore === 0);
const draft = { label: "draft", program_ids: [P1], layout_ids: [R1], plan_ids: [A], need_plans: [A], money_plans: [A], research_plans: [A], show_asks: true };
const dv = await as(OWNER, `select public.vision_share_preview(null, $1::jsonb) v`, [JSON.stringify(draft)]);
const made = await as(OWNER, `insert into public.vision_shares (label, program_ids, layout_ids, plan_ids, need_plans, money_plans, research_plans, show_asks) values ('draft', $1, $2, $3, $4, $5, $6, true) returning token`, [[P1], [R1], [A], [A], [A], [A]]);
const madeV = await door(made[0].token);
const noPin = (x) => JSON.stringify({ ...x, pinned_at: null, expires_at: null });
ok("a draft's preview equals what the link sends once it's made from the same choices (its pin aside)", !dv.error && !made.error && noPin(dv[0].v) === noPin(madeV), dv.error ?? made.error);
const adminDraft = await as(ADMIN, `select public.vision_share_preview(null, $1::jsonb) v`, [JSON.stringify(draft)]);
ok("an admin's draft carries no money or research (only an owner may give a link those, 0451)", !adminDraft.error && adminDraft[0].v.plans.length === 1 && adminDraft[0].v.plans[0].money === null && adminDraft[0].v.plans[0].research === null, adminDraft.error);
ok("the crew can't preview (PT403); nor can anyone signed out", (await as(CREW, `select public.vision_share_preview($1, null)`, [fresh2.id])).code === "PT403" && !!(await anonSql(`select public.vision_share_preview($1, null)`, [fresh2.id])).error);
ok("another business's owner can't preview this business's link (PT404), and their draft naming this business's plan gets nothing of it",
  (await as(OTHER_OWNER, `select public.vision_share_preview($1, null)`, [fresh2.id])).code === "PT404"
  && await (async () => { const r = await as(OTHER_OWNER, `select public.vision_share_preview(null, $1::jsonb) v`, [JSON.stringify(draft)]); return !r.error && r[0].v.plans.length === 0 && r[0].v.programs.length === 0 && r[0].v.layouts.length === 0; })());
ok("a malformed draft (not an object, unknown keys) previews nothing, without error", await (async () => { const r = await as(OWNER, `select public.vision_share_preview(null, '"x"'::jsonb) v`); const r2 = await as(OWNER, `select public.vision_share_preview(null, '{"tenant_id":"${T2}","plan_ids":["${A}"],"zzz":1}'::jsonb) v`);
  return !r.error && r[0].v.plans.length === 0 && !r2.error && r2[0].v.plans.length === 0; })());

// ── vision_share_preview, the new privileged function: its definition, its doors ─────────────────────────────────────
const pf = await q1(`select p.prosecdef d, array_to_string(p.proconfig, ',') cfg, pg_get_userbyid(p.proowner) owner, p.proacl::text acl,
  has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u
  from pg_proc p where p.proname = 'vision_share_preview' and p.pronamespace = 'public'::regnamespace`);
ok("preview: SECURITY DEFINER, search_path pinned to public, owned by the database owner (the role that pastes it)", pf.d === true && pf.cfg === "search_path=public" && pf.owner === (await q1(`select current_user u`)).u, { d: pf.d, cfg: pf.cfg });
ok("preview: executable by signed-in callers only — not anon, not PUBLIC (no '=X' in its grants)", pf.a === false && pf.u === true && !/(^|[{,])=X/.test(pf.acl), { anon: pf.a, auth: pf.u });
await q(`insert into auth.users (id, email) values ('0c467000-0000-4000-8000-0000000000a5', 'member@example.test')`);
await q(`update public.profiles set role = 'member', tenant_id = $1 where id = '0c467000-0000-4000-8000-0000000000a5'`, [T1]);
ok("preview: a signed-in customer (member) is refused (PT403), for a link and for a draft", (await as("0c467000-0000-4000-8000-0000000000a5", `select public.vision_share_preview($1, null)`, [fresh2.id])).code === "PT403"
  && (await as("0c467000-0000-4000-8000-0000000000a5", `select public.vision_share_preview(null, $1::jsonb)`, [JSON.stringify(draft)])).code === "PT403");
ok("preview: an unknown link id is PT404 (not an empty answer that could be mistaken for a link)", (await as(OWNER, `select public.vision_share_preview('0c467000-0000-4000-8000-00000000dead', null)`)).code === "PT404");
const spoof = await as(OWNER, `select public.vision_share_preview(null, $1::jsonb) v`, [JSON.stringify({ ...draft, tenant_id: T2, pinned_at: "2099-01-01T00:00:00Z", expires_at: "2000-01-01T00:00:00Z", token: "x".repeat(64), revoked_at: "2000-01-01T00:00:00Z" })]);
ok("preview: a draft can't choose its business, its pin, its expiry or its state — the caller's business, pinned now", !spoof.error && spoof[0].v.plans.length === 1 && spoof[0].v.expires_at === null && Date.parse(spoof[0].v.pinned_at) <= Date.now() + 1000, spoof.error);
ok("preview: writes nothing (no link made, no open counted, nothing in the audit trail)", await (async () => { const n0 = (await q1(`select count(*)::int n, coalesce(sum(opens),0)::int o from public.vision_shares`)), a0 = (await q1(`select count(*)::int n from public.admin_audit`)).n;
  await as(OWNER, `select public.vision_share_preview(null, $1::jsonb)`, [JSON.stringify(draft)]); await as(OWNER, `select public.vision_share_preview($1, null)`, [fresh2.id]);
  const n1 = (await q1(`select count(*)::int n, coalesce(sum(opens),0)::int o from public.vision_shares`)), a1 = (await q1(`select count(*)::int n from public.admin_audit`)).n; return n0.n === n1.n && n0.o === n1.o && a0 === a1; })());

// ── Before / after, as a person can read it without a single value: counts and key names ─────────────────────────────
const shape = (x) => ({ programs: x.programs?.length ?? 0, plans: x.plans?.length ?? 0, needs: (x.plans ?? []).reduce((a, p) => a + (p.needs?.length ?? 0), 0), asks: x.asks?.length ?? 0, rooms: x.layouts?.length ?? 0,
  money: (x.plans ?? []).filter((p) => p.money).length, research: (x.plans ?? []).reduce((a, p) => a + (p.research?.length ?? 0), 0), risks: (x.plans ?? []).reduce((a, p) => a + (p.risks?.length ?? 0), 0) });
const keys = (x, path = "$", out = new Set()) => { if (Array.isArray(x)) x.forEach((y) => keys(y, `${path}[]`, out)); else if (x && typeof x === "object") for (const k of Object.keys(x)) { const p = path.endsWith(".scenarios") ? `${path}.<scenario>` : `${path}.${k}`; out.add(p); keys(x[k], p, out); } return out; };
const kb = keys(before1), ka = keys(after1);
console.log(`  · old-1 before → after: ${JSON.stringify(shape(before1))} → ${JSON.stringify(shape(after1))}`);
console.log(`  · old-1 key paths only before 0467: ${[...kb].filter((k) => !ka.has(k)).sort().join(", ") || "none"}`);
console.log(`  · old-1 key paths only after 0467: ${[...ka].filter((k) => !kb.has(k)).sort().join(", ") || "none"}`);
ok("before → after (old-1): plans 3 → 2 (C dropped), needs and others' asks gone, money and research as given", shape(before1).plans > shape(after1).plans && shape(after1).needs === 0 && shape(after1).money === shape(before1).money && shape(after1).research === 1);
const gone = [...kb].filter((k) => !ka.has(k) && !k.startsWith("$.plans[].needs[]"));
ok("…besides the needs no one ticked, the only key paths that disappear are the three retired fields", gone.length === 3 && gone.every((k) => /channels\[\]\.label$|research\[\]\.published$|risks\[\]\.evidence$/.test(k)), gone);

console.log(`IMS7 — A LINK SENDS WHAT IT WAS GIVEN (0467, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
