// IMS7-C — THE INSIGHT CONTRACT. One shape for what the engines already decide; nothing re-decided. Tested on the engines'
// real output where they're pure (the Advisor, the room's checks) and on their documented shapes where they're read from
// the database (blockers, money attention, alerts, the library's gate): identity, every severity mapping, authority kept
// apart from loudness, deduplication across engines, resolution, acknowledgement, staleness, visibility, determinism.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const I = loadTs("lib/insight.ts"), A = loadTs("lib/visionAdvisor.ts"), M = loadTs("lib/visionMoney.ts"), K = loadTs("lib/visionRisks.ts");
const E = loadTs("lib/spatial/evaluate.ts"), P = loadTs("lib/spatial/profiles.ts"), S = loadTs("lib/visionScore.ts"), L = loadTs("lib/experienceLibrary.ts");
const NOW = Date.parse("2026-10-31T12:00:00Z");

// ── 1 · the Advisor, through the contract ───────────────────────────────────────────────────────────────────────────
const R = (o) => K.toRisk({ plan_id: "p1", kind: "risk", words: "x", status: "open", sort: 0, ...o });
const inputs = (o = {}) => M.toInputs({ uses: [{ id: "a", label: "Bar", category: "equipment", qty: 1, unitCents: 3000000, confidence: "quoted" }], ordersPerDay: 100, avgOrderCents: 800,
  daysOpenPerMonth: 30, hoursOpenPerDay: 10, cogsPct: 30, staffHoursPerDay: 20, wageCents: 1500, rentCents: 900000, capToRoom: true, ...o });
const plan = { id: "p1", name: "The gym bar", status: "go", layout_id: "room", research_every_days: 0 };
const state = (o = {}) => ({ plan, i: inputs(o.i), structure: { kind: "none" }, ctx: { counterPerHour: 5 }, research: [], progress: {},
  risks: [R({ id: "r1", words: "People pay $8", kind: "assumption", status: "wrong" })], status: "go", waitingOn: ["The kiosk"], ...o.s });
const adv = A.advise([state()], NOW);
ok("the Advisor names the rule behind every line (additive: its decisions and order unchanged)", adv.length > 0 && adv.every((a) => typeof a.rule === "string" && a.rule.length > 2), adv.map((a) => a.rule));
const ins = adv.map((a) => I.fromAdvice(a, { scoreVersion: S.SCORE_METHOD.version }));
ok("…its words, action and order carried as said", ins.every((x, k) => x.words === adv[k].words && x.action === adv[k].action && x.order === adv[k].gain));
ok("…its stop and look kept, native beside it", ins.every((x, k) => x.level === adv[k].level && x.native.value === adv[k].level && x.native.scale === "advisor"));
ok("…a stop from the Advisor is advice: it never blocks", ins.every((x) => x.blocks === false && x.refuses === undefined));
ok("…seen by owners and admins, as the Advisor is (never investors)", ins.every((x) => x.visibility.join() === "owner,editor"));
const moved = A.advise([state({ i: { rentCents: 910000, ordersPerDay: 101 } })], NOW).map((a) => I.fromAdvice(a));
const same = (r) => { const x = ins.find((y) => y.rule === r), y = moved.find((z) => z.rule === r); return !!x && !!y && x.id === y.id; };
ok("identity: the same condition keeps its id while its numbers move", ["waits_on", "over_capacity", "assumption_wrong"].every(same), ins.map((x) => x.id));
ok("…and its mark, so an acknowledged one isn't said again for a number moving", ins.filter((x) => x.rule === "over_capacity").every((x) => moved.find((y) => y.id === x.id)?.mark === x.mark));
ok("…two risks, two ids", new Set(A.advise([state({ s: { risks: [R({ id: "r1", kind: "assumption", status: "wrong", words: "a" }), R({ id: "r2", kind: "assumption", status: "wrong", words: "b" })] } })], NOW)
  .map((a) => I.fromAdvice(a).id)).size === A.advise([state({ s: { risks: [R({ id: "r1", kind: "assumption", status: "wrong", words: "a" }), R({ id: "r2", kind: "assumption", status: "wrong", words: "b" })] } })], NOW).length);
