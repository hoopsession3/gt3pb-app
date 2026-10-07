// THE AUDIT CLASSIFIERS, tested away from the filesystem.
//
// Both of these produce a number that gets quoted in a commit message and then believed. Three
// times in this audit a regex produced a confident number that was wrong in the alarming direction
// — "50 unguarded routes" was 0, "126 unnamed buttons" was 11, "5 audited tables" was 42. And the
// first version of render.audit.mjs reported 2 sync-to-prop where there are 5, because its rule
// only matched a single setState. So the rules get fixtures, and the fixtures are real code copied
// out of this repo rather than something shaped to pass.
import { classifyEffect, effectAt } from "./render.audit.mjs";
import { isFalseEmpty, catchesButHides } from "./falseempty.audit.mjs";
import { refusalHeadings, refusesWithoutPolicy, collapsesVerdicts } from "./gate.audit.mjs";
import { handRollsCrew, bypassesTaskSpine, CREW_EXEMPT, namesRoleVocabulary, rolesNamedIn, rendersRawCrewOption, peelsErrorMessageByHand } from "./dupe.audit.mjs";
import { selectsIn, topLevelParts, columnsOf, ageLine, pendingMigrations, arrivingColumns, arrivingRelations, declaresArrival } from "./columns.audit.mjs";
import { definitionsToSchema, refuseReason, projectRef } from "./schema.snapshot.mjs";
import { classify as classifyRoute, unwrapped, boundOf } from "./api.audit.mjs";
import { reassemble } from "./security.snapshot.mjs";
import { judge, staleBecause, expand } from "./security.audit.mjs";
import { darkWellCounts, selectClassShorthands, undefinedTokens } from "./design.ratchet.mjs";
import { promisesIn, PLACES, CHEVRON_CEILING, DIRECTION_CEILING } from "./affordance.audit.mjs";
import { vocabularies, wordsIn, judge as judgeWords, listOf, REFUSED_CEILING } from "./vocab.audit.mjs";
import { gesturesIn, judgeFile, staleEntries, OWN_OVERLAYS, NOT_PAGES, NO_UNSAVED, GESTURE_LAYER } from "./gesture.audit.mjs";
import { hapticsIn, judgeFile as judgeHaptics, vocabularyOf, judgeVocabulary, HOME as HAPTICS_HOME } from "./haptics.audit.mjs";
import { markupOf, namedBy, deadSelectorsIn, looseHoversIn, demanded, houseClasses, rawColours } from "./css.audit.mjs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

// ── classifyEffect ─────────────────────────────────────────────────────────────────────────────
// Real bodies, lifted from the files named beside them.
ok("client-read: localStorage (components/Kds muted flag)",
  classifyEffect(`(() => { try { setMuted(localStorage.getItem("kds_muted") === "1"); } catch {} }, [])`) === "client-read");
ok("client-read: a clock", classifyEffect(`(() => { setNow(new Date()); }, [])`) === "client-read");

ok("data-load: the plain load() effect",
  classifyEffect(`(() => { load(); }, [load])`) === "data-load");
ok("data-load: an inline supabase read (app/3mpire/page.tsx:43)",
  classifyEffect(`(() => { supabase.from("orders").select("*").then(({ data }) => setOrders(data)); }, [user])`) === "data-load");
ok("data-load beats client-read when the effect does both — a loader that also reads localStorage is still a loader",
  classifyEffect(`(() => { const k = localStorage.getItem("k"); load(k); }, [load])`) === "data-load");

ok("sync-to-prop: one setter (components/MenuManager.tsx:81)",
  classifyEffect(`(() => { setD(p); }, [p])`) === "sync-to-prop");
ok("sync-to-prop: THREE setters from the same prop (components/MerchManager.tsx:154) — the case the first rule missed",
  classifyEffect(`(() => { setD(p); setPriceStr((p.price_cents / 100).toFixed(2)); setMedia(readMedia(p)); }, [p])`) === "sync-to-prop");
ok("sync-to-prop: two deps is not the shape",
  classifyEffect(`(() => { setD(p); }, [p, q])`) === "needs-a-person");
ok("sync-to-prop: a setter that does not read the dep is not the shape",
  classifyEffect(`(() => { setOpen(false); }, [p])`) === "needs-a-person");
ok("a body doing real work is left for a person",
  classifyEffect(`(() => { if (!ref.current) return; observer.observe(ref.current); setSeen(true); }, [])`) === "needs-a-person");
ok("no body at all is left for a person", classifyEffect(null) === "needs-a-person");

// effectAt has to survive braces inside strings, which is what broke the first splitter in 0284.
{
  const src = [
    `function C() {`,
    `  useEffect(() => {`,
    `    setLabel("a } brace in a string");`,
    `  }, []);`,
    `}`,
  ].join("\n");
  const e = effectAt(src, 3);
  ok("effectAt: a brace inside a string literal does not end the effect",
    !!e && /a \} brace in a string/.test(e.body) && e.body.trim().endsWith("[])"), e?.body);
}

// ── isFalseEmpty ───────────────────────────────────────────────────────────────────────────────
const n3 = (...l) => [l[0] ?? "", l[1] ?? "", l[2] ?? ""];

ok("false-empty: the real shape (app/crew/page.tsx:1243)",
  isFalseEmpty(`    const { data } = await supabase.from("incident_log").select("id, problem");`,
    n3(`    setRows((data as Inc[]) ?? []);`)) === true);
ok("false-empty: the .then form (app/crew/page.tsx:3545)",
  isFalseEmpty(`  supabase.from("profiles").select("id").then(({ data }) => setStaff((data as P[]) ?? []));`, n3()) === true);
ok("false-empty: a renamed binding still hides the error",
  isFalseEmpty(`    const { data: p } = await supabase.from("profiles").select("id, display_name");`,
    n3(`    setStaff((p as P[]) ?? []);`)) === true);

// The negatives are the whole point: this must not flag code that already handles failure.
ok("NOT flagged: error is captured (components/Reserves.tsx:31)",
  isFalseEmpty(`    const { data, error } = await supabase.from("reserves").select("*");`,
    n3(`    if (error) { setLoadFailed(true); return; }`, `    setReserves((data as Reserve[]) ?? []);`)) === false);
ok("NOT flagged: the fixed loadOnHand (app/crew/page.tsx)",
  isFalseEmpty(`    const { data, error } = await supabase.from("inventory_ledger").select("item, qty");`,
    n3(`    if (error) { setOnHandFailed(true); return; }`)) === false);
ok("NOT flagged: an unchecked read that is NOT coalesced into state",
  isFalseEmpty(`    const { data } = await supabase.from("x").select("*");`,
    n3(`    if (!data) throw new Error("missing");`, `    return data;`)) === false);
ok("NOT flagged: a coalesce with no read on the line",
  isFalseEmpty(`    setRows(rows ?? []);`, n3()) === false);
ok("NOT flagged: a line that never touches supabase",
  isFalseEmpty(`    const { data } = await fetch("/api/x").then((r) => r.json());`,
    n3(`    setRows(data ?? []);`)) === false);
ok("NOT flagged: the read is coalesced but nothing is set within reach",
  isFalseEmpty(`    const { data } = await supabase.from("x").select("*");`,
    n3(`    const list = data ?? [];`, `    // ... 20 lines later`, `    return list;`)) === false);

// ── catchesButHides ────────────────────────────────────────────────────────────────────────────
// This rule exists because I walked into the hole it guards: three components were converted to
// useAsyncData, the first count dropped, and every render still did `state.data ?? []` — the read
// was honest and the screen still lied. Catching an error is not showing it.
ok("hides: useAsyncData with data ?? [] and nothing else",
  catchesButHides(`const s = useAsyncData(loader, []); const rows = s.data ?? []; return <ul>{rows.map(r => <li/>)}</ul>;`) === true);
ok("shows: AsyncSection renders the failure",
  catchesButHides(`const s = useAsyncData(loader, []); return <AsyncSection state={s} emptyTitle="None">{(d) => null}</AsyncSection>;`) === false);
ok("shows: an explicit status === \"error\" branch",
  catchesButHides(`const s = useAsyncData(loader, []); if (s.status === "error") return <Err/>; return null;`) === false);
ok("shows: reading .error directly",
  catchesButHides(`const s = useAsyncData(loader, []); return s.error ? <Err/> : null;`) === false);
ok("handling only 'loading' is NOT handling failure (components/PrimalLesson.tsx)",
  catchesButHides(`const b = useAsyncData(loader, []); if (b.status === "loading") return <Spin/>; return <X d={b.data}/>;`) === true);
ok("a file that never loads anything is not in scope",
  catchesButHides(`export function Static() { return <p>hi</p>; }`) === false);

// ── the gate audit ─────────────────────────────────────────────────────────────────────────────
// This rule caught a real bug on its first run: app/architecture said "Owners only" on
// roleOf(profile) === "owner", so the owner was refused the owner-only page while his profile
// loaded. The sweep that fixed crew, scan, academy and driver had missed it, because a sweep finds
// what you thought to look for. That is the whole argument for the rule.
ok("refusal heading is recognised (app/scan/page.tsx:68)",
  refusalHeadings(`<div className="h-title">Staff only</div>`).length === 1);
ok("refusal heading with a trailing period (app/crew/page.tsx:5375)",
  refusalHeadings(`<div className="h-title">Staff only.</div>`).length === 1);
ok("the exact heading that was live in app/architecture",
  refusalHeadings(`<div className="h-title">Owners only</div>`).length === 1);
ok("an ordinary page heading is not a refusal (app/academy/page.tsx:158)",
  refusalHeadings(`<h1 className="h-title">GT3 Academy</h1>`).length === 0);
ok("a styled heading with an interpolated title is not a refusal",
  refusalHeadings(`<h1 className="h-title" style={{ fontSize: 28 }}>{m.title}</h1>`).length === 0);

ok("caught: refusing with no policy import",
  refusesWithoutPolicy(`<div className="h-title">Staff only</div>`) === true);
ok("passes: the same refusal routed through lib/access",
  refusesWithoutPolicy(`import { staffAccess } from "@/lib/access";\n<div className="h-title">Staff only</div>`) === false);
ok("passes: a relative import of the same module",
  refusesWithoutPolicy(`import { staffAccess } from "../lib/access";\n<div className="h-title">Staff only</div>`) === false);
// The three strings that made "ban every occurrence of 'Staff only'" the wrong rule. None of them
// is aimed at the reader, and a rule that failed on all three would have been suppressed by now.
ok("not a refusal: an audience <option> (components/AssignTaskSheet.tsx:84)",
  refusesWithoutPolicy(`<option value="leadership">Leadership only</option>`) === false);
ok("not a refusal: a broadcast audience label (components/BroadcastEditor.tsx:21)",
  refusesWithoutPolicy(`const AUDIENCES = [["all","Everyone"],["staff","Staff only"]] as const;`) === false);
