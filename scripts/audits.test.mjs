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
import { handRollsCrew, bypassesTaskSpine, CREW_EXEMPT, namesRoleVocabulary, rolesNamedIn, rendersRawCrewOption } from "./dupe.audit.mjs";
import { selectsIn, topLevelParts, columnsOf, ageLine, pendingMigrations, arrivingColumns, declaresArrival } from "./columns.audit.mjs";
import { definitionsToSchema, refuseReason, projectRef } from "./schema.snapshot.mjs";
import { classify as classifyRoute, unwrapped } from "./api.audit.mjs";
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
import { mkdtempSync } from "node:fs";
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

console.log(`AUDIT CLASSIFIERS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