const done = A.advise([state({ s: { waitingOn: [] } })], NOW).map((a) => I.fromAdvice(a));
ok("resolution: when what it waits on is done, its insight is gone — nothing kept", !done.some((x) => x.rule === "waits_on") && ins.some((x) => x.rule === "waits_on"));

// ── 2 · blockers: lifecycle and acknowledgement are the system's own ───────────────────────────────────────────────────
const B = (key, status, o = {}) => ({ key, kind: "x", says: S.BLOCKER_WORD[key], effect: "Holds the stage", criterion: null, status, acknowledged: null, need: null, remedy: S.REMEDY[key], ...o });
const P1 = { kind: "plan", id: "p1", name: "The gym bar" };
const lv = (st) => I.fromBlocker(B("costs_unpriced", st), P1, { scoreVersion: S.SCORE_METHOD.version }).level;
ok("blocker levels: open and lapsed stop; being worked on looks; a live risk acceptance is a note — still said", lv("open") === "stop" && lv("acceptance_lapsed") === "stop" && lv("in_remediation") === "look" && lv("pending_verification") === "look" && lv("risk_accepted") === "note");
const bl = I.fromBlocker(B("costs_unpriced", "risk_accepted", { acknowledged: { key: "costs_unpriced", note: "INTERNAL NOTE", at: "2026-10-29", reviewBy: "2026-11-29" } }), P1, { scoreVersion: S.SCORE_METHOD.version, readiness: "Ready for internal review" });
ok("…its state, version and readiness kept as their own fields — never one number", bl.state === "risk_accepted" && bl.basis.version === S.SCORE_METHOD.version && bl.readiness === "Ready for internal review" && bl.confidence === null && bl.approval === null);
ok("…readiness is a stage by policy, not a gate: a blocker never blocks", ["open", "acceptance_lapsed"].every((s) => I.fromBlocker(B("no_downside", s), P1, { scoreVersion: "v" }).blocks === false));
ok("…investors see the blocker (they already do), never the owner's free-text note", bl.visibility.includes("investor") && !JSON.stringify(bl).includes("INTERNAL NOTE"));
ok("…its action is the remedy the Standard wrote", bl.action === S.REMEDY.costs_unpriced.action);

// ── 3 · one condition, several engines → one line, the authoritative one ───────────────────────────────────────────────
const advWait = ins.find((x) => x.rule === "waits_on");
const blkWait = I.fromBlocker(B("waiting_on", "open"), P1, { scoreVersion: "v" });
const g = I.gather([[advWait], [blkWait]]);
ok("a plan waiting on another: the Advisor and the blocker say it once — as the blocker, the Advisor named", g.length === 1 && g[0].engine === "blocker" && g[0].alsoFrom?.join() === "advisor", g.map((x) => [x.engine, x.alsoFrom]));
const gAcc = I.gather([[advWait], [I.fromBlocker(B("waiting_on", "risk_accepted"), P1, { scoreVersion: "v" })]]);
ok("…an owner's live risk acceptance isn't overruled by the Advisor's louder word", gAcc.length === 1 && gAcc[0].level === "note" && gAcc[0].state === "risk_accepted");
const gIn = I.gather([[blkWait, advWait]]), gRev = I.gather([[advWait, blkWait]]);
ok("…the same either way round", JSON.stringify(gIn) === JSON.stringify(gRev));
ok("the same id twice is one line, at the louder level", I.gather([[{ ...advWait, level: "look" }, advWait]]).length === 1 && I.gather([[{ ...advWait, level: "look" }, advWait]])[0].level === "stop");

