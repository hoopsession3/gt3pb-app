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
import { handRollsCrew, bypassesTaskSpine, CREW_EXEMPT, namesRoleVocabulary, rolesNamedIn } from "./dupe.audit.mjs";

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

console.log(`AUDIT CLASSIFIERS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
