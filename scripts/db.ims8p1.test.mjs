// IMS8 P1 — THE OWNER'S PREVIEW AND THE INVESTOR'S LINK ARE THE SAME THING (in Postgres). For the same link, the
// anonymous investor's response (vision_shared) and the owner's preview (vision_share_preview) map — through the one
// mapping the screens use, toVision — to the identical Vision: every program, plan, need, ask, room, and the case's
// figures. And the investor path's components read nothing behind the link (scripts/ims8p1.test.mjs, the source side).
import { fullSchema } from "./fixtures/schema.full.mjs";
import { loadTs } from "./search.read.mjs";

const V = loadTs("lib/visionRead.ts"), CASE = loadTs("lib/visionCase.ts");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 400)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001", OWNER = "0c46a000-0000-4000-8000-0000000000a1";
const db = await fullSchema({});
const q = async (s, p) => (await db.query(s, p)).rows, q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
await q(`insert into auth.users (id, email) values ($1, 'owner@example.test')`, [OWNER]);
await q(`update public.profiles set role = 'owner', tenant_id = $2 where id = $1`, [OWNER, T1]);
const as = async (sql, p) => { await db.exec(`select set_config('request.jwt.claim.sub', '${OWNER}', false); set role authenticated;`); try { return (await db.query(sql, p)).rows; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); } };
const door = async (t) => { await db.exec(`set role anon;`); try { return (await db.query(`select public.vision_shared($1) v`, [t])).rows[0].v; } finally { await db.exec(`reset role;`); } };

// The seed's plans, one shown with needs, money, research and risks; a room.
const plan = await q1(`select id, program_id from public.vision_plans where tenant_id = $1 order by phase limit 1`, [T1]);
await q(`update public.vision_plans set shareable = true where id = $1`, [plan.id]);
const room = (await q1(`select id from public.store_layouts where tenant_id = $1 order by created_at limit 1`, [T1])).id;
await q(`insert into public.vision_plan_needs (plan_id, label, due_on) values ($1, 'Choose the gym', '2026-12-01'), ($1, 'Health permit', null)`, [plan.id]);
await q(`insert into public.vision_asks (program_id, plan_id, label, amount_cents, note) values ($1, $2, 'Build-out', 0, 'Set the amount.')`, [plan.program_id, plan.id]);
const scen = { ordersPerDay: 110, avgOrderCents: 900, daysOpenPerMonth: 26, hoursOpenPerDay: 10, cogsPct: 30, cardFeePct: 3, staffHoursPerDay: 20, wageCents: 1600, rentCents: 450000, ownerCashCents: 2000000,
  uses: [{ id: "l1", label: "Espresso-free bar", category: "equipment", qty: 1, unitCents: 1200000, confidence: "quoted", on: "2026-10-01" }, { id: "l2", label: "Reserve", category: "reserve", qty: 1, unitCents: 3000000 }] };
await q(`insert into public.vision_plan_versions (plan_id, version, baseline, research, risks, approved_at) values ($1, 1, $2::jsonb, $3::jsonb, $4::jsonb, now() - interval '1 hour')`,
  [plan.id, JSON.stringify({ scenarios: { conservative: { ...scen, ordersPerDay: 80 }, base: scen, upside: { ...scen, ordersPerDay: 140 } }, structure: { kind: "rev_share", amountCents: 4000000, sharePct: 6, capMultiple: 1.5 }, acknowledged: [{ key: "no_downside", note: "Said.", at: "2026-10-20", reviewBy: "2099-12-01" }] }),
   JSON.stringify([{ topic: "demand", claim: "1,200 members a day.", figure: "1,200", source_url: "https://x.example", source_title: "Count", bearing: "for", retrieved_at: "2026-10-01" }]),
   JSON.stringify([{ kind: "risk", words: "Footfall drops in summer.", likelihood: "medium", impact: "high", mitigation: "Events.", status: "open" }])]);
const link = (await as(`insert into public.vision_shares (label, program_ids, plan_ids, need_plans, layout_ids, money_plans, research_plans, show_asks) values ('Equivalence', $1, $2, $2, $3, $2, $2, true) returning id, token`, [[plan.program_id], [plan.id], [room]]))[0];

const preview = (await as(`select public.vision_share_preview($1, null) v`, [link.id]))[0].v;
const investor = await door(link.token);
const a = V.toVision(investor), b = V.toVision(preview);
ok("the investor's response and the owner's preview are byte-identical for the same link", JSON.stringify(investor) === JSON.stringify(preview));
ok("…and map to the identical Vision the screens draw (programs, plans, needs, asks, rooms, cases)", JSON.stringify(a) === JSON.stringify(b));
ok("…which holds what the link was given: 1 program, 1 plan, its needs (and no other plan's), its ask, 1 room with things, the plan's case", a.programs.length === 1 && a.plans.length === 1 && a.needs.length >= 2 && a.needs.every((n) => n.plan_id === plan.id) && a.asks.some((x) => x.label === "Build-out") && a.layouts.length === 1 && a.layouts[0].items.length > 0 && !!a.cases?.[plan.id],
  { programs: a.programs.length, plans: a.plans.length, needs: a.needs.length, asks: a.asks.length, rooms: a.layouts.length });
const fa = CASE.figuresOf(a.cases[plan.id]), fb = CASE.figuresOf(b.cases[plan.id]);
ok("…and the case's figures (every month, every scenario, score, IRR, the investor's return) are identical", JSON.stringify({ m: fa.models, s: fa.scores, i: fa.irrPct, v: fa.inv }) === JSON.stringify({ m: fb.models, s: fb.scores, i: fb.irrPct, v: fb.inv }));
ok("…the case's risks — what CaseWords now draws on a link — come from the response", a.cases[plan.id].risks.length === 1 && a.cases[plan.id].risks[0].words === "Footfall drops in summer.");
ok("…and the risk acceptance is read with its review date (0467's correction), so the score sees it", a.cases[plan.id].acknowledged[0]?.reviewBy === "2099-12-01" && fa.scores.base.blockers.every((x) => x.key !== "no_downside" || x.status === "risk_accepted"));
ok("the preview counted no open; the investor's read counted one", (await q1(`select opens::int o from public.vision_shares where id = $1`, [link.id])).o === 1);
console.log(`IMS8 P1 — THE OWNER'S PREVIEW AND THE INVESTOR'S LINK ARE THE SAME THING (in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
