// IMS8 P5 — A LINK SENDS WHAT YOU REVIEWED (0472, in Postgres, through the real doors and grants). The publication
// contract: a link sends its published revision — the exact response reviewed — behind live gates that can only take
// away; words edited later wait for a republish; money stays pinned. Publish is the one door (direct INSERT refused,
// UPDATE only revoked_at), re-checks every authorization, refuses a changed response (PT409) and confirmations that
// aren't exactly the material findings (PT422), and stores what it fingerprinted — an edit landing mid-publish stays out.
// The server's material findings are lib/publishReadiness's, id for id. Logs here never print a token.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";
import { loadTs } from "./search.read.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const M = readFileSync(join(ROOT, "supabase/migrations/0472_a_link_sends_what_you_reviewed.sql"), "utf8");
const R = loadTs("lib/publishReadiness.ts"), SP = loadTs("lib/sharePreview.ts"), V = loadTs("lib/visionRead.ts"), CASE = loadTs("lib/visionCase.ts");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.replace(/[0-9a-f]{40,}/g, "<token>").slice(0, 600)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001", T2 = "0c46e000-0000-4000-8000-0000000000b2";
const OWNER = "0c46e000-0000-4000-8000-0000000000a1", ADMIN = "0c46e000-0000-4000-8000-0000000000a2", CREW = "0c46e000-0000-4000-8000-0000000000a3", OTHER = "0c46e000-0000-4000-8000-0000000000a4";
const noPin = (p) => { const { pinned_at, expires_at, ...rest } = p ?? {}; void pinned_at; void expires_at; return rest; };

