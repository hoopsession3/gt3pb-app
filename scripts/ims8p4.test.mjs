// IMS8 P4 — IS THIS LINK READY TO SEND? lib/publishReadiness: the five classes on the insight contract, three bands, one
// verdict and three findings before "more"; each finding says its source, its words, where to fix it and how loud it is.
// The draft side refuses what the database refuses; the response side reads the exact payload (built here the way
// vision_share_payload builds it) — material findings carry the stable ids P5's server binds confirmations to.
import { loadTs } from "./search.read.mjs";

const R = loadTs("lib/publishReadiness.ts");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 500)}` : "")); } };
const PG = "0c46d000-0000-4000-8000-0000000000a1", PL = "0c46d000-0000-4000-8000-0000000000b1", PL2 = "0c46d000-0000-4000-8000-0000000000b2", RM = "0c46d000-0000-4000-8000-0000000000c1";
const rules = (l) => l.map((f) => `${f.cls}:${f.rule}`).sort();

// ── Before review: the draft ────────────────────────────────────────────────────────────────────────────────────────
const ctx = { canEdit: true, isOwner: true, programs: [{ id: PG, title: "The first store" }], rooms: [{ id: RM, name: "Storefront" }],
  plans: [{ id: PL, name: "Gym bar", program_id: PG, shareable: true }, { id: PL2, name: "Storefront", program_id: PG, shareable: false }] };
const empty = R.draftChecks({ label: "", programs: [], plans: [], needs: [], rooms: [], showAsks: false }, ctx);
ok("an empty draft can't go: no name, nothing chosen — said, not pre-filled", JSON.stringify(rules(empty)) === JSON.stringify(["enforced:no_label", "enforced:nothing_chosen"]), rules(empty));
ok("…and its band is Can't share yet, with one verdict", R.readinessOf(empty).band === "cant" && /^Can't share yet — 2 things to fix first$/.test(R.readinessOf(empty).verdict), R.readinessOf(empty).verdict);
const good = { label: "Upstate investors", programs: [PG], plans: [PL], needs: [PL], rooms: [RM], money: [PL], showAsks: true };
ok("a chosen draft, by an owner: nothing in the way", R.draftChecks(good, ctx).length === 0, rules(R.draftChecks(good, ctx)));
ok("a plan not marked to show is refused, and says where to fix it", (() => { const f = R.draftChecks({ ...good, plans: [PL, PL2] }, ctx).find((x) => x.rule === "plan_not_shown"); return f && f.cls === "enforced" && f.blocks && f.go?.section === "plans" && f.go.anchor === PL2 && /0448/.test(f.refuses); })());
ok("…a plan whose program isn't chosen is refused", R.draftChecks({ ...good, programs: [], rooms: [RM] }, ctx).some((x) => x.rule === "plan_not_shown" && x.subject.id === PL));
ok("…another business's id is refused (never offered)", R.draftChecks({ ...good, rooms: [RM, "0c46d000-0000-4000-8000-0000000000ff"] }, ctx).some((x) => x.rule === "not_this_business" && x.blocks));
const admin = R.draftChecks(good, { ...ctx, isOwner: false });
ok("money chosen by an admin: an approval blocker (0451) — a tap can't override it", admin.length === 1 && admin[0].cls === "approval" && admin[0].blocks && admin[0].level === "stop" && /0451/.test(admin[0].refuses), rules(admin));
ok("…crew can't make a link at all", R.draftChecks(good, { ...ctx, canEdit: false, isOwner: false }).some((x) => x.rule === "no_editor"));

// ── On the response ─────────────────────────────────────────────────────────────────────────────────────────────────
const scen = (o = {}) => ({ ordersPerDay: 110, avgOrderCents: 900, daysOpenPerMonth: 26, hoursOpenPerDay: 10, cogsPct: 30, cardFeePct: 3, staffHoursPerDay: 20, wageCents: 1600, rentCents: 450000, ownerCashCents: 2000000,
  uses: [{ id: "l1", label: "Bar build", category: "equipment", qty: 1, unitCents: 1200000, confidence: "quoted", on: "2026-10-01" }, { id: "l2", label: "Reserve", category: "reserve", qty: 1, unitCents: 3000000 }], ...o });
const base = (over = {}) => ({
  label: "Upstate investors", show_asks: true, expires_at: null, pinned_at: "2026-11-01T00:00:00Z",
  programs: [{ id: PG, lane: "Business", title: "The first store", summary: "One store in a gym, then a storefront.", why: null, pillars: ["fuel"], horizon: "now", status: "planned", start_on: "2026-11-01", target_on: "2027-03-01", emoji: "🏁", layout_id: RM, sort: 1 }],
  asks: [{ program_id: PG, plan_id: PL, label: "Build-out", amount_cents: 1500000, state: "open", note: "Quoted.", sort: 1 }],
  plans: [{ id: PL, program_id: PG, name: "Gym bar", format: "gym_bar", phase: 1, status: "planned", sqft: 400, deal: "rev_share", place: "Upstate", summary: "A bar inside the gym.", why: null, gate: "Gym signs.", layout_id: RM, sort: 1,
    customer: null, market: null, positioning: null, needs: [{ label: "Choose the gym", kind: "partner", due_on: "2026-12-01", done_on: null, sort: 1 }], waits_on: [],
    money: { baseline: { scenarios: { conservative: scen({ ordersPerDay: 80 }), base: scen(), upside: scen({ ordersPerDay: 140 }) }, structure: { kind: "rev_share", amountCents: 4000000, sharePct: 6, capMultiple: 1.5 },
      acknowledged: [{ key: "no_downside", note: "Said.", at: "2026-10-20", reviewBy: "2099-12-01" }] }, approved_at: "2026-10-31T00:00:00Z", version: 2 },
    research: [{ topic: "demand", claim: "1,200 members a day.", figure: "1,200", source_url: "https://x.example", source_title: "Count", bearing: "for", retrieved_at: "2026-10-01" }],
    risks: [{ kind: "risk", words: "Footfall drops in summer.", likelihood: "medium", impact: "high", mitigation: "Events.", status: "open" }] }],
  layouts: [{ id: RM, name: "Storefront", width_in: 240, depth_in: 360, ceiling_in: 120, items: [{ id: "0c46d000-0000-4000-8000-0000000000d1", kind: "counter", label: "Bar", x_in: 10, y_in: 10, rot: 0, w_in: 96, d_in: 30, h_in: 42, why: null, pillars: [], sort: 1 }] }],
  ...over,
});
const clean = R.payloadChecks(base(), { moneyPlans: [PL], latestApproved: { [PL]: 2 } });
const cleanR = R.readinessOf(clean);
ok("a clean response: nothing to confirm; Ready to share", cleanR.band === "ready" && cleanR.materialIds.length === 0 && /^Ready to share/.test(cleanR.verdict), { v: cleanR.verdict, r: rules(clean) });
ok("…and the case's score is the engine's: what the investor will read as still to close is said as a concern, never a stop", clean.filter((f) => f.rule === "blockers_open").every((f) => f.cls === "concern" && !f.blocks && f.level === "note"));

const messy = base({
  asks: [{ program_id: PG, plan_id: PL, label: "Build-out", amount_cents: null, state: "open", note: "Set the amount.", sort: 1 }, { program_id: PG, plan_id: null, label: "Equipment", amount_cents: 0, state: "open", note: null, sort: 2 }],
  programs: [{ ...base().programs[0], target_on: null, why: "Internal: margins are thin — call Dana at 518-555-0134." }],
});
messy.plans[0].money.baseline.scenarios.base.uses.push({ id: "l3", label: "Signage", category: "launch", qty: 1, unitCents: null });
messy.plans[0].gate = null;
messy.plans[0].needs.push({ label: "Health permit", kind: "permit", due_on: null, done_on: null, sort: 2 });
messy.layouts[0].name = "Copy of Storefront";
const m = R.payloadChecks(messy, { moneyPlans: [PL], latestApproved: { [PL]: 3 }, privateNames: ["Acme Fixtures"] });
const mr = R.readinessOf(m);
ok("material: an unset ask (NULL) — a confirmed $0 isn't one", m.filter((f) => f.rule === "asks_unset").length === 1 && /1 ask will read "Being priced" — Build-out\./.test(m.find((f) => f.rule === "asks_unset").words), m.find((f) => f.rule === "asks_unset")?.words);
ok("material: an approved cost line with no price, named", /1 cost line with no price: Signage/.test(m.find((f) => f.rule === "uses_unpriced")?.words ?? ""));
ok("material: a newer approved version than the pin (3 > 2)", m.some((f) => f.rule === "newer_approval" && f.cls === "material"));
const iw = m.find((f) => f.rule === "internal_words");
ok("material: words meant for inside — each passage in full, where it is, and why; said to go into the link as written", iw && iw.subject.kind === "program" && iw.evidence.length === 1
  && iw.evidence[0].says === "Internal: margins are thin — call Dana at 518-555-0134." && iw.evidence[0].source === 'Roadmap program · The first store · why — says "internal"'
  && /will be in the link exactly as written/.test(iw.words) && iw.action === "Edit the words" && iw.go?.section === "roadmap", iw);
ok("…a library name in a room's thing is found too, located", (() => { const f = R.payloadChecks(base({ layouts: [{ ...base().layouts[0], items: [{ ...base().layouts[0].items[0], label: "Acme Fixtures bar" }] }] }), { privateNames: ["Acme Fixtures"] }).find((x) => x.rule === "internal_words" && x.subject.kind === "layout");
  return f && f.evidence[0].says === "Acme Fixtures bar" && f.evidence[0].source === "Room · Storefront · a thing in the room's name — names Acme Fixtures, from your library"; })());
ok("a server confirmation id is matched to its finding by everything but its content hash", R.isFor("internal_words:plan:abc:0123456789ab", "internal_words:plan:abc") && !R.isFor("internal_words:plan:abcd:0123456789ab", "internal_words:plan:abc") && !R.isFor("x:y:z:h", null));
ok("…an email address is found; an ordinary word containing one isn't ('tokenism' is not 'token')", R.internalWhy("write to a.b@example.com") === "has an email address" && R.internalWhy("tokenism") === null && R.internalWhy("Token holders") === 'says "token"' && R.internalWhy("(518) 555-0134") === "has a phone number");
ok("…ids, dates and fixed words are never read as text (no false hit on a uuid or a status)", R.textsOf(base()).every((t) => !/^[0-9a-f-]{36}$/.test(t.text) && t.key !== "status" && t.key !== "pinned_at"));
ok("concern: no target date, no gate, an undated need, a draft-named room", ["program_no_target", "plan_no_gate", "need_no_due", "room_draft_name"].every((r) => m.some((f) => f.rule === r && f.cls === "concern")), rules(m));
ok("editorial: a placeholder ('Set the amount.')", m.some((f) => f.rule === "placeholder" && f.cls === "editorial"));
ok("the band: confirm 4 things; the verdict counts the rest as worth a look", mr.band === "confirm" && /^Ready once you confirm 4 things · \d+ things worth a look$/.test(mr.verdict), mr.verdict);
ok("…at most 3 findings before more, material first", mr.top.length === 3 && mr.top.every((f) => f.cls === "material") && mr.more === mr.all.length - 3);
ok("the material ids are stable and exact (what 0472 binds confirmations to)", JSON.stringify(mr.materialIds) === JSON.stringify([`asks_unset:link:link`, `internal_words:program:${PG}`, `newer_approval:plan:${PL}`, `uses_unpriced:plan:${PL}`]), mr.materialIds);
ok("…the same response gives the same ids, findings and order every time", JSON.stringify(R.readinessOf(R.payloadChecks(messy, { moneyPlans: [PL], latestApproved: { [PL]: 3 }, privateNames: ["Acme Fixtures"] })).all.map((f) => f.id)) === JSON.stringify(mr.all.map((f) => f.id)));
ok("confirmations: exactly the material ids — none missing, none made up, order doesn't matter", R.confirmationsMatch([...mr.materialIds].reverse(), mr.materialIds) && !R.confirmationsMatch(mr.materialIds.slice(1), mr.materialIds) && !R.confirmationsMatch([...mr.materialIds, "asks_unset:link:other"], mr.materialIds));
ok("every finding carries a source rule, its words, a level, and a class; every fix says where", m.every((f) => f.engine === "publish" && f.rule && f.words && ["stop", "look", "note"].includes(f.level) && R.CLASSES.includes(f.cls) && (f.cls === "editorial" && f.rule === "duplicate" ? true : !!f.go)), m.filter((f) => !f.go).map((f) => f.rule));
ok("advisory classes never block; only material carries a confirm id", m.every((f) => !f.blocks && ((f.cls === "material") === !!f.confirm)));
ok("money chosen but not approved: a concern, not a stop", R.payloadChecks(base({ plans: [{ ...base().plans[0], money: null, risks: null }] }), { moneyPlans: [PL] }).some((f) => f.rule === "money_not_approved" && f.cls === "concern"));
ok("an empty room and a lone emoji are said", (() => { const l = R.payloadChecks(base({ layouts: [{ ...base().layouts[0], items: [] }], programs: [{ ...base().programs[0], summary: "🔥" }] })); return l.some((f) => f.rule === "room_empty") && l.some((f) => f.rule === "lone_emoji"); })());
ok("…the emoji field itself is an emoji by design, never flagged", !R.payloadChecks(base()).some((f) => f.rule === "lone_emoji"));
ok("duplicate words across places are said once", R.payloadChecks(base({ programs: [{ ...base().programs[0], summary: "A bar inside the gym, open every day." }], plans: [{ ...base().plans[0], summary: "A bar inside the gym, open every day." }] })).filter((f) => f.rule === "duplicate").length === 1);
console.log(`IMS8 P4 — IS THIS LINK READY TO SEND?: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