ok("not a refusal: a toast quoting the server's own refusal (components/crew/LiveControl.tsx:73)",
  refusesWithoutPolicy(`toast(error.message.includes("not authorized") ? "Go live failed — your account isn't an owner/admin." : "x");`) === false);

// The second measure — importing the fix is not the same as respecting it.
ok("caught: isAllowed() as the only check collapses wait and failed back into deny",
  collapsesVerdicts(`import { staffAccess, isAllowed } from "@/lib/access";\nconst a = staffAccess(u, s, p); if (!isAllowed(a)) return <StaffOnly/>;`) === true);
ok("caught: handling 'wait' but not 'failed' — a failed read still reads as a refusal",
  collapsesVerdicts(`import { staffAccess } from "@/lib/access";\nconst a = staffAccess(u, s, p); if (a === "wait") return null;`) === true);
ok("passes: both non-denial verdicts named (app/driver/page.tsx:23)",
  collapsesVerdicts(`import { staffAccess } from "@/lib/access";\nconst a = staffAccess(u, s, p);\nreturn a === "wait" || a === "failed" ? <Checking/> : null;`) === false);
ok("out of scope: importing only the type, never computing a verdict",
  collapsesVerdicts(`import type { Access } from "@/lib/access";\nexport function f(a: Access) { return a; }`) === false);
ok("out of scope: a file that never touches lib/access",
  collapsesVerdicts(`export function Static() { return <p>hi</p>; }`) === false);

// ── the duplication ratchets ───────────────────────────────────────────────────────────────────
// Both consolidations these guard already exist, already have a header explaining why, and were
// already half-abandoned: useCrew's own comment says "four screens" when it was twelve and the
// hook had one importer. A consolidation without a rule is a coincidence.
ok("caught: a new hand-rolled crew fetch",
  handRollsCrew(`supabase.from("profiles").select("id, display_name").neq("role", "member")`, "components/New.tsx") === true);
ok("caught: the same query split across lines, as every real call site writes it",
  handRollsCrew(`supabase.from("profiles")\n  .select("id, display_name, role")\n  .neq("role", "member")\n  .order("display_name")`, "components/New.tsx") === true);
ok("passes: a board that renders people AS data, exempt by name",
  handRollsCrew(`supabase.from("profiles").select("id").neq("role", "member")`, "components/WorkloadBoard.tsx") === false);
ok("not flagged: reading profiles for something that is not the picker",
  handRollsCrew(`supabase.from("profiles").select("points, credit_cents").eq("id", me)`, "components/X.tsx") === false);
ok("the exemptions are a named list, not a pattern that could widen by accident", CREW_EXEMPT.size === 9);
// The exemption list carries TWO different reasons and the difference is load-bearing: a picker may
// degrade to an empty list, an attribution or notification list may not. These assert that the
// files decided on the second reason are actually exempt, so a later tidy-up cannot quietly convert
// them and turn "we could not read the crew" into "every comment was written by Crew".
ok("exempt: comment attribution — an empty crew list renames every author, it does not shorten a list",
  handRollsCrew(`supabase.from("profiles").select("id, display_name").neq("role", "member")`, "components/Discussions.tsx") === false);
ok("exempt: a strategy thread's authors, same reason",
  handRollsCrew(`supabase.from("profiles").select("id, display_name, role").neq("role", "member")`, "components/StrategyCollab.tsx") === false);
ok("exempt: ProposalDesk also picks WHO IS ALERTED — an empty list notifies nobody, silently",
  handRollsCrew(`supabase.from("profiles").select("id, display_name, role").neq("role", "member")`, "components/ProposalDesk.tsx") === false);
ok("exempt: the roster screen itself — the crew IS the data there",
  handRollsCrew(`supabase.from("profiles").select("*").neq("role", "member")`, "app/crew/page.tsx") === false);
ok("still caught: an ordinary picker in a file nobody exempted",
  handRollsCrew(`supabase.from("profiles").select("id, display_name").neq("role", "member")`, "components/Goals.tsx") === true);

ok("caught: a direct event_tasks insert in a component",
  bypassesTaskSpine(`await supabase.from("event_tasks").insert({ label })`, "components/Y.tsx") === true);
ok("passes: the write spine itself", bypassesTaskSpine(`supabase.from("event_tasks").insert(x)`, "lib/tasks.ts") === false);
ok("passes: a server agent route — supabaseAdmin has no client session, so lib/tasks is unavailable",
  bypassesTaskSpine(`supabaseAdmin.from("event_tasks").insert(rows)`, "app/api/agents/recap/route.ts") === false);
ok("not flagged: reading event_tasks is not writing them",
  bypassesTaskSpine(`supabase.from("event_tasks").select("id, label")`, "components/Z.tsx") === false);

// The DELETE half, added 2026-09-11. Both cases below are the code that was in app/crew/page.tsx
// VERBATIM until this round, and both passed the insert-only check — which is the point: the rule
// said "write spine" and enforced "insert", so the two writes whose errors were being discarded
// were the two the gate could not see.
ok("caught: a direct event_tasks delete by id — the insert-only check let this through",
  bypassesTaskSpine(`await supabase.from("event_tasks").delete().eq("id", t.id);`, "app/crew/page.tsx") === true);
ok("caught: a direct event_tasks delete by parent column",
  bypassesTaskSpine(`supabase.from("event_tasks").delete().eq(ownerCol, target.id),`, "app/crew/page.tsx") === true);
ok("passes: the spine's own deletes", bypassesTaskSpine(
  `supabase.from("event_tasks").delete().in("id", ids)`, "lib/tasks.ts") === false);
// A todos delete is the other table's business — deleteTask routes both, but this check is the
// event_tasks one and must not start reporting todos as if it covered them.
ok("not flagged: a todos delete is not an event_tasks write",
  bypassesTaskSpine(`supabase.from("todos").delete().eq("id", id)`, "components/Z.tsx") === false);

// ── the column contract ────────────────────────────────────────────────────────────────────────
// The parser IS the checker, and it was wrong twice before it was right. Both wrong versions are
// fixtures below, because the failure mode of a schema checker is a confident complaint about code
// that is fine — which is the thing this repo has watched a regex do eight times.
ok("columns: the 62af8ef shape — a guessed column list, read as four columns",
  JSON.stringify(columnsOf("id, title, day, kind").cols) === '["id","title","day","kind"]');
ok("columns: select(*) names nothing to check", columnsOf("*").cols.length === 0);
ok("columns: an alias is not a column — the column is the right-hand side",
  JSON.stringify(columnsOf("who:display_name, id").cols) === '["display_name","id"]');
ok("columns: an embedded resource is SKIPPED, not parsed as a column name",
  columnsOf("id, vendors(name, id)").cols.length === 1 && columnsOf("id, vendors(name, id)").skipped.length === 1);
ok("columns: a comma inside an embedded resource does not split the list",
  topLevelParts("id, vendors(name, id), day").length === 3);
ok("columns: a cast reduces to its column", JSON.stringify(columnsOf("total_cents::int").cols) === '["total_cents"]');

// THE PAIRING BUG. The first version used a fixed 600-character window after .from(, which walks
// straight past the end of the statement: event_tasks appeared to select reorder_point and
// use_cases, columns that belong to an inventory_items chain further down the same file.
{
  const src = [
    `const a = await supabase.from("event_tasks").select("id, label").eq("done", false);`,
    `const b = await supabase.from("inventory_items").select("id, reorder_point, use_cases");`,
  ].join("\n");
  const f = selectsIn(src);
  ok("columns: each select pairs with its OWN from — the two-chain case that broke the first version",
    f.length === 2 && f[0].relation === "event_tasks" && f[0].select === "id, label" && f[1].relation === "inventory_items", f);
}
{
  const f = selectsIn(`supabase.from("events").eq("day", d).order("sort").select("id, title")`);
  ok("columns: chained filters between from() and select() do not break the pairing",
    f.length === 1 && f[0].relation === "events" && f[0].select === "id, title", f);
}
{
  const f = selectsIn(`await supabase.from("alert_reads").delete().eq("id", x);\nawait supabase.from("alerts").select("id, title");`);
  ok("columns: a from() with no select of its own borrows nobody else's", f.length === 1 && f[0].relation === "alerts", f);
}

// ── the snapshot puller ────────────────────────────────────────────────────────────────────────
// The check above has printed NOT CHECKED since 2026-09-11 because refreshing its snapshot meant a
// browser session and a copy-paste. npm run schema:snapshot is now the one home for that refresh —
// and the thing that can go wrong with an automated refresh is worse than the thing it fixes: a
// half-working fetch writes a SMALL snapshot, and a small snapshot makes the checker report dozens
// of live tables as deleted. Every refusal below is that case.
ok("snapshot: PostgREST's Swagger-2 shape (definitions) reads as relations and columns",
  JSON.stringify(definitionsToSchema({ definitions: { events: { properties: { id: {}, day: {} } } } })) === '{"events":["day","id"]}');
ok("snapshot: the OpenAPI-3 shape (components.schemas) reads the same — which spelling a version emits is not a format change",
  JSON.stringify(definitionsToSchema({ components: { schemas: { events: { properties: { id: {}, day: {} } } } } })) === '{"events":["day","id"]}');
ok("snapshot: a definition with no properties is a response envelope, not an empty table",
  JSON.stringify(definitionsToSchema({ definitions: { events: { properties: { id: {} } }, "rpc.args": {} } })) === '{"events":["id"]}');
ok("snapshot: an unrecognised document yields nothing rather than throwing",
  JSON.stringify(definitionsToSchema({ paths: {} })) === "{}");

{
  // A plausible healthy pull: 60 relations, with the ones the app reads among them.
  const healthy = {};
  for (let i = 0; i < 60; i++) healthy[`t${i}`] = ["id"];
  const needed = ["t1", "t2", "t3"];
  ok("snapshot: a healthy pull is written", refuseReason(healthy, needed) === null);

  ok("snapshot: REFUSED — nothing came back at all",
    /no relations at all/.test(refuseReason({}, needed) || ""));
  ok("snapshot: REFUSED — a handful of relations is a fetch that landed somewhere else, not a database",
    /only 3 relations/.test(refuseReason({ a: ["id"], b: ["id"], c: ["id"] }, needed) || ""));

  // THE ONE THAT MATTERS. One absent relation is a real deletion and MUST be written so the checker
  // fails on it; ten absent is a broken fetch and must not be written at all. A refusal rule that
  // swallowed the first would hide the exact defect this whole check exists to catch.
  const oneGone = { ...healthy }; delete oneGone.t1;
  ok("snapshot: ONE missing relation is still written — that is a real finding, and the checker reports it",
    refuseReason(oneGone, needed) === null);
  const manyNeeded = Array.from({ length: 40 }, (_, i) => `t${i}`);
  const tenGone = { ...healthy };
  for (let i = 0; i < 10; i++) delete tenGone[`t${i}`];
  ok("snapshot: TEN missing is refused — no migration drops ten tables the app still reads",
    /10 of the 40 relations/.test(refuseReason(tenGone, manyNeeded) || ""));
}