async function setup(before) {
  const db = await fullSchema(before ? { before } : {});
  const q = async (s, p) => (await db.query(s, p)).rows, q1 = async (s, p) => (await q(s, p))[0];
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
  await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
  await db.exec(`begin; set local gt3.allow_second_tenant = 'on'; insert into public.tenants (id, slug, name) values ('${T2}', 'other-business', 'Other business'); commit;`);
  for (const [id, role, t] of [[OWNER, "owner", T1], [ADMIN, "admin", T1], [CREW, "server", T1], [OTHER, "owner", T2]]) {
    await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(-2)}@example.test`]);
    await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, t]);
  }
  const as = async (uid, sql, p) => {
    await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
    try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
  };
  const door = async (t) => { await db.exec(`set role anon;`); try { return (await db.query(`select public.vision_shared($1) v`, [t])).rows[0].v; } catch (e) { return { code: e.code, error: e.message }; } finally { await db.exec(`reset role;`); } };
  const review = async (uid, share, draft) => { const r = await as(uid, `select public.vision_share_review($1, $2::jsonb) v`, [share, draft == null ? null : JSON.stringify(draft)]); return r.error ? r : r[0].v; };
  const publish = async (uid, share, draft, fp, confirm) => { const r = await as(uid, `select public.vision_share_publish($1, $2::jsonb, $3, $4::text[]) v`, [share, JSON.stringify(draft ?? {}), fp, confirm]); return r.error ? r : r[0].v; };
  const reviewAndPublish = async (uid, share, draft) => { const r = await review(uid, share, draft); if (r.error) return r; return publish(uid, share, draft, r.fingerprint, r.material); };
  return { db, q, q1, as, door, review, publish, reviewAndPublish };
}

const scen = (o = {}) => ({ ordersPerDay: 110, avgOrderCents: 900, daysOpenPerMonth: 26, hoursOpenPerDay: 10, cogsPct: 30, cardFeePct: 3, staffHoursPerDay: 20, wageCents: 1600, rentCents: 450000, ownerCashCents: 2000000,
  uses: [{ id: "l1", label: "Bar build", category: "equipment", qty: 1, unitCents: 1200000, confidence: "quoted", on: "2026-10-01" }, { id: "l2", label: "Reserve", category: "reserve", qty: 1, unitCents: 3000000 }], ...o });
const baseline = (o = {}) => JSON.stringify({ scenarios: { conservative: scen({ ordersPerDay: 80, ...o }), base: scen(o), upside: scen({ ordersPerDay: 140, ...o }) }, structure: { kind: "rev_share", amountCents: 4000000, sharePct: 6, capMultiple: 1.5 } });

// ═════ The contract, the door, the checks ══════════════════════════════════════════════════════════════════════════
{
  const { db, q, q1, as, door, review, publish, reviewAndPublish } = await setup(null);
  const plan = await q1(`select id, program_id from public.vision_plans where tenant_id = $1 order by phase limit 1`, [T1]);
  const plan2 = await q1(`select id, program_id from public.vision_plans where tenant_id = $1 and id <> $2 order by phase limit 1`, [T1, plan.id]);
  await q(`update public.vision_plans set shareable = true where id = any($1)`, [[plan.id, plan2.id]]);
  const room = (await q1(`select id from public.store_layouts where tenant_id = $1 order by created_at limit 1`, [T1])).id;
  await q(`update public.vision_programs set target_on = '2027-03-01' where id = $1`, [plan.program_id]);
  await q(`insert into public.vision_plan_versions (plan_id, version, baseline, approved_at) values ($1, 1, $2::jsonb, now() - interval '1 hour')`, [plan.id, baseline()]);
  const theirs = (await q1(`insert into public.vision_programs (tenant_id, title, lane) values ($1, 'Their program', 'Business') returning id`, [T2])).id;
  const draft = { label: "Upstate investors", program_ids: [plan.program_id, theirs], plan_ids: [plan.id], need_plans: [plan.id], layout_ids: [room], money_plans: [plan.id], research_plans: [], show_asks: true, days: 30 };

  // The one door.
  const ins = await as(OWNER, `insert into public.vision_shares (label, program_ids) values ('Direct', $1)`, [[plan.program_id]]);
  ok("direct INSERT is refused to the API — publish is the only way a link is made", ins.code === "42501", ins);
  const rev = await review(OWNER, null, draft);
  ok("review returns the response, its fingerprint and the material findings (sorted ids)", rev.payload && /^[0-9a-f]{32}$/.test(rev.fingerprint) && Array.isArray(rev.material), Object.keys(rev));
  const made = await publish(OWNER, null, draft, rev.fingerprint, rev.material);
  ok("publish makes the link with the reviewed fingerprint and the material confirmed", made.id && made.token?.length >= 32, made.error ?? Object.keys(made));
  const row = await q1(`select * from public.vision_shares where id = $1`, [made.id]);
  ok("…another business's program in the draft is dropped, never stored", !row.program_ids.includes(theirs) && row.program_ids.includes(plan.program_id));
  ok("…stored: the response itself, its fingerprint, when, by whom, and exactly what was confirmed", row.published && row.published_fingerprint && row.published_by === OWNER && JSON.stringify(row.confirmed) === JSON.stringify(rev.material));
  ok("…its life is what was asked (30 days)", Math.abs(Date.parse(row.expires_at) - Date.now() - 30 * 864e5) < 120e3);
  const sent = await door(made.token);
  ok("the investor receives exactly what was reviewed (but the pin's and the end's own moments)", JSON.stringify(noPin(sent)) === JSON.stringify(noPin(rev.payload)), { sent: Object.keys(sent) });
  ok("…and the owner's preview of the link is the same answer, byte for byte", JSON.stringify((await as(OWNER, `select public.vision_share_preview($1, null) v`, [made.id]))[0].v) === JSON.stringify(await door(made.token)));
  const fa = CASE.figuresOf(V.toVision(sent).cases[plan.id]), fb = CASE.figuresOf(V.toVision(rev.payload).cases[plan.id]);
  ok("…the case's figures are identical (every month, every scenario, IRR, the investor's return)", JSON.stringify({ m: fa.models, s: fa.scores, i: fa.irrPct, v: fa.inv }) === JSON.stringify({ m: fb.models, s: fb.scores, i: fb.irrPct, v: fb.inv }));

  // Scope edits can't go around it.
  for (const [col, v] of [["program_ids", `'{${theirs}}'`], ["plan_ids", `'{${plan2.id}}'`], ["money_plans", `'{${plan2.id}}'`], ["layout_ids", "'{}'"], ["pinned_at", "now()"], ["label", "'Renamed'"], ["show_asks", "false"], ["expires_at", "null"], ["published", `'{}'::jsonb`], ["published_fingerprint", "null"], ["confirmed", "'{}'"]]) {
    const r = await as(OWNER, `update public.vision_shares set ${col} = ${v} where id = $1`, [made.id]);
    ok(`direct UPDATE of ${col} is refused (only revoked_at is the API's)`, r.code === "42501", r);
  }
  ok("…so clearing the fingerprint or the revision can't authorize anything, and nothing above moved", JSON.stringify(await door(made.token)) === JSON.stringify(sent));

  // The publication contract: words wait for a republish; gates take away at once.
  await q(`update public.vision_programs set summary = 'Edited after publishing — not reviewed.' where id = $1`, [plan.program_id]);
  ok("an edit after publishing doesn't reach the link: the published revision is sent", !JSON.stringify(await door(made.token)).includes("Edited after publishing"));
  const again = await review(OWNER, made.id, {});
  ok("…review of the link says it changed, and shows the edit for review", again.changed === true && JSON.stringify(again.payload).includes("Edited after publishing"));
  const re = await publish(OWNER, made.id, {}, again.fingerprint, again.material);
  ok("…republished, the link sends it — with the same pin (money unchanged)", !re.error && JSON.stringify(await door(made.token)).includes("Edited after publishing") && (await q1(`select pinned_at from public.vision_shares where id = $1`, [made.id])).pinned_at.getTime() === row.pinned_at.getTime(), re);
  await q(`insert into public.vision_plan_versions (plan_id, version, baseline, approved_at) values ($1, 2, $2::jsonb, now())`, [plan.id, baseline({ rentCents: 999900 })]);
  ok("a newer approval doesn't reach the link (the pin, 0458) — the published money is version 1", (await door(made.token)).plans[0].money.version === 1);
  const rv = await review(OWNER, made.id, {});
  ok("…review names it as material: a newer approved version than the pin", rv.material.includes(`newer_approval:plan:${plan.id}`) && rv.latest[plan.id] === 2, rv.material);
  ok("…an admin can't move the pin (0458)", (await review(ADMIN, made.id, { repin: true })).code === "PT403" && (await publish(ADMIN, made.id, { repin: true }, rv.fingerprint, rv.material)).code === "PT403");
  const rp = await review(OWNER, made.id, { repin: true });
  ok("…the owner can, through review: the newer money, confirmed and published", !(await publish(OWNER, made.id, { repin: true }, rp.fingerprint, rp.material)).error && (await door(made.token)).plans[0].money.version === 2);

  // Removals are immediate.
  await q(`update public.vision_plans set shareable = false where id = $1`, [plan.id]);
  const gone = await door(made.token);
  ok("a plan unmarked to show is gone from the link at once — with its money, needs and asks", gone.plans.length === 0 && gone.asks.every((a) => a.plan_id !== plan.id), { plans: gone.plans.length });
  await q(`update public.vision_plans set shareable = true where id = $1`, [plan.id]);
  ok("…and back when marked again (it was reviewed)", (await door(made.token)).plans.length === 1);
  await q(`delete from public.store_items where layout_id = $1`, [room]); await q(`delete from public.store_layouts where id = $1`, [room]);
  const noRoom = await door(made.token);
  ok("a room deleted is gone from the link at once, and nothing points at it", noRoom.layouts.length === 0 && noRoom.plans.every((p) => p.layout_id === null) && noRoom.programs.every((p) => p.layout_id === null));
  const off = await as(ADMIN, `update public.vision_shares set revoked_at = '2099-01-01' where id = $1`, [made.id]);
  ok("turning it off is the API's one write, stamped now (not the date sent)", !off.error && Math.abs((await q1(`select revoked_at from public.vision_shares where id = $1`, [made.id])).revoked_at.getTime() - Date.now()) < 120e3, off);
  ok("…and it's off at once", (await door(made.token)).code === "PT404");
  const dead = await review(OWNER, made.id, {});
  ok("…a turned-off link can't be republished", dead.code === "PT403" && (await publish(OWNER, made.id, {}, "x", [])).code === "PT403");

  // PT409: an edit between review and publish.
  const d2 = { label: "Between", program_ids: [plan.program_id], plan_ids: [plan.id], layout_ids: [], show_asks: false };
  const r2 = await review(OWNER, null, d2);
  await q(`update public.vision_plans set why = 'Changed between review and publish.' where id = $1`, [plan.id]);
  const n0 = (await q1(`select count(*)::int n from public.vision_shares`)).n;
  const late = await publish(OWNER, null, d2, r2.fingerprint, r2.material);
  ok("an edit between review and publish: refused PT409, nothing made", late.code === "PT409" && (await q1(`select count(*)::int n from public.vision_shares`)).n === n0, late);
  ok("…a changed draft (scope) with the old fingerprint: PT409", (await publish(OWNER, null, { ...d2, plan_ids: [plan.id, plan2.id] }, (await review(OWNER, null, d2)).fingerprint, [])).code === "PT409");
  ok("…a forged or missing fingerprint: PT409", (await publish(OWNER, null, d2, "0".repeat(32), [])).code === "PT409" && (await publish(OWNER, null, d2, null, [])).code === "PT409");
  const r2b = await review(OWNER, null, { ...d2, days: 7 });
  ok("…the lifetime is bound too: reviewed at 7 days, published at 90 → PT409", (await publish(OWNER, null, { ...d2, days: 90 }, r2b.fingerprint, r2b.material)).code === "PT409");

  // An edit that lands while publish runs stays out (modelled: it commits between the response and the write).
  await db.exec(`create or replace function public.zz_mid() returns trigger language plpgsql as $$ begin update public.vision_plans set why = 'MID-PUBLISH EDIT' where id = '${plan.id}'; return new; end $$;
                 create trigger zz_mid_tg before insert on public.vision_shares for each row execute function public.zz_mid();`);
  const d3 = { label: "Mid", program_ids: [plan.program_id], plan_ids: [plan.id], layout_ids: [], show_asks: false };
  const r3 = await review(OWNER, null, d3);
  const mid = await publish(OWNER, null, d3, r3.fingerprint, r3.material);
  await db.exec(`drop trigger zz_mid_tg on public.vision_shares; drop function public.zz_mid();`);
  const s3 = await door(mid.token);
  ok("an edit landing mid-publish is in the database but not on the link: what's sent is what was reviewed", !mid.error && (await q1(`select why from public.vision_plans where id = $1`, [plan.id])).why === "MID-PUBLISH EDIT"
    && !JSON.stringify(s3).includes("MID-PUBLISH EDIT") && JSON.stringify(noPin(s3)) === JSON.stringify(noPin(r3.payload)), mid);
  ok("…and the next review of that link shows it changed", (await review(OWNER, mid.id, {})).changed === true);
  ok("publish locks the link it changes (FOR UPDATE) before reading it", /if p_lock then select \* into s from public\.vision_shares where id = p_share and tenant_id = t for update;/.test(M) && /vision_share_candidate\(p_share, p_draft, true\);   -- locks/.test(M));

  // Confirmations: exactly the material findings.
  await q(`insert into public.vision_asks (program_id, plan_id, label, amount_cents, note) values ($1, $2, 'Signage', null, 'Internal: ask Dana at 518-555-0134.')`, [plan.program_id, plan.id]);
  await q(`insert into public.std_materials (tenant_id, name, category, supplier) values ($1, 'Bar top', 'surface', 'Acme Fixtures')`, [T1]);
  const room2 = (await q1(`insert into public.store_layouts (tenant_id, name) values ($1, 'Copy of Storefront') returning id`, [T1])).id;
  await q(`insert into public.store_items (layout_id, kind, label, x_in, y_in, w_in, d_in, h_in) values ($1, 'counter', 'Acme Fixtures bar', 10, 10, 96, 30, 42)`, [room2]);
  const d4 = { label: "Confirm", program_ids: [plan.program_id], plan_ids: [plan.id], layout_ids: [room2], money_plans: [plan.id], show_asks: true };
  const r4 = await review(OWNER, null, d4);
  ok("material findings: the unset ask, the words (phone, 'internal'), the library supplier in a room", r4.material.includes("asks_unset:link:link") && r4.material.includes(`internal_words:plan:${plan.id}`) && r4.material.includes(`internal_words:layout:${room2}`), r4.material);
  ok("…none confirmed: PT422", (await publish(OWNER, null, d4, r4.fingerprint, [])).code === "PT422");
  ok("…one missing: PT422", (await publish(OWNER, null, d4, r4.fingerprint, r4.material.slice(1))).code === "PT422");
  ok("…one made up: PT422", (await publish(OWNER, null, d4, r4.fingerprint, [...r4.material, "asks_unset:link:other"])).code === "PT422");
  const p4 = await publish(OWNER, null, d4, r4.fingerprint, [...r4.material].reverse());
  ok("…exactly them (any order): published, and recorded", !p4.error && JSON.stringify((await q1(`select confirmed from public.vision_shares where id = $1`, [p4.id])).confirmed) === JSON.stringify(r4.material), p4);

  // The server's findings are lib/publishReadiness's, id for id.
  for (const [name, rr] of [["clean", rev], ["changed", again], ["newer approval", rv], ["messy", r4]]) {
    const ts = R.readinessOf(R.payloadChecks(rr.payload, { latestApproved: rr.latest, privateNames: rr.private_names })).materialIds;
    ok(`the material ids agree with lib/publishReadiness (${name})`, JSON.stringify(ts) === JSON.stringify(rr.material), { ts, sql: rr.material });
  }
  const tricky = ["token holders", "tokenism", "Write to a.b@example.com", "(518) 555-0134", "Don't share this", "privately held", "PRIVATE", "Acme Fixtures Inc", "acme", "0c46e000-0000-4000-8000-000000000001", "1234-5678-9012", "Confidential.", "internal-only", "Internals"];
  for (const t of tricky) {
    const sql = (await q1(`select public.vision_share_internal($1, $2) b`, [t, ["Acme Fixtures", "ab"]])).b;
    ok(`…word for word on "${t}"`, sql === (R.internalWhy(t, ["Acme Fixtures", "ab"]) !== null), { sql, ts: R.internalWhy(t, ["Acme Fixtures", "ab"]) });
  }
  const notText = (/not \(w\.k = any \(array\[([^\]]+)\]\)\)/.exec(M)?.[1] ?? "").match(/'([^']+)'/g).map((s) => s.slice(1, -1)).sort();
  ok("the database's non-text keys are lib/sharePreview's NOT_TEXT", JSON.stringify(notText) === JSON.stringify([...SP.NOT_TEXT].sort()), notText.length);
  const words = (/\(\^\|\[\^A-Za-z0-9\]\)\(([^)]+)\)\(\$\|/.exec(M)?.[1] ?? "").replace(/''/g, "'").split("|");
  ok("…its internal words are INTERNAL_WORDS, and its two patterns INTERNAL_RE_SOURCES", JSON.stringify(words) === JSON.stringify([...R.INTERNAL_WORDS]) && M.includes(`t ~ '${R.INTERNAL_RE_SOURCES.email}'`) && M.includes(`t ~ '${R.INTERNAL_RE_SOURCES.phone}'`), words);

  // Every authorization, again.
  ok("an admin's draft that names money: PT403 at review and at publish (0451)", (await review(ADMIN, null, d4)).code === "PT403" && (await publish(ADMIN, null, d4, r4.fingerprint, r4.material)).code === "PT403");
  const ra = await review(ADMIN, p4.id, { label: "Renamed by an admin" });
  ok("…an admin can republish a link's words and scope without touching its money (money unchanged)", !ra.error && !(await publish(ADMIN, p4.id, { label: "Renamed by an admin" }, ra.fingerprint, ra.material)).error
    && JSON.stringify((await q1(`select money_plans from public.vision_shares where id = $1`, [p4.id])).money_plans) === JSON.stringify([plan.id]));
  ok("…but can't change its money", (await review(ADMIN, p4.id, { money_plans: [] })).code === "PT403");
  ok("crew can't review or publish (PT403)", (await review(CREW, null, d2)).code === "PT403" && (await publish(CREW, null, d2, "x", [])).code === "PT403");
  ok("another business can't review or publish this business's link (PT404)", (await review(OTHER, p4.id, {})).code === "PT404" && (await publish(OTHER, p4.id, {}, "x", [])).code === "PT404");
  await db.exec(`set role anon;`);
  let anonErr = null; try { await db.query(`select public.vision_share_review(null, '{}'::jsonb)`); } catch (e) { anonErr = e.code; }
  let anonErr2 = null; try { await db.query(`select public.vision_share_publish(null, '{}'::jsonb, 'x', '{}')`); } catch (e) { anonErr2 = e.code; }
  await db.exec(`reset role;`);
  ok("signed out: neither can be called", anonErr === "42501" && anonErr2 === "42501", [anonErr, anonErr2]);
  ok("nothing chosen, or no name: PT400", (await reviewAndPublish(OWNER, null, { label: "Empty", program_ids: [], layout_ids: [] })).code === "PT400" && (await reviewAndPublish(OWNER, null, { label: " ", program_ids: [plan.program_id] })).code === "PT400");

  // The activity log: when, who, what was confirmed — never the token, never the revision.
  const lines = await q(`select summary, new_row from public.admin_audit where table_name = 'vision_shares' and row_pk = $1`, [p4.id]);
  ok("a publish's activity line names when, who and what was confirmed — never the token or the revision", lines.length >= 1 && lines.every((l) => !JSON.stringify(l).includes(p4.token) && !("published" in (l.new_row ?? {})) && !("token" in (l.new_row ?? {})))
    && lines.some((l) => l.new_row?.published_by === OWNER && Array.isArray(l.new_row?.confirmed)), lines.map((l) => Object.keys(l.new_row ?? {})));
  ok("a second run of 0472 changes nothing", await (async () => { const before = JSON.stringify(await q(`select id, published, published_fingerprint, confirmed from public.vision_shares order by id`)); await db.exec(M); return before === JSON.stringify(await q(`select id, published, published_fingerprint, confirmed from public.vision_shares order by id`)); })());
  await db.close();
}