// ── 4 · the room's checks ───────────────────────────────────────────────────────────────────────────────────────────
const it = (id, kind, x, y, w, d, h = 36, rot = 0) => ({ id, kind, label: null, x_in: x, y_in: y, rot, w_in: w, d_in: d, h_in: h, why: null, pillars: [], sort: 0 });
const ROOM = { kind: "layout", id: "room", name: "The gym bar" };
const blocked = { width_in: 240, depth_in: 240, items: [it("door", "door", 120, 237, 36, 6, 84), it("fridge", "reach_in", 120, 214, 30, 30, 80), it("ctr", "order_counter", 120, 20, 96, 30, 42)] };
const found = E.evaluate(blocked, P.PROFILES.brick_and_mortar);
const sp = found.map((f) => I.fromSpace(f, ROOM, { profile: "brick_and_mortar" }));
ok("room findings: words and the things they're about carried; native level kept", sp.length === found.length && sp.every((x, k) => x.words === found[k].words && x.related.length === found[k].ids.length && x.native.value.startsWith(found[k].level)));
ok("…a check to make on site is a look at most — it hasn't been detected", sp.filter((x, k) => found[k].source === "site_check").every((x) => x.level !== "stop") && sp.some((x) => x.native.value.endsWith("site_check")));
const f1 = { ids: ["b", "a"], level: "error", words: "A and B overlap.", check: "geometry", source: "detected" };
ok("…an error that needs a site check looks — not detected, so not a stop", I.fromSpace({ ...f1, source: "site_check" }, ROOM).level === "look" && I.fromSpace({ ...f1, source: "site_check" }, ROOM).native.value === "error·site_check");
ok("…a detected error stops, a warning looks", I.fromSpace(f1, ROOM).level === "stop" && I.fromSpace({ ...f1, level: "warn" }, ROOM).level === "look");
ok("…the same things in any order are the same finding", I.fromSpace(f1, ROOM).id === I.fromSpace({ ...f1, ids: ["a", "b"] }, ROOM).id);
ok("…saving with an error asks first and never refuses, so a room's finding never blocks", sp.every((x) => !x.blocks) && /Save with problems\?/.test(read("components/vision/StoreDesigner.tsx")));
const moved2 = E.evaluate({ ...blocked, items: blocked.items.map((x) => (x.id === "fridge" ? { ...x, x_in: 40, y_in: 120 } : x)) }, P.PROFILES.brick_and_mortar).map((f) => I.fromSpace(f, ROOM));
ok("…move the fridge out of the door's swing and that finding is gone", sp.some((x) => x.rule === "door") && !moved2.some((x) => x.rule === "door" && x.related.some((r) => r.id === "fridge")));

// ── 5 · money attention and alerts ──────────────────────────────────────────────────────────────────────────────────
const row = (key, level) => ({ key, level, title: "T", detail: "D", side: "S", go: { section: "money" } });
ok("money attention: critical stops, urgent and action-required look", I.fromMoney(row("dispute:d1", "critical")).level === "stop" && I.fromMoney(row("invoice:v1", "urgent")).level === "look" && I.fromMoney(row("budget:food", "action")).level === "look");
ok("…its own key is the identity, its subject named", I.fromMoney(row("dispute:d1", "critical")).subject.kind === "dispute" && I.fromMoney(row("dispute:d1", "critical")).subject.id === "d1" && I.fromMoney(row("shop", "urgent")).id === I.fromMoney(row("shop", "critical")).id);
ok("…seen where crew HQ shows it: owners and admins", I.fromMoney(row("shop", "urgent")).visibility.join() === "owner,editor");
const al = (o) => I.fromAlert({ id: "x", severity: "important", category: "money", title: "Payout failed", created_at: "2026-10-30T10:00:00Z", ...o });
ok("alerts: critical stops, important looks, fyi is a note", al({ severity: "critical" }).level === "stop" && al({}).level === "look" && al({ severity: "fyi" }).level === "note");
ok("…a single episode is as of when it was raised; a recurring one as of its last sighting (alertWhen's rule)", al({ last_seen_at: "2026-10-31T09:00:00Z" }).observedAt === "2026-10-30T10:00:00Z" && al({ last_seen_at: "2026-10-31T09:00:00Z", occurrences: 4 }).observedAt === "2026-10-31T09:00:00Z");
ok("…Got it and a claim are the alert's own state", al({ ack_at: "2026-10-30T11:00:00Z" }).state === "acknowledged" && al({ claimed_by: "u2" }).state === "claimed" && al({}).state === "open");