// The age line prints on a PASS too. A snapshot pulled in March passes exactly as loudly as one
// pulled this morning, and that silence is how a check stops being about the database.
{
  const now = Date.parse("2026-09-28T12:00:00Z");
  const at = (iso) => ageLine({ pulled_at: iso, project: "abcdef" }, now);
  ok("age: no snapshot record at all says so rather than guessing", /no provenance/.test(ageLine(null, now)));
  ok("age: a record with no date says so", /no provenance/.test(ageLine({ project: "x" }, now)));
  ok("age: an unparseable date is named, not silently treated as now", /unreadable/.test(at("not-a-date")));
  ok("age: pulled today", at("2026-09-28T09:00:00Z") === "snapshot pulled today from abcdef", at("2026-09-28T09:00:00Z"));
  ok("age: one day is singular", at("2026-09-27T09:00:00Z") === "snapshot pulled 1 day ago from abcdef", at("2026-09-27T09:00:00Z"));
  ok("age: five days", at("2026-09-23T09:00:00Z") === "snapshot pulled 5 days ago from abcdef", at("2026-09-23T09:00:00Z"));
  ok("age: a month old says it is worth refreshing — the 2026-09-11 state, named instead of implied",
    /stale enough/.test(at("2026-08-20T09:00:00Z")), at("2026-08-20T09:00:00Z"));
  ok("age: a clock-skewed future date does not render as negative days",
    at("2026-10-05T09:00:00Z") === "snapshot pulled today from abcdef", at("2026-10-05T09:00:00Z"));
}

ok("snapshot: provenance records the project ref — never the key, never the whole URL",
  projectRef("https://abcdefghij.supabase.co") === "abcdefghij");
ok("snapshot: an unrecognised URL records no project rather than a fragment of one",
  projectRef("") === null && projectRef("not a url") === null);

// ── the role vocabulary ────────────────────────────────────────────────────────────────────────
// The four maps this replaced, in the shape they were actually written, plus the four things that
// look similar and must stay silent. Every "passes:" case below is real code still in the repo — a
// classifier tested only against what it should catch is half tested.
ok("caught: a bare label map, which is what OrgChart had",
  namesRoleVocabulary(`const ROLE_LABEL = { owner: "Owner", admin: "Admin", event_manager: "Event Manager", member: "Member" };`, "components/X.tsx") === true);
ok("caught: label nested one level, which is the shape the team console and the offer letter actually had",
  namesRoleVocabulary(`const M = { owner: { label: "Owner", tone: "red" }, admin: { label: "Admin" }, server: { label: "Server" } };`, "components/X.tsx") === true);
ok("the nested pattern does not leak across entries — two labelled entries and one bare object is still two",
  namesRoleVocabulary(`const M = { owner: { label: "Owner" }, admin: { label: "Admin" }, server: { tone: "cream" } };`, "components/X.tsx") === false);
ok("caught: single quotes and odd spacing",
  namesRoleVocabulary(`const m={owner :'Owner',admin:  'Admin',\n server:'Server'}`, "components/X.tsx") === true);
ok("passes: lib/roles.ts itself — the one canonical home",
  namesRoleVocabulary(`export const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" };`, "lib/roles.ts") === false);
ok("passes: OperatorNav — a role keyed to the SECTIONS it unlocks is not a name",
  namesRoleVocabulary(`const S = { owner: ["day","now"], admin: ["day"], event_manager: ["day","plan"] };`, "components/OperatorNav.tsx") === false);
ok("passes: APP_TO_ACADEMY — a mapping into another vocabulary, not a naming of this one",
  namesRoleVocabulary(`const A = { owner: "founder", admin: "admin", member: "staff", server: "operator" };`, "app/academy/page.tsx") === false);
ok("passes: the team console's ROLE_META as it now stands — scope and tone, no label",
  namesRoleVocabulary(`const M = { owner: { scope: "Full access", tone: "red" }, admin: { scope: "Full access", tone: "red" }, member: { scope: "Customer", tone: "muted" } };`, "app/crew/page.tsx") === false);
ok("two keys is under the threshold, on purpose — a pair of properties is not yet a map",
  namesRoleVocabulary(`const x = { owner: "Owner", admin: "Admin" };`, "components/X.tsx") === false);
ok("it reports WHICH roles a file names, deduped and sorted, so the failure message says what to convert",
  rolesNamedIn(`{ owner: "Owner", server: "Server", owner: "Owner" }`).join(",") === "owner,server");
ok("a file mixing both shapes reports the union",
  rolesNamedIn(`{ owner: "Owner", admin: { label: "Admin" } }`).join(",") === "admin,owner");

// ── how a crew member reads in a dropdown ──────────────────────────────────────────────────────
// There are two Ryan profiles in production — an owner who uses the app daily and an operator
// account that has never signed in — and every assign dropdown listed "Ryan" twice with nothing to
// tell them apart. crewLabel() renders "Ryan · Owner" and had one caller out of nine.
const CREWY = 'import { useCrew, crewLabel } from "./useCrew";\n';
ok("caught: a bare display_name in an option, in a file that uses the crew hook",
  rendersRawCrewOption(CREWY + `{crew.map((c) => <option key={c.id} value={c.id}>{c.display_name || "Crew"}</option>)}`, "components/X.tsx") === true);
ok("caught: the other spelling of the same mistake",
  rendersRawCrewOption(CREWY + `{staff.map((s) => <option key={s.id} value={s.id}>{s.display_name || "Unnamed"}</option>)}`, "components/X.tsx") === true);
ok("passes: the option renders crewLabel",
  rendersRawCrewOption(CREWY + `{crew.map((c) => <option key={c.id} value={c.id}>{crewLabel(c)}</option>)}`, "components/X.tsx") === false);
ok("passes: useCrew.ts itself, which is where crewLabel lives",
  rendersRawCrewOption(`<option>{c.display_name}</option>`, "components/useCrew.ts") === false);
ok("out of scope: a display_name in an option in a file that never touches the crew hook",
  rendersRawCrewOption(`{vendors.map((v) => <option key={v.id}>{v.display_name}</option>)}`, "components/Vendors.tsx") === false);
ok("not flagged: display_name rendered somewhere that is not an option",
  rendersRawCrewOption(CREWY + `<div className="who">{c.display_name}</div>`, "components/X.tsx") === false);


// ── THE COLUMN THAT DOES NOT EXIST YET (2026-10-01) ────────────────────────────────────────────
// Migrations here are pasted by hand AFTER the push, so between a deploy and the paste the code
// runs against the previous schema. A column added by a written-but-unapplied migration is not a
// typo, and treating it as one deadlocked a release: the snapshot can only learn about
// brew_vessels.min_gal from production, production only learns about it when 0337 is pasted, and
// the bundle carrying 0337 was held because the check failed. There was nothing to refresh.
//
// WHAT IS PENDING IS THE PASTE FILE'S OWN CONTENTS. This used to read `pending-from` and scan the
// migrations directory for everything at or above it, and that was wrong in both directions — see
// the header in columns.audit.mjs. The two regressions have tests of their own below, named.
// The fixtures below are STRINGS, passed straight to the parser — the only path that touches disk
// is the one test that asks what an unreadable file does, and it points at a name in an empty temp
// directory. Nothing is written, so nothing can be left behind for the next run to read.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
const tmp = mkdtempSync(join(tmpdir(), "cols-"));

// The generated shape, copied from scripts/migrations.pending.mjs's own emitter rather than
// imagined: a banner, the filename, a banner, then that migration's text.
const BAR = "-- ============================================================";
const section = (name, body) => [BAR, `-- ${name}`, BAR, body, ""].join("\n");
const paste = (count, ...sections) =>
  ["-- generated", "-- pending-from: 0338", `-- pending-count: ${count}`, "", ...sections].join("\n");

const EARLY = "alter table public.shop_orders add column apliiq_submit_started_at timestamptz;";
const LATE = [
  "-- A header that QUOTES an older statement:",
  "--   alter table public.brew_vessels add column quoted_in_a_comment numeric",
  "alter table public.brew_vessels add column if not exists min_gal numeric;",
  "create table if not exists public.new_thing (",
  "  id uuid primary key default gen_random_uuid(),",
  "  label text not null,",
  "  constraint new_thing_label_len check (length(label) < 80)",
  ");",
].join("\n");

const twoPending = paste(2, section("0336_before.sql", EARLY), section("0337_adds.sql", LATE));

const pm = pendingMigrations(twoPending);
ok("pending: both sections of the paste file are found", pm !== null && pm.size === 2, pm && [...pm.keys()]);
ok("pending: a file with no pending-count header is not the generated shape — null, not empty",
  pendingMigrations("alter table x add column y text;") === null);
ok("pending: an unreadable file yields null, never a guess at zero",
  pendingMigrations(null, join(tmp, "nope.sql")) === null);
// The parse checking itself against the file's own count. A section regex that quietly matched
// nothing would report "nothing is arriving", and that reads exactly like a pass.
ok("pending: a section count that disagrees with pending-count is a failed read, not an empty one",
  pendingMigrations(paste(2, section("0336_before.sql", EARLY))) === null);
// Nothing pending is a real, common answer and must be distinguishable from a failed read.
ok("pending: nothing pending is an EMPTY map, not null",
  pendingMigrations(paste(0))?.size === 0);
// A migration's prose naming another migration's file must not open a section.
ok("pending: a filename mentioned in a migration's own prose is not a section start",
  pendingMigrations(paste(1, section("0337_adds.sql",
    "-- supersedes 0336_before.sql\nalter table public.stops add column later_col text;")))?.size === 1);

const arr = arrivingColumns(pm);
ok("arriving: a column a pending migration adds is found",
  arr.get("brew_vessels.min_gal") === 337, [...arr]);
// THE REGRESSION. `pending-from` is the HIGHEST file in the directory, so scanning `>= it` opened
// only the last pending migration. A column the EARLIER one adds was called a typo, and would have
// failed a release that was correct.
ok("arriving: a column the EARLIER of two pending migrations adds is found too",
  arr.get("shop_orders.apliiq_submit_started_at") === 336, [...arr.keys()]);
ok("arriving: create table columns are found as well as add column",
  arr.get("new_thing.id") === 337 && arr.get("new_thing.label") === 337);
ok("arriving: a table constraint is not mistaken for a column",
  arr.has("new_thing.constraint") === false && arr.has("new_thing.new_thing_label_len") === false, [...arr.keys()]);
// The trap three gates in smoke.cjs fell into on 2026-09-30, and these files explain themselves
// at length — a header quoting an old statement must not read as a declaration.
ok("arriving: a statement quoted inside a COMMENT is not a declaration",
  arr.has("brew_vessels.quoted_in_a_comment") === false, [...arr.keys()]);