// ═════ Existing links: what each sends today becomes its published revision ═══════════════════════════════════════
{
  const { db, q, q1, as, door } = await setup("0472");
  const plan = await q1(`select id, program_id from public.vision_plans where tenant_id = $1 order by phase limit 1`, [T1]);
  await q(`update public.vision_plans set shareable = true where id = $1`, [plan.id]);
  const room = (await q1(`select id from public.store_layouts where tenant_id = $1 order by created_at limit 1`, [T1])).id;
  const live = (await as(OWNER, `insert into public.vision_shares (label, program_ids, plan_ids, need_plans, layout_ids, show_asks) values ('Before 0472', $1, $2, $2, $3, true) returning id, token`, [[plan.program_id], [plan.id], [room]]))[0];
  const off = (await as(OWNER, `insert into public.vision_shares (label, program_ids) values ('Off before 0472', $1) returning id, token`, [[plan.program_id]]))[0];
  await as(OWNER, `update public.vision_shares set revoked_at = now() where id = $1`, [off.id]);
  const was = await door(live.token);
  await db.exec(M);
  const now = await door(live.token);
  ok("an existing link sends exactly what it sent before 0472", JSON.stringify(now) === JSON.stringify(was));
  const r = await q1(`select published, published_by, confirmed, published_fingerprint from public.vision_shares where id = $1`, [live.id]);
  ok("…its published revision is that response; published before reviews (no one, nothing confirmed)", r.published && r.published_by === null && r.confirmed === null && /^[0-9a-f]{32}$/.test(r.published_fingerprint));
  await q(`update public.vision_programs set summary = 'After 0472, unreviewed.' where id = $1`, [plan.program_id]);
  ok("…and an edit since doesn't reach it", !JSON.stringify(await door(live.token)).includes("After 0472, unreviewed."));
  ok("a turned-off link is left as it was (never sent)", (await q1(`select published from public.vision_shares where id = $1`, [off.id])).published === null && (await door(off.token)).code === "PT404");
  await db.close();
}

console.log(`IMS8 P5 — A LINK SENDS WHAT YOU REVIEWED (0472, in Postgres): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