// ── 6 · the library: the one gate that refuses ─────────────────────────────────────────────────────────────────────
const asset = (status, o = {}) => ({ id: "m1", name: "Oak bench", status, ...o });
ok("approved says nothing", I.fromLibrary(asset("approved"), { blockers: [] }).length === 0);
const gated = I.fromLibrary(asset("candidate"), { blockers: ["1 criterion judged unknown — unknown is never approved."], placedIn: ROOM });
ok("short of approved, with the Standard's judgement incomplete: a look that refuses — what the database refuses (0461)", gated[0].level === "look" && gated[0].blocks === true && /qualified or approved/.test(gated[0].refuses) && /never approved/.test(gated[0].action));
ok("…the gate is the database's: 0461 raises 'Not yet …' while blockers stand", /raise exception 'Not yet %: %'/.test(read("supabase/migrations/0461_the_experience_library.sql")));
ok("…with nothing standing, it isn't approved yet but nothing refuses", I.fromLibrary(asset("qualified"), { blockers: [] })[0].blocks === false);
ok("…rejected and restricted stop, with their reason", I.fromLibrary(asset("rejected", { status_reason: "Fragrance" }), { blockers: [] })[0].level === "stop" && /Fragrance/.test(I.fromLibrary(asset("rejected", { status_reason: "Fragrance" }), { blockers: [] })[0].words) && I.fromLibrary(asset("restricted"), { blockers: [] })[0].level === "stop");
ok("…approval kept as its own field, not a level", gated[0].approval === "candidate" && gated[0].related[0].id === "room");
const pend = I.fromLibrary(asset("approved"), { blockers: [], pending: 1 });
ok("…findings to decide said once, in the singular", pend.length === 1 && pend[0].words === "1 research finding on Oak bench to decide." && I.fromLibrary(asset("approved"), { blockers: [], pending: 3 })[0].words.startsWith("3 research findings"));
ok("…a status change is a new mark; the same status and blockers, the same", I.fromLibrary(asset("candidate"), { blockers: ["a", "b"] })[0].mark === I.fromLibrary(asset("candidate"), { blockers: ["b", "a"] })[0].mark && I.fromLibrary(asset("candidate"), { blockers: [] })[0].mark !== I.fromLibrary(asset("evidence_incomplete"), { blockers: [] })[0].mark);

// ── 7 · every mapping, every native value ──────────────────────────────────────────────────────────────────────────
ok("every library status short of approved has a level", L.STATUSES.filter((s) => s !== "approved").every((s) => I.LEVEL_OF.library[s]) && !I.LEVEL_OF.library.approved);
ok("every blocker status has a level", Object.keys(S.BLOCKER_STATUS_WORD).every((s) => I.LEVEL_OF.blocker[s]));
ok("every alert severity, money level, Advisor and room level has one", ["critical", "important", "fyi"].every((s) => I.LEVEL_OF.alert[s]) && ["critical", "urgent", "action"].every((s) => I.LEVEL_OF.money[s]) && ["stop", "look"].every((s) => I.LEVEL_OF.advisor[s]) && ["error", "warn"].every((s) => I.LEVEL_OF.space[s]));
ok("…and only stop, look, note", Object.values(I.LEVEL_OF).flatMap((m) => Object.values(m)).every((v) => I.LEVELS.includes(v)));