// THE OTHER REGRESSION, and the one that was live. With nothing pending, `pending-from` still named
// the highest APPLIED migration, so every column it added stayed excusable for ever. The old
// comment claimed the check "retires itself" once the paste lands. It had no way to notice.
ok("arriving: with nothing pending, NOTHING is arriving — an applied migration excuses no column",
  arrivingColumns(pendingMigrations(paste(0))).size === 0);
// A null parse means the pending set could not be read. That must mean "exempt nothing", never
// "exempt everything" — a failed read is not an empty list, in the direction that stays strict.
ok("arriving: an unreadable pending set exempts nothing",
  arrivingColumns(null).size === 0);

// A TABLE that arrives (2026-10-04): 0342 creates compliance_checks and the rule sheet reads it.
ok("arriving: a table a pending migration creates is found, with its migration",
  arrivingRelations(pm).get("new_thing") === 337 && arrivingRelations(pm).size === 1, [...arrivingRelations(pm)]);
ok("arriving: a create table quoted in a COMMENT is not a table",
  !arrivingRelations(pendingMigrations(paste(1, section("0337_adds.sql", "-- create table public.ghost (\n--   id uuid\n-- );\nselect 1;")))).has("ghost"));
ok("arriving: with nothing pending, or an unreadable pending set, no table is arriving",
  arrivingRelations(pendingMigrations(paste(0))).size === 0 && arrivingRelations(null).size === 0);

ok("arriving: a call site declares it survives the gap with the marker",
  declaresArrival("// arrives-with: 0337 — falls back\nconst x = 1;", 337) === true);
ok("arriving: …and the number must match, so an old marker does not cover a new column",
  declaresArrival("// arrives-with: 0330 — something else", 337) === false);
ok("arriving: silence is not a declaration",
  declaresArrival("const x = 1; // we handle it, honest", 337) === false);

// ── api.audit: guarded / public / silent ───────────────────────────────────────────────────────
// Shapes lifted from app/api. The trap this guards against is the one that produced "50 unguarded
// routes" above: a word in a comment counting as (or failing to count as) the real thing.
ok("api: a route calling a house guard in code is guarded (app/api/office/route.ts shape)",
  classifyRoute(`import { userFromRequest } from "@/lib/apiAuth";\nexport async function GET(req) { const u = await userFromRequest(req); }`) === "guarded");
ok("api: a webhook that compares a signature is guarded (timingSafeEqual)",
  classifyRoute(`import { timingSafeEqual } from "node:crypto";\nexport async function POST(req) { if (!timingSafeEqual(a, b)) return bad(); }`) === "guarded");
ok("api: a guard named only in a comment is NOT a guard",
  classifyRoute(`// we rely on userFromRequest( upstream\nexport async function GET() { return ok(); }`) === "silent");
ok("api: a guard named only in a block comment is NOT a guard",
  classifyRoute(`/* staffFromRequest( is called by the caller */\nexport async function GET() { return ok(); }`) === "silent");
ok("api: a route with no guard and a real public: line is public by declaration",
  classifyRoute(`// public: read-only menu prices; nothing here a guest cannot already see at the window\nexport async function GET() { return ok(); }`) === "public");
ok("api: a public: line too short to be a reason does not count",
  classifyRoute(`// public: yes\nexport async function GET() { return ok(); }`) === "silent");
ok("api: public: must be its own comment line, not buried in code",
  classifyRoute(`const why = "public: this is a string, not a declaration, long enough";\nexport async function GET() { return ok(); }`) === "silent");
ok("api: an inline session read is a second copy of lib/apiAuth, not a guard (the old app/api/office shape)",
  classifyRoute(`import { supabaseAdmin } from "@/lib/supabaseAdmin";\nexport async function POST(req) { const { data } = await supabaseAdmin.auth.getUser(token); if (!data.user) return no(); }`) === "silent");
ok("api: a guarded route with a stray public: line is still reported as guarded, not public",
  classifyRoute(`// public: left over from before the guard was added, long enough\nimport { staffFromRequest } from "@/lib/apiAuth";\nexport async function GET(req) { await staffFromRequest(req); }`) === "guarded");

// ── api.audit: the bound ───────────────────────────────────────────────────────────────────────
// A public write names the shared-store cap that bounds it, or the audit names the route. The
// file-reading hop is injected so these never touch the tree.
{
  const files = { "lib/intake.ts": `export async function file(a) { await a.rpc("rate_limit_hit", { p_bucket: "x", p_window_ms: 1, p_max: 1 }); }`, "lib/prose.ts": `// rate_limit_hit( is mentioned here, in prose only\nexport const x = 1;` };
  const read = (p) => { if (!(p in files)) throw new Error("ENOENT"); return files[p]; };
  const W = `import { route } from "@/lib/apiRoute";\nasync function post() { return ok(); }\nexport const POST = route("x", post);`;
  ok("bound: a public GET is not a write and needs none",
    boundOf(`// public: read-only, long enough to count\nasync function get() {}\nexport const GET = route("x", get);`, read).writes === false);
  ok("bound: a POST that calls rate_limit_hit itself is bounded by its own code (the waitlist shape)",
    (() => { const b = boundOf(`${W}\nconst { data } = await supabaseAdmin.rpc("rate_limit_hit", { p_bucket: "b", p_window_ms: 60000, p_max: 30 });`, read); return b.writes && b.bounded && b.via === "its own code"; })());
  ok("bound: rate_limit_hit in a comment is not a bound",
    boundOf(`${W}\n// we call supabaseAdmin.rpc("rate_limit_hit") upstream, promise`, read).bounded === false);
  ok("bound: a module-scope counter is not a bound",
    boundOf(`let n = 0; const MAX = 60;\n${W}`, read).bounded === false);
  ok("bound: bounded-by a file that calls the limiter is bounded, via that file",
    (() => { const b = boundOf(`// bounded-by: lib/intake.ts — new rows an hour\n${W}`, read); return b.bounded && b.via === "lib/intake.ts"; })());
  ok("bound: bounded-by a file that only mentions the limiter in prose is NOT bounded, and says so",
    (() => { const b = boundOf(`// bounded-by: lib/prose.ts\n${W}`, read); return b.bounded === false && /calls no rate_limit_hit/.test(b.via); })());
  ok("bound: bounded-by a file that does not exist is NOT bounded, and says so",
    (() => { const b = boundOf(`// bounded-by: lib/nowhere.ts\n${W}`, read); return b.bounded === false && /not found/.test(b.via); })());
  ok("bound: PUT, PATCH and DELETE are writes too",
    ["PUT", "PATCH", "DELETE"].every((m) => boundOf(`async function h() {}\nexport const ${m} = route("x", h);`, read).writes === true));
}

// ── api.audit: the wrapper ─────────────────────────────────────────────────────────────────────
ok("wrapper: the house shape is clean",
  unwrapped(`import { route } from "@/lib/apiRoute";\nasync function post(req) { return ok(); }\nexport const POST = route("x", post);`).length === 0);
ok("wrapper: export async function POST is outside the house",
  unwrapped(`export async function POST(req) { return ok(); }`).join() === "POST");
ok("wrapper: export function GET (not async) is outside the house",
  unwrapped(`export function GET() { return ok(); }`).join() === "GET");
ok("wrapper: export const GET = async () => … is outside the house",
  unwrapped(`export const GET = async () => ok();`).join() === "GET");
ok("wrapper: an export list — export { get as GET } — is outside the house, wherever on the line",
  unwrapped(`const get = async () => ok(); export { get as GET };`).join() === "GET");
ok("wrapper: export { POST } of a bare function is outside the house",
  unwrapped(`async function POST() { return ok(); }\nexport { POST };`).join() === "POST");
ok("wrapper: two handlers, one wrapped, names only the bare one",
  unwrapped(`async function get() {}\nexport const GET = route("x", get);\nexport async function POST() {}`).join() === "POST");
ok("wrapper: a bare handler in a comment does not count",
  unwrapped(`// export async function POST(req) — the old shape\nasync function post() {}\nexport const POST = route("x", post);`).length === 0);
ok("wrapper: export const runtime/maxDuration are not handlers",
  unwrapped(`export const runtime = "nodejs";\nexport const maxDuration = 60;`).length === 0);

// ── dupe.audit: a thrown value's message has one home ─────────────────────────────────────────
ok("errmsg: the plain idiom is a copy", peelsErrorMessageByHand(`catch (e: any) { return bad(String(e?.message ?? e).slice(0, 300)); }`, "app/api/x/route.ts"));
ok("errmsg: the cast idiom is a copy", peelsErrorMessageByHand(`catch (e) { return bad(String((e as Error)?.message ?? e)); }`, "lib/x.ts"));
ok("errmsg: the instanceof idiom is a copy", peelsErrorMessageByHand(`catch (e) { setErr(e instanceof Error ? e.message : String(e)); }`, "components/X.tsx"));
ok("errmsg: a .message read off a response body is not (it has no fallback to the value)", !peelsErrorMessageByHand(`return bad(session.error?.message ?? "Stripe error.");`, "app/api/x/route.ts"));
ok("errmsg: the home itself is not a copy", !peelsErrorMessageByHand(`return String(e?.message ?? e);`, "lib/errorMessage.ts"));
ok("errmsg: the idiom quoted in a comment is not a copy", !peelsErrorMessageByHand(`// used to be String(e?.message ?? e)\nreturn errorMessage(e);`, "lib/x.ts"));
ok("errmsg: the call to the home is not a copy", !peelsErrorMessageByHand(`catch (e) { return bad(errorMessage(e, 300)); }`, "app/api/x/route.ts"));

// ── security.snapshot + security.audit: every leak shape, measured by the REAL query ────────────
// The fixture is a database, not a JSON file: scripts/security.snapshot.sql runs here exactly as it
// runs in the Supabase editor, so a shape the query stopped seeing would fail here first. One table
// of each kind: RLS off and granted (the leak), granted to nobody, world-readable, guest-writable,
// RLS on with no policy (closed), an owner-run view, an invoker view, a definer function the API
// may call, one it may not, and a plain function (not a definer; must not be listed).
{
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.schema_migrations (seq int, name text); insert into public.schema_migrations values (1, 'a'), (2, 'b');
    create or replace function public.is_staff() returns boolean language sql stable security definer as $$ select true $$;
    grant execute on function public.is_staff() to anon, authenticated;
    create or replace function public.internal_only() returns boolean language sql stable security definer as $$ select true $$;
    revoke execute on function public.internal_only() from public, anon, authenticated;
    create or replace function public.plain() returns boolean language sql stable as $$ select true $$;
    create table public.leak (id int); grant select on public.leak to anon;
    create table public.service_only (id int);
    create table public.menu_items (id int); alter table public.menu_items enable row level security;
    grant select on public.menu_items to anon, authenticated;
    create policy "public read" on public.menu_items for select using (true);
    create policy "staff write" on public.menu_items for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
    create table public.guestbook (id int); alter table public.guestbook enable row level security;
    grant insert on public.guestbook to anon;
    create policy "anyone writes" on public.guestbook for insert to anon with check (true);
    create table public.closed (id int); alter table public.closed enable row level security; grant select on public.closed to authenticated;
    create view public.v_owner as select id from public.menu_items; grant select on public.v_owner to anon;
    create view public.v_inv as select id from public.menu_items; alter view public.v_inv set (security_invoker = on); grant select on public.v_inv to anon;
    -- fourteen ordinary tenant tables, so the document spans several 2000-character rows (the refusals below need more than one)
    ${Array.from({ length: 14 }, (_, i) => `create table public.plain_${i} (id int, tenant_id uuid); alter table public.plain_${i} enable row level security; grant select on public.plain_${i} to authenticated; create policy "tenant isolation" on public.plain_${i} as restrictive for all using (tenant_id = tenant_id); create policy "staff read" on public.plain_${i} for select using ((select public.is_staff()));`).join("\n")}
  `);
  const rows = (await db.query(readFileSync(new URL("./security.snapshot.sql", import.meta.url), "utf8"))).rows;
  const r = reassemble(rows);
  ok("security: the query's rows reassemble and the digest row agrees", !r.error, r.error);
  const snap = r.json || { t: {}, f: [], x: [] };
  ok("security: the compact shape names every relation and definer function", Object.keys(snap.t).length === 22 && snap.f.length === 2, [Object.keys(snap.t).length, snap.f.length]);
  ok("security: the fixture spans several rows, so the refusals below mean something", rows.length >= 3, rows.length);
  ok("security: expressions are stored once and policies point at them", snap.x.includes("true") && snap.t.menu_items[7][0][4] === snap.x.indexOf("true"));
  const v = judge(snap, {});
  ok("security: RLS off + a grant is the hard finding", v.hard.some((h) => h.startsWith("rls-off: leak")), v.hard);
  ok("security: a guest-writable `true` policy is the hard finding", v.hard.some((h) => h.startsWith("open-write: guestbook")), v.hard);
  ok("security: nothing else is hard", v.hard.length === 2, v.hard);
  ok("security: a world-readable SELECT is listed, not failed", v.publicRead.join() === "menu_items", v.publicRead);
  ok("security: a definer function the API may call is listed; one it may not is not; a plain one never", v.definerExec.join() === "is_staff()", v.definerExec);
  ok("security: an owner-run view the API may read is listed; an invoker view is not", v.definerView.join() === "v_owner", v.definerView);
  ok("security: a table nobody but the service role can touch is counted, not judged", v.info.serviceOnly === 2 && v.info.failClosed === 1 && v.info.tables === 20, v.info);
  ok("security: an exemption with a reason clears a finding", judge(snap, { leak: "a planted reason", "guestbook.anyone writes": "a planted reason" }).hard.length === 0);
  ok("security: an exemption with no reason is itself a finding", judge(snap, { leak: "" }).hard.some((h) => h.includes("NO reason")));
  ok("security: the expanded shape judges the same", JSON.stringify(judge(expand(snap), {})) === JSON.stringify(v));
  ok("security: a later migration that touches a policy makes the snapshot stale", staleBecause(snap, [{ file: "0003_x.sql", text: "create policy p on t for select using (true);" }]).length === 1);
  ok("security: a later migration that only adds a column does not", staleBecause(snap, [{ file: "0003_x.sql", text: "alter table t add column c int; -- grant nothing" }]).length === 0);
  ok("security: a migration at the mark is not 'later'", staleBecause(snap, [{ file: "0002_x.sql", text: "grant select on t to anon;" }]).length === 0);
  ok("security: 'grant' inside a comment does not count", staleBecause(snap, [{ file: "0003_x.sql", text: "-- we grant nothing here\nalter table t add column c int;" }]).length === 0);
  // the read-back refusals: each one is a snapshot that would have lied
  ok("security: a dropped row is refused", /chunk row/.test(reassemble(rows.filter((_, i) => i !== 1)).error || ""));
  ok("security: a doubled row is refused", /chunk row/.test(reassemble([...rows.slice(0, 2), rows[1], ...rows.slice(2)]).error || ""));
  ok("security: a trimmed cell is refused", /trimmed/.test(reassemble(rows.map((x, i) => (i === 0 ? { row: x.row, chunk: x.chunk.slice(0, -1) } : x))).error || ""));
  ok("security: an altered character is refused", /sha256/.test(reassemble(rows.map((x, i) => (i === 0 ? { row: x.row, chunk: "X" + x.chunk.slice(1) } : x))).error || ""));
  ok("security: a result read without its digest row is refused", /digest row/.test(reassemble(rows.slice(0, -1)).error || ""));
  ok("security: the Supabase 'Copy as JSON' shape ({row, chunk}) and a bare [row, chunk] both read", !reassemble(rows.map((x) => [x.row, x.chunk])).error);
  await db.close();
}

// ── darkWellCounts (scripts/design.ratchet.mjs) ─────────────────────────────────────────────────
// The rules are the two that painted Ryan's My Day grey (2026-10-04), copied from app/globals.css.
{
  const dw = (css) => darkWellCounts(css).darkWells;
  const BOX = ".task-box{flex:0 0 auto;border:2px solid var(--line2);background:rgba(0,0,0,.22)}";
  const TOP = ".dayhead-t{display:flex;background:rgba(0,0,0,.18);border:1px solid var(--line2)}";
  ok("dark wells: the task box and the top-three card, with no day rule, are two", dw(BOX + TOP) === 2);
  ok("dark wells: a day rule restates one — :where() and a plain descendant both count as restating",
    dw(BOX + TOP + ".app.crew-day :where(.task-box){background:var(--card)}") === 1
    && dw(BOX + TOP + ".app.crew-day :where(.task-box){background:var(--card)}.app.crew-day .dayhead-t{background:var(--card)}") === 0);
  ok("dark wells: a day rule that does not touch the background does not restate it",
    dw(BOX + ".app.crew-day .task-box{border-color:red}") === 1);
  ok("dark wells: a rule for .code-row does not restate .code (whole selectors, not substrings)",
    dw(".code{background:rgba(0,0,0,.25)}.app.crew-day .code-row{background:#fff}") === 1);
  ok("dark wells: under 10% is a wash and 45% and over is an overlay — neither is counted",
    dw(".a{background:rgba(0,0,0,.05)}.b{background:rgba(0,0,0,.6)}.c{background:rgba(0,0,0,.45)}") === 0);
  ok("dark wells: a scrim is dark on purpose", dw(".sheet-scrim{background:rgba(0,0,0,.3)}") === 0);
  ok("dark wells: a selector list counts once, and stays counted while any part is bare",
    dw(".a,.b{background:rgba(0,0,0,.2)}.app.crew-day .a{background:#fff}") === 1
    && dw(".a,.b{background:rgba(0,0,0,.2)}.app.crew-day :is(.a,.b){background:#fff}") === 0);
  ok("dark wells: a comma inside a comment is not a selector list",
    dw("/* Ryan, 2026-10-04 */.a{background:rgba(0,0,0,.2)}.app.crew-day .a{background:#fff}") === 0);
  ok("dark wells: the paper scope restates too", dw(".a{background:rgba(0,0,0,.2)}.shop .a{background:#fff}") === 0);
}

// ── selectClassShorthands (scripts/design.ratchet.mjs) ──────────────────────────────────────────
// The rules are the two that striped OsRegistry's Status pick in the day theme (2026-10-04), copied
// from app/globals.css as they were; the source is the pick's own line from components/OsRegistry.
{
  const SRC = { "components/OsRegistry.tsx": `<select className="note-in" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>` };
  const read = (p) => { if (!(p in SRC)) throw new Error("no file"); return SRC[p]; };
  const list = (d) => (d === "components" ? ["OsRegistry.tsx"] : []);
  const n = (css) => selectClassShorthands(css, read, list).selectClassShorthands;
  const NOTE = ".note-in{width:100%;background:rgba(0,0,0,.28);border:1px solid var(--line2)}";
  const DAY = ".app.crew-day .note-in,.app.crew-day .note-area{background:var(--card);color:var(--cream)}";
  ok("select class: the dark rule and the day rule that striped the Status pick are two", n(NOTE + DAY) === 2);
  ok("select class: background-color is the honest way to colour one", n(NOTE.replace("background:", "background-color:") + DAY.replace("background:", "background-color:")) === 0);
  ok("select class: the class on an input alone is not a select's", n(".note-in input{background:#fff}.note-in::placeholder{background:red}") === 0);
  ok("select class: a class no select carries is not counted", n(".note-area{background:#fff}.note-input{background:#fff}") === 0);
  ok("select class: whole classes, not prefixes — .note-in is not .note-intro", n(".note-intro{background:#fff}") === 0);
  // 2026-10-04: an element test written as a bare word skipped every class NAMED like an element —
  // \binput\b is true of ".auth-input" — so the shorthand on the class every discount-code and perk
  // select carries was never counted, and those selects tiled their chevron in the day theme. The
  // source line is CodesPanel's Kind pick; the two rules are app/globals.css's as they were.
  const SRC2 = { "components/CodesPanel.tsx": `<select className="auth-input" value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Discount kind">` };
  const n2 = (css) => selectClassShorthands(css, (p) => { if (!(p in SRC2)) throw new Error("no file"); return SRC2[p]; }, (d) => (d === "components" ? ["CodesPanel.tsx"] : [])).selectClassShorthands;
  ok("select class: a class named like an element is still a class — .auth-input is not <input>",
    n2(".auth-input{width:100%;background:var(--field)}.app.crew-day .auth-input{background:var(--card)}") === 2);
  ok("select class: an element compound is still not a select's — textarea.auth-input, input.auth-input",
    n2("textarea.auth-input{background:#fff}input.auth-input{background:#fff}") === 0);
}

// ── undefinedTokens (scripts/design.ratchet.mjs) ────────────────────────────────────────────────
// The rule is the Academy's progress track as it was (2026-10-06), copied from app/globals.css with
// the token scale beside it; the component line is EventPrepAI's, which sets --c inline.
{
  const SRC = { "components/EventPrepAI.tsx": `<button className="eg-row" style={{ ["--c" as string]: SECTION_COLOR[t.section] }}>` };
  const read = (p) => { if (!(p in SRC)) throw new Error("no file"); return SRC[p]; };
  const list = (d) => (d === "components" ? ["EventPrepAI.tsx"] : []);
  const n = (css) => undefinedTokens(css, read, list).undefinedTokens;
  const SCALE = ":root{--ink-onLight-05:rgba(34,31,24,.05);--ink-onLight-16:rgba(34,31,24,.16)}";
  const TRACK = ".pr-bar{flex:1;height:6px;background:var(--ink-onLight-08);overflow:hidden}";
  ok("tokens: the Academy's track read a step the scale never had — one", n(SCALE + TRACK) === 1);
  ok("tokens: a step the scale has is defined", n(SCALE + TRACK.replace("-08", "-16")) === 0);
  ok("tokens: a fallback is a decision, not a hole", n(SCALE + ".a{color:var(--bad,#d66)}.b{color:var( --good , green)}") === 0);
  ok("tokens: a component that sets it inline defines it", n(".eg-row{border-color:var(--c)}") === 0 && n(".eg-row{border-color:var(--d)}") === 1);
  ok("tokens: a token named only in a comment is not defined", n("/* --x: red */.a{color:var(--x)}") === 1);
}