// ── 8 · presentation: order, visibility, acknowledgement, staleness, the one line ───────────────────────────────────
const all = [...ins, blkWait, ...sp, I.fromMoney(row("dispute:d1", "critical")), al({ severity: "fyi" }), ...gated, ...pend];
const shuffled = [...all].reverse();
ok("deterministic: the same insights in any order give the same list", JSON.stringify(I.gather([all])) === JSON.stringify(I.gather([shuffled])));
const gg = I.gather([all]);
ok("…stops first, then looks, then notes", gg.every((x, k) => k === 0 || ["stop", "look", "note"].indexOf(gg[k - 1].level) <= ["stop", "look", "note"].indexOf(x.level)));
ok("…within a level, what refuses something first", (() => { const looks = gg.filter((x) => x.level === "look"); const firstFree = looks.findIndex((x) => !x.blocks); return firstFree === -1 || looks.slice(firstFree).every((x) => !x.blocks); })());
ok("…the Advisor's own order kept among its own", (() => { const a = gg.filter((x) => x.engine === "advisor" && x.level === "stop"); return a.every((x, k) => k === 0 || a[k - 1].order >= x.order); })());
ok("visibility: an investor sees only what the investor view already shows (blockers)", I.visibleTo(gg, ["investor"]).every((x) => x.engine === "blocker") && I.visibleTo(gg, ["investor"]).length >= 1);
ok("…a member who isn't an editor sees the room's findings only", I.visibleTo(gg, ["member"]).every((x) => x.engine === "space"));
const target = gg.find((x) => x.engine === "space");
ok("acknowledged: hidden until its mark moves", !I.settle(gg, [{ id: target.id, mark: target.mark }]).some((x) => x.id === target.id) && I.settle(gg, [{ id: target.id, mark: "older" }]).some((x) => x.id === target.id));
ok("…a blocker is never hidden by an acknowledgement — its acceptance is its own state", I.settle([blkWait], [{ id: blkWait.id, mark: blkWait.mark }]).length === 1);
ok("…an alert seen again after a claim moves its mark", al({ claimed_by: "u2", occurrences: 2 }).mark !== al({ claimed_by: "u2", occurrences: 3 }).mark);
ok("stale: said by an older method than the engine's current one", I.isStale(I.fromBlocker(B("no_downside", "open"), P1, { scoreVersion: "2026-10-27.1" }), { blocker: S.SCORE_METHOD.version }) && !I.isStale(bl, { blocker: S.SCORE_METHOD.version }) && !I.isStale(I.fromSpace(f1, ROOM), { blocker: "x" }));
const one = I.primary(gg.filter((x) => x.engine !== "money"), { prefer: ["library", "space"] });
ok("the one line: stops first, then the screen's preferred engine; how many more said as a number", one.top?.level === "stop" && one.more === gg.filter((x) => x.engine !== "money").length - 1);
const stud = I.primary([...sp.filter((x) => x.level === "look"), ...gated, ...ins.filter((x) => x.level === "look")], { prefer: ["library", "space"] });
ok("…in the Studio among looks: what refuses something (the library's gate) before the room's and the Advisor's", stud.top?.engine === "library" && stud.top.blocks);
ok("…nothing to say is nothing", I.primary([]).top === null && I.primary([]).more === 0);

// ── 8b · domain, tier, source id, the one line per screen (IMS7 refinement) ──
const RULES = { advisor: ["waits_on", "over_capacity", "capacity_unchecked", "rent_decides", "channel_loses", "assumption_wrong", "risk_unplanned", "research_due", "score_top"] };
ok("every Advisor rule has a domain and a tier", RULES.advisor.every((r) => { const [d, t] = I.classify("advisor", r, "stop"); return typeof d === "string" && t >= 1 && t <= 6; }));
ok("…and every native value of the others", ["open", "in_remediation", "pending_verification", "risk_accepted", "acceptance_lapsed"].every((n) => I.classify("blocker", "x", n)[1] >= 1)
  && ["critical", "urgent", "action"].every((n) => I.classify("money", "x", n)[1] >= 1) && ["critical", "important", "fyi"].every((n) => I.classify("alert", "x", n)[1] >= 1)
  && L.STATUSES.filter((x) => x !== "approved").every((n) => I.classify("library", "status", n)[1] <= 2));
ok("tier 1 is only what's verified: a detected room error in a door, route or work zone; a critical money or alert row; a rejected or restricted asset",
  I.fromSpace({ ...f1, check: "door" }, ROOM).tier === 1 && I.fromSpace({ ...f1, check: "door", source: "site_check" }, ROOM).tier === 3 && I.fromSpace(f1, ROOM).tier === 3
  && I.fromSpace({ ...f1, check: "door", level: "warn" }, ROOM).tier === 3 && I.fromMoney(row("dispute:d1", "critical")).tier === 1 && I.fromMoney(row("invoice:v1", "urgent")).tier === 3
  && I.fromLibrary(asset("restricted"), { blockers: [] })[0].tier === 1 && I.fromLibrary(asset("candidate"), { blockers: ["b"] })[0].tier === 2);