// ── promisesIn (scripts/affordance.audit.mjs) ───────────────────────────────────────────────────
// The four directions are the four production carried on 2026-10-04 (origin/main a9c7f5e), copied
// from the files named. Production had no dead chevron by this rule, so the chevron fixtures are
// this pass's own rows, planted back the way they would regress: the same markup with its button
// taken away.
{
  const p = (jsx) => promisesIn(`export default function X() { return (${jsx}); }`);
  const ch = (jsx) => p(jsx).chevrons.length;
  const dir = (jsx) => p(jsx).directions.length;

  // chevrons
  const RESTOCK = `<span>Restock · {low.length} low for upcoming events ›</span>`;
  ok("affordance: a chevron on a plain row promises a door it does not have (Owed's restock rule, button taken away)",
    ch(`<div className="wrule">${RESTOCK}</div>`) === 1);
  ok("affordance: the same row as the button it is now is a door (components/Owed.tsx)",
    ch(`<button type="button" className="wrule wrule-go" onClick={() => setSection("garage")}>${RESTOCK}</button>`) === 0);
  const OP_INSIDE = `<span className="dayhead-op-t"><b>{name}</b></span><span className="ev-chev" aria-hidden="true">›</span>`;
  ok("affordance: today's op card as the button it is now (components/DayHeadline.tsx)",
    ch(`<button type="button" className="dayhead-op-go" onClick={() => openRecord("event", op.id)}>${OP_INSIDE}</button>`) === 0);
  ok("affordance: the same card as the <div> it was is ONE dead chevron — the chev class and its glyph are one site",
    ch(`<div className="dayhead-op">${OP_INSIDE}</div>`) === 1);
  ok("affordance: a chevron in a .map() inside a button is inside the button",
    ch(`<button type="button" onClick={go}>{rows.map((r) => <span key={r.id}>{r.name} ›</span>)}</button>`) === 0);
  ok("affordance: a {...clickable()} spread is interactive (lib/a11y)",
    ch(`<div className="row" {...clickable(() => open(r.id))}>${RESTOCK}</div>`) === 0);
  ok("affordance: a breadcrumb separator is not a promise (components/Crumbs.tsx)",
    ch(`<nav aria-label="Breadcrumb"><span>{root}</span><em className="crumb-sep" aria-hidden>›</em></nav>`) === 0);
  ok("affordance: a chevron handed to another component as a prop is not judged — where it lands is out of sight",
    ch(`<Row right={<span>›</span>} />`) === 0);
  ok("affordance: JSX parked in a variable is not judged either", promisesIn(`const tail = <span>›</span>;`).chevrons.length === 0);
  ok("affordance: '›' inside running text is not a chevron (only alone, or at the end)",
    ch(`<p>Prep › Atlanta BeltLine is a breadcrumb in a sentence</p>`) === 0);

  // directions
  const VENDOR = `<div className="vpend">Pending owner approval — review it in Plan › Vendors.</div>`;
  ok("affordance: 'review it in Plan › Vendors' is a direction (components/crew/VendorPicker.tsx:89, production until 2026-10-05)", dir(VENDOR) === 1);
  ok("affordance: 'check-ins live on Command › Goals' is one (components/OperatingRhythm.tsx:91, production)",
    dir(`<div className="rhythm-pulse"><span className="rhythm-pulse-hint">— check-ins live on Command › Goals</span></div>`) === 1);
  ok("affordance: 'the team note is in Plan → Notes' is one (components/EventGenerator.tsx:59, production)",
    dir(`<div className="dp-hint">Events are under Events, the team note is in Plan → Notes, and the to-dos are on the Company Calendar.</div>`) === 1);
  ok("affordance: an arrowRight icon reads as → — 'set their unit cost in Money → Product economics' (app/crew/page.tsx:4260, production)",
    dir(`<div className="pnl-note">Some lines use the blended {pct}% COGS — set their unit cost in Money <Icon name="arrowRight" /> Product economics for exact margin.</div>`) === 1);
  const STUDIO = (door) => `<div className="cal-xlink">
    <span className="cal-xlink-t">Every line guests read is edited in <b>Settings › Copy &amp; wording</b>.</span>
    ${door ? `<button type="button" className="cal-xlink-go" onClick={goCopy}>Open the copy editor <Icon name="arrowRight" /></button>` : ""}
  </div>`;
  ok("affordance: a direction with its door beside it is answered (components/Studio.tsx:184)", dir(STUDIO(true)) === 0);
  ok("affordance: …and the same sentence with the door taken away is not", dir(STUDIO(false)) === 1);
  ok("affordance: a <select> beside a direction is not its door — VendorPicker's own select stood beside the sentence",
    dir(`<div><select className="ev-input" value={v} onChange={pick}><option value="">— not linked —</option></select>${VENDOR}</div>`) === 1);
  ok("affordance: …not even one whose options read like a move (planted — no select in the repo says → yet; the rule is for the day one does)",
    dir(`<div><select className="ev-input" value={s} onChange={move}><option value="sent">Draft → Sent</option></select>${VENDOR}</div>`) === 1);
  ok("affordance: a direction inside a button is the door itself",
    dir(`<button type="button" onClick={go}>Set it in Money → Product economics</button>`) === 0);
  ok("affordance: counted once, at the element that says it — not again at the card around it",
    dir(`<div className="card"><div className="inner">${VENDOR}</div></div>`) === 1);
  ok("affordance: 'Plan → execute → review' is a cycle, not a direction — no page follows the arrow (OperatingRhythm's own subtitle)",
    dir(`<div className="h-sub">Plan → execute → <b>review</b> → adjust.</div>`) === 0);
  ok("affordance: an arrow that means 'becomes' is not a direction (app/academy/page.tsx: situation → what to do)",
    dir(`<div className="ac-scn-d"><Icon name="arrowRight" /> {s.doThis}</div>`) === 0
    && dir(`<span>5 gal → 4.7 gal servable</span>`) === 0);
  ok("affordance: a direction to another product is not the console's (only PLACES count)",
    dir(`<p>Right-click the mockup on Apliiq → Copy image address.</p>`) === 0 && !PLACES.includes("Apliiq"));
  ok("affordance: both ceilings are zero — raising one is a choice this file has to be told about",
    CHEVRON_CEILING === 0 && DIRECTION_CEILING === 0);
}