ok("…a room's overlap is a spatial conflict (3), never safety", I.fromSpace(f1, ROOM).domain === "spatial");
ok("a required approval (2) outranks a louder financial stop (3) from the Advisor", (() => { const r = I.rank([...ins.filter((x) => x.rule === "assumption_wrong"), ...gated]); return r[0].engine === "library" && r[0].tier === 2 && r[1].level === "stop"; })());
ok("an owner's live risk acceptance is information (6), still said", I.fromBlocker(B("no_downside", "risk_accepted"), P1, { scoreVersion: "v" }).tier === 6);
ok("the source's own id is kept: blocker key, attention key, alert id, a finding's items, the Advisor's plan and rule",
  I.fromBlocker(B("no_downside", "open"), P1, { scoreVersion: "v" }).sourceId === "no_downside" && I.fromMoney(row("dispute:d1", "critical")).sourceId === "dispute:d1"
  && al({}).sourceId === "x" && I.fromSpace(f1, ROOM).sourceId === "geometry:a,b" && ins.find((x) => x.rule === "waits_on").sourceId === "p1:waits_on");
ok("…and its home screen", I.fromSpace(f1, ROOM).home === "store" && ins[0].home === "plans" && gated[0].home === "library" && I.fromMoney(row("dispute:d1", "critical")).home === "money");
const studioOnly = I.primary([...ins.filter((x) => x.tier >= 3), I.fromSpace({ ...f1, level: "warn" }, ROOM)], { surface: "store" });
ok("no repeats across screens: in the Studio, another screen's lesser finding (a plan's tier-3 stop) isn't the line — the room's is", studioOnly.top?.engine === "space" && studioOnly.more === studioOnly.all.length - 1);
ok("…but a tier 1–2 finding is the line wherever it is", I.primary([I.fromSpace({ ...f1, level: "warn" }, ROOM), ...gated], { surface: "store" }).top?.engine === "library");
ok("…and with nothing that belongs here, there's no line — only \"n more\"", (() => { const r = I.primary(ins.filter((x) => x.tier >= 3), { surface: "store" }); return r.top === null && r.more === r.all.length; })());
ok("…about the thing in hand comes first within a tier", I.primary([I.fromSpace({ ...f1, ids: ["z"], level: "warn" }, ROOM), I.fromSpace({ ...f1, ids: ["a"], level: "warn" }, ROOM)], { surface: "store", subject: "a" }).top?.related[0].id === "a"
  && I.primary([I.fromSpace({ ...f1, ids: ["z"], level: "warn" }, ROOM), I.fromSpace({ ...f1, ids: ["a"], level: "warn" }, ROOM)], { surface: "store", subject: "z" }).top?.related[0].id === "z");
ok("domain and tier never make a block: only an enforcing rule does", [...ins, ...sp, I.fromMoney(row("dispute:d1", "critical")), al({ severity: "critical" })].every((x) => !x.blocks));
ok("confidence is never made up: null unless the source has one", [...ins, ...sp, bl, ...gated].every((x) => x.confidence === null));

// ── 9 · it adapts, it doesn't decide ──────────────────────────────────────────────────────────────────────────────
const src = read("lib/insight.ts");
ok("the contract imports only types from the engines — it can't re-run or replace their logic", [...src.matchAll(/^import (.*) from/gm)].every((m) => m[1].startsWith("type ")));
ok("no single score: no field merges severity, confidence, readiness and approval", !/\bscore\s*:/.test(src) && /confidence: string \| null/.test(src) && /readiness: string \| null/.test(src) && /approval: LibraryStatus \| null/.test(src));
ok("no new store: the contract reads and writes nothing", !/supabase|fetch\(|localStorage|from\("/.test(src));
ok("fingerprints are stable across runs", I.fingerprint("waits_on|p1") === I.fingerprint("waits_on|p1") && I.fingerprint("a") !== I.fingerprint("b") && /^[0-9a-z]+$/.test(I.fingerprint("x")));
console.log(`IMS7-C — THE INSIGHT CONTRACT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