// ── vocabularies / wordsIn / judge (scripts/vocab.audit.mjs) ────────────────────────────────────
// The three words production refused on 2026-10-04, each with the migration that refuses it, copied
// from the files named. Everything else is a Postgres rule the reader has to get right or it invents
// a list that is not there (a false failure) or keeps one that was dropped (a false pass).
{
  const V = (...sqls) => vocabularies(sqls.map((text, i) => ({ file: `${String(i + 1).padStart(4, "0")}_t.sql`, text })));
  const allows = (v, key) => v.get(key)?.values.join(",");
  const W = (src, file = "x.tsx") => wordsIn(src, file).map((w) => `${w.table}.${w.col}=${w.value}:${w.how}`);
  const refusedBy = (sqls, src) => judgeWords(V(...sqls), wordsIn(src)).refused.map((r) => `${r.table}.${r.col}=${r.value}`);

  // the table's words
  const D0139 = `create table if not exists public.delivery_orders (
  id uuid primary key default gen_random_uuid(),
  status               text not null default 'received' check (status in ('received','brewed','out_for_delivery','delivered','held_for_pickup','issue')),
  driver_outcome       text check (driver_outcome in ('swap_completed','delivered_fresh_no_empties','held_no_empties')),
  constraint delivery_refill_ack check (refill_count = 0 or empty_ack_at is not null)
);`;
  ok("vocab: a column's own check is its list (0139 delivery_orders.status)",
    allows(V(D0139), "delivery_orders.status") === "received,brewed,out_for_delivery,delivered,held_for_pickup,issue");
  ok("vocab: a check that is not a list is not one (0139's refill rule)", !V(D0139).has("delivery_orders.refill_count"));
  const O0165 = `create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  stage        text not null default 'prospect'
                 check (stage in ('prospect','first_attempt','talking','proposal','won','lost')),
  source       text not null default 'manual'
);`;
  const O0265 = `alter table public.opportunities drop constraint if exists opportunities_stage_check;
update public.opportunities set stage = case stage when 'talking' then 'warm' else stage end;
alter table public.opportunities add constraint opportunities_stage_check
  check (stage in ('lead','warm','sampled','pilot','live','expand','lost'));`;
  ok("vocab: a later drop-and-add replaces the list — 'talking' was legal before 0265 and is not after",
    allows(V(O0165), "opportunities.stage").includes("talking") && !allows(V(O0165, O0265), "opportunities.stage").includes("talking")
    && allows(V(O0165, O0265), "opportunities.stage").includes("warm"));
  ok("vocab: '= any (array[…])' is a list too (0308 brew_batches.status)",
    allows(V(`create table brew_batches (id uuid, status text);`, `alter table public.brew_batches drop constraint if exists brew_batches_status_check;
alter table public.brew_batches add constraint brew_batches_status_check
  check (status = any (array['planned','brewing','ready','kegged','served','dumped','discarded']));`), "brew_batches.status") === "planned,brewing,ready,kegged,served,dumped,discarded");
  ok("vocab: 'is null or … in (…)' is a list (0182 profiles.gender)",
    allows(V(`alter table public.profiles add column if not exists gender text check (gender is null or gender in ('male','female','other'));`), "profiles.gender") === "male,female,other");
  ok("vocab: a drop with no re-add leaves no list", !V(D0139, `alter table delivery_orders drop constraint if exists delivery_orders_status_check;`).has("delivery_orders.status"));
  ok("vocab: a second check on a column — a length — does not unseat its list (Postgres names it …_check1)",
    allows(V(`create table t (s text check (s in ('a','b')) check (length(s) < 3));`), "t.s") === "a,b"
    && allows(V(`create table t (s text check (s in ('a','b')) check (length(s) < 3));`, `alter table t drop constraint t_s_check1;`), "t.s") === "a,b"
    && !V(`create table t (s text check (s in ('a','b')) check (length(s) < 3));`, `alter table t drop constraint t_s_check;`).has("t.s"));
  ok("vocab: two unnamed lists on one column are two constraints, …_check and …_check1, and dropping one leaves the other",
    allows(V(`create table t (s text check (s in ('a','b','c')) check (s in ('b','c','d')));`), "t.s") === "b,c"
    && allows(V(`create table t (s text check (s in ('a','b','c')) check (s in ('b','c','d')));`, `alter table t drop constraint t_s_check1;`), "t.s") === "a,b,c");
  ok("vocab: a number list reads as numbers (0245 pack_size)", allows(V(`alter table public.delivery_orders add constraint delivery_orders_pack_size_check check (pack_size in (6, 12, 24));`), "delivery_orders.pack_size") === "6,12,24");
  ok("vocab: 'create table if not exists' for a table that exists is skipped whole, as Postgres skips it",
    allows(V(O0165, O0265, O0165), "opportunities.stage").includes("warm"));
  ok("vocab: 'add column if not exists' for a column that exists does not add its check either",
    allows(V(O0165, O0265, `alter table opportunities add column if not exists stage text check (stage in ('talking'));`), "opportunities.stage").includes("warm"));
  ok("vocab: a dropped column takes its list with it", !V(D0139, `alter table delivery_orders drop column if exists driver_outcome;`).has("delivery_orders.driver_outcome"));
  ok("vocab: a check in a comment or a function body is not DDL — a function's body runs when it is called",
    !V(`-- alter table x add constraint x_s_check check (s in ('a'));\ncreate function f() returns void language plpgsql as $$ begin\n  perform 1;\n  alter table y add constraint y_s_check check (s in ('b'));\nend $$;`).size);
  const A0280 = `do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'admin_emails_role_check') then
    alter table public.admin_emails add constraint admin_emails_role_check
      check (role in ('member','server','operator','event_manager','contractor','admin','owner'));
  end if;
end $$;`;
  ok("vocab: a DO block runs where it stands, so its check is read (0280 admin_emails.role — eleven lists in this repo live in one)",
    allows(V(A0280), "admin_emails.role") === "member,server,operator,event_manager,contractor,admin,owner");
  ok("vocab: …and its 'if not exists … conname' guard is honoured: a name already taken keeps its list",
    allows(V(`create table admin_emails (email text, role text check (role in ('admin','owner')));`, A0280), "admin_emails.role") === "admin,owner");
  ok("vocab: two lists on one column both have to pass", allows(V(`create table t (s text check (s in ('a','b','c')), constraint t_s2 check (s in ('b','c','d')));`), "t.s") === "b,c");
  ok("vocab: a list item with a quote in it reads whole", listOf(`s in ('it''s','b')`).values.join("|") === "it's|b");

  // the app's words
  ok("vocab: an update's literal (components/AlertAction.tsx:84, production) is a word for delivery_orders.status",
    W(`await supabase.from("delivery_orders").update({ status: "picked_up" }).eq("id", flag.subject_id);`).join() === "delivery_orders.status=picked_up:update");
  ok("vocab: an insert's literal (app/crew/page.tsx:3387, production)",
    W(`const { data } = await supabase.from("opportunities").insert({ vendor_id: vendorId, stage: "talking", source: "inbound", next_step: "Reply to their request", created_by: user.id }).select("id").single();`).includes("opportunities.stage=talking:insert"));
  ok("vocab: a spread of a conditional object is read (the booking_requests status beside it)",
    W(`await supabase.from("booking_requests").update({ opportunity_id: oppId, ...(r.status === "new" ? { status: "contacted" } : {}) }).eq("id", r.id);`).includes("booking_requests.status=contacted:update"));
  ok("vocab: both branches of a conditional, and a ?? fallback, are words",
    W(`sb.from("t").update({ s: done ? "a" : "b", k: x ?? "c" })`).join() === "t.s=a:update,t.s=b:update,t.k=c:update");
  ok("vocab: rows built by .map() are read", W(`sb.from("t").insert(items.map((i) => ({ s: "a", n: i })))`).join() === "t.s=a:insert");
  ok("vocab: filters — eq, neq, in, not-in and match — are words, and a filter after a write is on the write's table",
    W(`sb.from("t").select("*").eq("s", "a").neq("s", "b").in("s", ["c", "d"]).not("s", "in", "(e,f)").match({ s: "g" });
       sb.from("u").update({ x: 1 }).eq("s", "h")`).sort().join() === "t.s=a:filter,t.s=b:filter,t.s=c:filter,t.s=d:filter,t.s=e:filter,t.s=f:filter,t.s=g:filter,u.s=h:filter,u.x=1:update");
  ok("vocab: a value in a variable is not judged — the audit cannot see it, and says so", W(`sb.from("t").update(patch); sb.from("t").update({ s: next })`).length === 0);
  ok("vocab: a list declared for a column is held like a write (lib/brewMath BATCH_OVER)",
    W(`// vocab: brew_batches.status\nexport const BATCH_OVER = ["served", "dumped", "discarded"] as const;`, "x.ts").join() === "brew_batches.status=served:list,brew_batches.status=dumped:list,brew_batches.status=discarded:list");
  ok("vocab: a label map declared for a column is held by its keys",
    W(`// vocab: delivery_orders.status\nconst LABEL: Record<string, string> = { delivered: "Delivered", held_for_pickup: "HELD" };`, "x.ts").join() === "delivery_orders.status=delivered:list,delivery_orders.status=held_for_pickup:list");
  ok("vocab: a comment naming this audit is not a declaration", W(`// see scripts/vocab.audit.mjs\nconst L = ["x"];`, "x.ts").length === 0);

  // judged
  ok("vocab: the held-delivery button was refused, and its fix is not",
    refusedBy([D0139], `sb.from("delivery_orders").update({ status: "picked_up" })`).join() === "delivery_orders.status=picked_up"
    && refusedBy([D0139], `sb.from("delivery_orders").update({ status: "delivered" }).eq("id", id).eq("status", "held_for_pickup")`).length === 0);
  ok("vocab: the promote was refused after 0265 and not before it",
    refusedBy([O0165, O0265], `sb.from("opportunities").insert({ stage: "talking" })`).length === 1
    && refusedBy([O0165], `sb.from("opportunities").insert({ stage: "talking" })`).length === 0
    && refusedBy([O0165, O0265], `sb.from("opportunities").insert({ stage: "warm" })`).length === 0);
  ok("vocab: a filter for a word the column never had is refused (components/PackPlan.tsx:46, production — .neq('status', 'archived') filtered nothing)",
    refusedBy([`create table brew_batches (status text check (status = any (array['planned','served','dumped','discarded'])))`], `sb.from("brew_batches").select("id").neq("status", "archived")`).join() === "brew_batches.status=archived");
  ok("vocab: a table with no list is not judged, and neither is a column with none",
    refusedBy([D0139], `sb.from("events").update({ stage: "anything" }); sb.from("delivery_orders").update({ notes: "anything" })`).length === 0);
  {
    const now = V(O0165, O0265), later = V(O0165, O0265, `alter table opportunities drop constraint opportunities_stage_check, add constraint opportunities_stage_check check (stage in ('lead','warm','sampled','pilot','live','expand','lost','paused'));`);
    const j = judgeWords(now, wordsIn(`sb.from("opportunities").update({ stage: "paused" })`), later);
    ok("vocab: a word only a pending migration allows is ARRIVING, not refused — the columns audit's rule", j.refused.length === 0 && j.arriving.length === 1);
  }
  ok("vocab: the ceiling is zero", REFUSED_CEILING === 0);
}

// ── gesture.audit: the four rules, on code shaped like the code they were written for ──────────────
{
  const G = (body, file = "components/X.tsx") => gesturesIn(`export default function X() { ${body} }`, file);
  const J = (body, file = "components/X.tsx") => judgeFile(file, G(body, file)).map((b) => b.rule);
  // 1. overlays
  ok("gesture: a hand-drawn dialog is seen, and fails until it is a Sheet or named",
    G(`return <div className="x" role="dialog" aria-modal="true" aria-label="Y">hi</div>;`).overlays.length === 1 && J(`return <div role="dialog" aria-label="Y" />;`).join() === "overlay");
  ok("gesture: a dialog named with its reason passes (the Pass, full screen over Live Ops)",
    J(`return <div className="svc-full" role="dialog" aria-modal="true" aria-label="The Pass" />;`, "app/crew/page.tsx").length === 0 && "app/crew/page.tsx#The Pass" in OWN_OVERLAYS);
  ok("gesture: the Sheet's own dialogs are the system, not an exception", J(`return <div role="dialog" aria-label="Z" />;`, "components/Sheet.tsx").length === 0);
  // 2. tab rows
  ok("gesture: a tab row that switches nothing on a swipe fails until it pages or is named",
    J(`return <div className="seg" role="tablist" aria-label="Views"><button role="tab" /></div>;`).join() === "tabs");
  ok("gesture: a tab row named as not pages passes (the bottom tab bar is tapped, not swiped)",
    J(`return <div className="opnav-tabs" role="tablist" aria-label="Crew console" />;`, "components/OperatorNav.tsx").length === 0 && "components/OperatorNav.tsx#Crew console" in NOT_PAGES);
  ok("gesture: a row listed as paged must be paged in its file",
    J(`return <div className="studio-views" role="tablist" aria-label="View" />;`, "components/Studio.tsx").join() === "tabs"
    && J(`usePagerLevel({ keys: [], current: "", go: () => {}, depth: 1 }); return <div className="studio-views" role="tablist" aria-label="View" />;`, "components/Studio.tsx").length === 0);
  ok("gesture: a label that is not a literal is keyed by the row's class (the lane toggle)",
    G(`return <div className="grp-toggle" role="tablist" aria-label={lane.label} />;`, "app/crew/page.tsx").tabRows[0].key === "app/crew/page.tsx#grp-toggle");
  // 3. touch
  ok("gesture: a window touch listener outside the gesture layer fails — the calendar walker's old shape",
    J(`useEffect(() => { window.addEventListener("touchstart", ts, { passive: true }); window.addEventListener("touchend", te, { passive: true }); }, []); return null;`).join() === "touch,touch");
  ok("gesture: React touch props count as touch listeners too", J(`return <div onTouchStart={a} onTouchEnd={b} />;`).join() === "touch,touch");
  ok("gesture: the engine itself is where touch listeners live", J(`el.addEventListener("touchmove", onMove, { passive: false }); return null;`, "components/useGesture.ts").length === 0 && "components/useGesture.ts" in GESTURE_LAYER);
  // 4. forms in sheets
  ok("gesture: a sheet with a text field and no word on what leaving does fails",
    J(`return <Sheet open onClose={c} label="Edit thing"><input value={v} onChange={s} /></Sheet>;`).join() === "unsaved");
  ok("gesture: `dirty` on the sheet answers it; so does useUnsaved anywhere in the file",
    J(`return <Sheet open onClose={c} label="Edit thing" dirty={d}><input value={v} /></Sheet>;`).length === 0
    && J(`useUnsaved(d); return <Sheet open onClose={c} label="Edit thing"><textarea value={v} /></Sheet>;`).length === 0);
  ok("gesture: checkboxes, radios and files are not typed words; a field in a component the sheet renders is not seen",
    J(`return <Sheet open onClose={c} label="P"><input type="checkbox" /><input type="radio" /><input type="file" /></Sheet>;`).length === 0
    && J(`return <Sheet open onClose={c} label="P"><Form /></Sheet>;`).length === 0);
  ok("gesture: a sheet named in NO_UNSAVED passes, with its reason", J(`return <Sheet open onClose={c} label="Q"><input /></Sheet>;`, "components/PromptSheet.tsx").length === 0 && !!NO_UNSAVED["components/PromptSheet.tsx"]);
  ok("gesture: a list entry that answers nothing is stale", staleEntries(new Set()).length > 0 && staleEntries(new Set(Object.keys({ ...OWN_OVERLAYS, ...NOT_PAGES, ...NO_UNSAVED, ...GESTURE_LAYER }))).filter((k) => !/^PAGED/.test(k)).length === 0);
}

// ── haptics.audit: the three rules, on the calls this repo made before the round and makes now ──────
// The failing shapes are the ones production carried until 2026-10-05, copied from the files named.
{
  const FEELS = ["selection", "light", "medium", "heavy", "success", "warning", "error", "threshold", "release", "boundary", "toggleOn", "toggleOff", "increase", "decrease", "start", "live", "paid", "alert"];
  const J = (src, file = "components/X.tsx") => judgeHaptics(file, hapticsIn(src, file), FEELS).map((b) => b.rule);
  const IMP = `import { haptic } from "@/lib/haptics";\n`;
  // 1. one home
  ok("haptics: navigator.vibrate outside lib/haptics fails — a raw buzz no feel names",
    J(`export function ring() { navigator.vibrate([200, 100, 200]); }`).join() === "home");
  ok("haptics: …and so does a vibrate reached another way — a copy of navigator, a bracket, a destructure",
    J(`const nav = navigator; nav.vibrate(8); navigator["vibrate"](8); const { vibrate } = navigator;`).join() === "home,home,home");
  ok("haptics: lib/haptics.ts is the home — its own vibrate passes (the line as it stands there)",
    J(`if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function" && navigator.vibrate(typeof p === "number" ? p : [...p])) return;`, HAPTICS_HOME).length === 0);
  ok("haptics: the word in a comment or a string is not a vibrate",
    J(`// This was \`navigator.vibrate\` alone, and Safari has never had it\nconst s = "navigator.vibrate";`).length === 0);
  // 2. say what
  ok("haptics: a feel named as one literal passes (components/crew/LiveControl.tsx goLive, now)",
    J(`${IMP}const goLive = async (stopId: string) => { haptic("live"); };`).length === 0);
  ok("haptics: the old table fails (components/crew/LiveControl.tsx goLive, production until 2026-10-05)",
    J(`import { haptic, HAPTIC } from "@/lib/haptics";\nconst goLive = async (stopId: string) => { haptic(HAPTIC.arm); };`).join() === "feel");
  ok("haptics: a number, an array, a variable and a template all fail — the feel is not readable at the call",
    J(`${IMP}haptic(12); haptic([14, 40, 14]); haptic(feel); haptic(\`light\`);`).join() === "feel,feel,feel,feel");
  ok("haptics: a word that is not a feel fails — 'tick' and 'tap' were the old table's names",
    J(`${IMP}haptic("tick"); haptic("tap");`).join() === "feel,feel");
  ok("haptics: one literal per call — a ternary between two feels fails; two calls pass (components/SwipeRow.tsx)",
    J(`${IMP}haptic(on ? "threshold" : "release");`).join() === "feel"
    && J(`${IMP}if (on !== armed.current) { armed.current = on; if (on) haptic("threshold"); else haptic("release"); }`).length === 0);
  ok("haptics: no feel, or a feel and something more, is not one feel", J(`${IMP}haptic(); haptic("light", 2);`).join() === "feel,feel");
  ok("haptics: imported under another name, or through a namespace, it is still held to the list",
    J(`import { haptic as buzz } from "@/lib/haptics";\nbuzz(8); buzz("light");`).join() === "feel"
    && J(`import * as H from "../lib/haptics";\nH.haptic("buzz"); H.haptic("paid");`).join() === "feel");
  // 3. all felt
  const V = (union, table) => judgeVocabulary(vocabularyOf(`export type Feel = ${union};\nconst PATTERN: Record<Feel, number | readonly number[]> = { ${table} };`)).map((b) => b.what);
  ok("haptics: every feel with a pattern, and no pattern without a feel, passes", V(`"light" | "paid"`, `light: 8, paid: [10, 30, 18]`).length === 0);
  ok("haptics: a feel with no pattern fails", V(`"light" | "paid"`, `light: 8`).join() === `"paid" is a feel with no pattern — give it one in PATTERN`);
  ok("haptics: a pattern no feel names fails — the old table's 'tick' kept beside the feels",
    V(`"light"`, `light: 8, tick: 6`).join() === "PATTERN.tick is a pattern no feel names — add it to Feel, or take it out");
  ok("haptics: a member that is not a word, or a key spread in, cannot be read — and fails rather than passing",
    V(`"light" | string`, `light: 8`).length === 1 && V(`"light"`, `light: 8, ...MORE`).length === 1);
  ok("haptics: a file with no union or no table is not a vocabulary", judgeVocabulary(vocabularyOf(`export const HAPTIC = { tick: 6 };`)).length === 2);
  {
    const v = vocabularyOf(readFileSync(new URL("../lib/haptics.ts", import.meta.url), "utf8"));
    ok("haptics: lib/haptics.ts as it stands reads as the eighteen feels, each with its pattern",
      v.feels?.map((f) => f.name).join() === FEELS.join() && v.table?.length === 18 && judgeVocabulary(v).length === 0, v.feels?.map((f) => f.name));
  }
  // 4. an error says so — the shapes production carried until 2026-10-06 (app/crew/page.tsx), and now
  ok("haptics: an error toast on the default variant fails — the event card's refused write (app/crew/page.tsx update, until 2026-10-06)",
    J(`const update = async () => { toast(error ? \`Error: \${error.message}\` : "Event updated"); };`).join() === "error-toast");
  ok("haptics: a variant that chooses, but never chooses error, fails too",
    J(`toast(error ? \`Error: \${error.message}\` : "Saved", error ? "info" : undefined);`).join() === "error-toast");
  ok("haptics: …and so does a plain one — the last owner's refusal, a role change's error",
    J(`toast("Can't remove the last owner — promote someone else first."); toast(\`Error: \${error.message}\`); toast("Couldn't save");`).join() === "error-toast,error-toast,error-toast");
  ok("haptics: an error toast that says so passes — \"error\", or error ? \"error\" : undefined",
    J(`toast(error ? \`Error: \${error.message}\` : "Event updated", error ? "error" : undefined); toast(\`Couldn't rename — \${e}\`, "error");`).length === 0);
  ok("haptics: a success, a neutral word, or a message held in a variable is not judged",
    J(`toast("Saved"); toast(\`Marked \${status}\`); toast(msg); toast(ok ? "Saved" : "Couldn't save", ok ? undefined : "error");`).length === 0);
}

// ── css.audit: the house stylesheet and the utilities (the Tailwind round, 2026-10-07) ────────────
// Real lines: the pipeline's priority chip (components/PipelinePanel.tsx) and the check 0265 puts on
// its column, the order-age chip (app/crew/page.tsx), the calendar card (components/CompanyCalendar.tsx),
// the splash's button (components/MarketingSplash). The first pass at dead CSS judged words by their
// case and would have taken .pipe-pri.p1 — a P1 lead's gold — off the pipeline; these hold the rule.
{
  const postcss = createRequire(import.meta.url)("postcss");
  const PIPE = "<i className={`pipe-pri ${o.priority.toLowerCase()}`}>{o.priority}</i>";
  const CHECK = "check (priority is null or priority in ('P1','P2','P3','P4'))";
  const named = namedBy(`${PIPE}\n${CHECK}`);
  const dead = (css) => deadSelectorsIn(postcss.parse(css), named);
  ok("css dead: a class built from data cased on the way is named — the pipeline's 'P1' is .pipe-pri.p1",
    dead(".pipe-pri{font-style:normal}.pipe-pri.p1{background:var(--gold2)}").length === 0);
  ok("css dead: a class nothing names is dead (.pipe-pri.p9)", JSON.stringify(dead(".pipe-pri.p9{color:var(--red)}")) === '[".pipe-pri.p9"]', dead(".pipe-pri.p9{color:var(--red)}"));
  ok("css dead: a class nothing names inside :not() leaves the rule alive — :not() of nothing matches everything",
    dead(".pipe-pri:not(.zz-never){opacity:.9}").length === 0);
  ok("css dead: what sits in an attribute selector is not a class", dead('.pipe-pri a[href$=".zzpdf"]{color:var(--red)}').length === 0);
  ok("css dead: keyframe steps are not selectors", dead("@keyframes zzspin{from{opacity:0}to{opacity:1}}").length === 0);
  {
    const n = namedBy('<div className={`rd-t${n}`} />\nconst c = "tone-" + t;');
    ok("css dead: a prefix the code builds on names its classes (`rd-t${n}`, \"tone-\" + t) — and only those", n("rd-t3") && n("tone-red") && !n("tonal") && !n("rd-x"));
  }
  ok("css demanded: one alternative of :is() or :where() is not what a rule needs", demanded(".a:is(.b, .c) .d:where(.e)") === ".a .d");

  const loose = (css) => looseHoversIn(postcss.parse(css));
  ok("css hover: a bare :hover stays lit on a phone after a tap", loose(".spl-cta:hover{background:var(--red-h)}").length === 1);
  ok("css hover: behind @media (hover:hover) it does not", loose("@media (hover:hover){.spl-cta:hover{background:var(--red-h)}}").length === 0);
  ok("css hover: inside another media query, still guarded", loose("@media (min-width:700px){@media (hover:hover){.spl-cta:hover{opacity:1}}}").length === 0);

  const M = (src) => markupOf("x.tsx", src);
  ok("css markup: a class taken whole from data is counted (the order-age chip)", M("<span className={`adm-age ${sev}`}>{x}</span>").wholeVariable.length === 1);
  ok("css markup: a class glued to a word is not whole (the calendar card)", M('<div className={`calcard${it.done ? " done" : ""}`} />').wholeVariable.length === 0);
  ok("css markup: a choice between written words is safe", M('<i className={`x ${on ? "on" : "off"}`} />').wholeVariable.length === 0);
  ok("css markup: a style object counts, a style from a variable does not", M("<div style={{ margin: 0 }} /><div style={s} />").inlineStyles === 1);
  ok("css markup: every class a className writes", [...M('<b className="k-chip k-chip-sec" />').classes].join(" ") === "k-chip k-chip-sec");

  ok("css house: the classes a stylesheet styles, not the ones its comments name", [...houseClasses("/* .gone */ .mp-ring svg{} .rc small{}")].sort().join(" ") === "mp-ring rc");
  ok("css colours: a colour written two ways is one", rawColours(".a{color:rgba(0, 0, 0, .5)} .b{color:rgba(0,0,0,.5)} .c{color:#FFF} .d{color:#fff}").size === 2);
}

console.log(`AUDIT CLASSIFIERS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
